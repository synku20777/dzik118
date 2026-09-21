// Phase G (Invoices/delivery) - invoice email sending (spec Section 23,
// INV-006). Two distinct entry points, matching the spec's own wording:
// sendInvoice is the idempotent first send (normally only from PREPARED,
// a no-op if already sent); resendInvoice is the explicit action that
// always creates a new delivery attempt once something has been sent
// before. The canonical PDF (Section 22) is generated exactly once, on
// the first successful send -- a resend reuses the same pdf_object_key/
// pdf_sha256, never regenerates it (Section 21: "canonical PDF
// immutable").
import { and, eq, isNull } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { billingCases, billingPeriods } from "../../db/schema/billing";
import {
  invoiceDeliveries,
  invoiceLines,
  invoiceSendAttempts,
  invoices,
} from "../../db/schema/invoices";
import type { createSupabaseAdminClient } from "../../lib/supabase/admin";
import type { EmailService } from "../../lib/email/service";
import {
  invoicePdfObjectKey,
  uploadInvoicePdf,
} from "../../lib/storage/invoices";
import { sha256Hex } from "../../lib/hash";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError, NotFoundError, toSafeSkipReason } from "../errors";
import { renderInvoiceHtml } from "./invoice-html";
import { createInvoiceAccessToken } from "./invoice-tokens";
import { getInvoice } from "./generation";
import {
  claimSendCommand,
  classifyAttemptStaleness,
  FIRST_DELIVERY_ELIGIBLE_CASE_STATUSES,
  getLatestSendAttempt,
  markDispatching,
  markFailed,
  markFailedConditional,
  markSent,
  markUnknown,
  reconcileStaleAttempt,
  type InvoiceSendAttempt,
  type InvoiceSendAttemptStatus,
} from "./send-attempts";

export { ConflictError, NotFoundError };

export async function listDeliveries(
  db: Db,
  organizationId: string,
  invoiceId: string
) {
  return db
    .select()
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.invoiceId, invoiceId),
        eq(invoiceDeliveries.organizationId, organizationId)
      )
    )
    .orderBy(invoiceDeliveries.createdAt);
}

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export interface SendInvoiceDeps {
  // Injected rather than a raw Cloudflare Browser Rendering binding: the
  // binding only exists inside an actual Workers request context, but
  // this domain function's OTHER logic (state transitions, idempotency,
  // delivery records, email content) needs to run under plain Node in
  // integration tests. Production wiring (src/actions/invoices.ts) passes
  // a function that calls src/lib/pdf/render.ts with env.BROWSER; tests
  // pass a stub that returns fixed bytes.
  renderPdf: (html: string) => Promise<Uint8Array>;
  supabaseAdmin: SupabaseAdmin;
  emailService: EmailService;
  tokenSecret: string;
  appBaseUrl: string;
}

export interface DeliverResult {
  emailOutcome:
    "SENT" | "FAILED" | "UNKNOWN" | "NOT_ENABLED" | "LOST_OWNERSHIP";
  emailErrorCode?: string;
}

export type EnsureCanonicalPdfDeps = Pick<
  SendInvoiceDeps,
  "renderPdf" | "supabaseAdmin"
>;

export async function ensureCanonicalPdf(
  db: Db,
  organizationId: string,
  invoiceId: string,
  deps: EnsureCanonicalPdfDeps
): Promise<{ pdfObjectKey: string; pdfSha256: string }> {
  return db.transaction(async (tx) => {
    // FOR UPDATE: serializes concurrent PDF generation for the same invoice.
    // While holding a DB transaction open across external I/O (PDF render + upload)
    // is generally avoided for frequently-raced hot paths, canonical PDF generation
    // is a rare, one-time-per-invoice-version operation (canonical/immutable).
    // Holding the lock ensures a second concurrent caller waits and then re-reads the
    // already-persisted canonical metadata, guaranteeing uploaded bytes and persisted
    // sha256 never diverge across concurrent callers. Matches established precedent in
    // generateInvoice.
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);

    if (!invoice) {
      throw new NotFoundError("Invoice not found");
    }

    if (invoice.pdfObjectKey && invoice.pdfSha256) {
      return {
        pdfObjectKey: invoice.pdfObjectKey,
        pdfSha256: invoice.pdfSha256,
      };
    }

    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.invoiceId, invoiceId),
          eq(invoiceLines.organizationId, organizationId)
        )
      )
      .orderBy(invoiceLines.sortOrder);

    const html = renderInvoiceHtml(invoice, lines);
    const pdfBytes = await deps.renderPdf(html);
    const pdfSha256 = await sha256Hex(pdfBytes);
    const [year, month] = invoice.issueDate.split("-").map(Number);
    const pdfObjectKey = invoicePdfObjectKey(
      organizationId,
      year,
      month,
      invoiceId,
      invoice.version
    );
    await uploadInvoicePdf(deps.supabaseAdmin, pdfObjectKey, pdfBytes);
    await tx
      .update(invoices)
      .set({ pdfObjectKey, pdfSha256 })
      .where(eq(invoices.id, invoiceId));
    return { pdfObjectKey, pdfSha256 };
  });
}

async function deliver(
  db: Db,
  organizationId: string,
  invoiceId: string,
  deps: SendInvoiceDeps,
  actorUserId: string | null,
  attemptId: string
): Promise<DeliverResult> {
  const { invoice } = await getInvoice(db, organizationId, invoiceId);
  const [period] = await db
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.id, invoice.periodId))
    .limit(1);
  const recipient = invoice.recipientSnapshot as {
    billingEmail?: string | null;
    invoiceByEmail?: boolean;
    invoiceByPaper?: boolean;
  };
  const issuer = invoice.issuerSnapshot as { name?: string };
  // A snapshot taken before per-dwelling delivery preferences existed has
  // neither key -- treat it as the email-only behavior that was the only
  // option back then, not as "no delivery method".
  const invoiceByEmail = recipient.invoiceByEmail ?? true;

  let emailOutcome: DeliverResult["emailOutcome"] = "NOT_ENABLED";
  let emailErrorCode: string | undefined;

  // A missing billing email is known locally before any dispatch is
  // attempted -- callers (sendInvoice/resendInvoice) reject it upfront as a
  // clean validation error rather than reaching here, so scheduler-driven
  // sends skip safely (toSafeSkipReason) instead of fabricating a FAILED
  // provider delivery for a condition the provider was never even asked
  // about. This branch stays defensive only.
  if (invoiceByEmail && recipient.billingEmail) {
    // Spec Section 24: "expiration configurable" -- 90 days is the
    // default policy; each delivery attempt (including a resend) gets
    // its own token with a fresh expiry, rather than a single token
    // that outlives the resident's practical need to view/download
    // this invoice.
    const TOKEN_TTL_DAYS = 90;
    const tokenExpiresAt = new Date(
      Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
    );
    const rawToken = await createInvoiceAccessToken(
      db,
      organizationId,
      invoiceId,
      deps.tokenSecret,
      tokenExpiresAt,
      actorUserId
    );

    // CAS CLAIMED -> DISPATCHING as close to the provider call as this
    // function's own preparation work allows -- everything above (PDF via
    // the caller, period lookup, token creation) is local DB work that
    // doesn't risk an ambiguous provider outcome, so DISPATCHING only
    // begins immediately before the actual network call. A tiny
    // process-crash window between this write and the request below is
    // unavoidable and conservatively resolves to UNKNOWN on staleness --
    // this only minimizes it, never eliminates it.
    const dispatching = await markDispatching(
      db,
      attemptId,
      organizationId,
      invoiceId
    );
    if (!dispatching) {
      // Lost ownership: another worker already moved this attempt to a
      // terminal state (e.g. a stale-attempt reconciler ran concurrently).
      // Must not call the provider without exclusive ownership of an
      // active attempt.
      return { emailOutcome: "LOST_OWNERSHIP" };
    }

    const result = await deps.emailService.sendInvoice({
      to: recipient.billingEmail,
      organizationName: issuer.name ?? "",
      periodLabel: period
        ? `${period.year}-${String(period.month).padStart(2, "0")}`
        : "",
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.amountDue,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      viewInvoiceUrl: `${deps.appBaseUrl}/invoice/access/${rawToken}`,
      portalUrl: `${deps.appBaseUrl}/portal`,
    });

    let status: "SENT" | "FAILED" | "UNKNOWN";
    if (result.success) {
      status = "SENT";
      emailOutcome = "SENT";
    } else if (result.failureClassification === "DEFINITIVE") {
      status = "FAILED";
      emailOutcome = "FAILED";
      emailErrorCode = result.errorCode;
    } else if (result.failureClassification === "AMBIGUOUS") {
      status = "UNKNOWN";
      emailOutcome = "UNKNOWN";
      emailErrorCode = result.errorCode;
    } else {
      // Defensive: if failureClassification is somehow missing/undefined on a failure,
      // treat as UNKNOWN (the conservative choice to avoid unsafe retries).
      status = "UNKNOWN";
      emailOutcome = "UNKNOWN";
      emailErrorCode = result.errorCode;
    }

    await db.insert(invoiceDeliveries).values({
      organizationId,
      invoiceId,
      attemptId,
      method: "EMAIL",
      destinationEmail: recipient.billingEmail,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      status,
      errorCode: result.errorCode,
      sentAt: result.success ? new Date() : null,
    });
  }

  return {
    emailOutcome,
    ...(emailErrorCode ? { emailErrorCode } : {}),
  };
}

const UNCONFIRMED_DELIVERY_ERROR_MESSAGE =
  "The previous delivery attempt's outcome could not be confirmed. Verify whether the invoice was actually delivered, then use Resend if it needs to go out again.";

/**
 * Atomically marks a non-first-transition terminal attempt outcome
 * (FAILED/UNKNOWN/a redundant SENT) AND records its corresponding audit
 * event in one transaction. Without this, a crash between the two
 * statements can leave a confirmed/failed/ambiguous outcome persisted with
 * no matching audit trail.
 */
async function markAttemptTerminalWithAudit(
  db: Db,
  attemptId: string,
  targetStatus: "SENT" | "FAILED" | "UNKNOWN",
  errorCode: string | undefined,
  audit: {
    organizationId: string;
    actorUserId: string | null;
    action: string;
    invoiceId: string;
  }
): Promise<void> {
  await db.transaction(async (tx) => {
    if (targetStatus === "SENT") {
      await markSent(tx, attemptId);
    } else if (targetStatus === "FAILED") {
      await markFailed(tx, attemptId, errorCode ?? "DELIVERY_FAILED");
    } else {
      await markUnknown(tx, attemptId, errorCode ?? "DELIVERY_OUTCOME_UNKNOWN");
    }
    await recordAuditEvent(tx, {
      organizationId: audit.organizationId,
      actorUserId: audit.actorUserId,
      action: audit.action,
      entityType: "invoice",
      entityId: audit.invoiceId,
    });
  });
}

const CONCURRENT_WAIT_MS = 10_000;
const CONCURRENT_POLL_INTERVAL_MS = 25;

/**
 * Waits (bounded) for an attempt already owned by another caller to leave
 * CLAIMED/DISPATCHING, then returns the authoritative invoice -- used when
 * this call recognizes itself as a replay of an already-claimed command
 * (DUPLICATE_COMMAND) rather than a fresh dispatch.
 */
async function waitForAttemptSettlement(
  db: Db,
  organizationId: string,
  invoiceId: string,
  attemptId: string
): Promise<typeof invoices.$inferSelect> {
  const deadline = Date.now() + CONCURRENT_WAIT_MS;
  while (Date.now() < deadline) {
    const [att] = await db
      .select({ status: invoiceSendAttempts.status })
      .from(invoiceSendAttempts)
      .where(eq(invoiceSendAttempts.id, attemptId))
      .limit(1);
    if (att && att.status !== "CLAIMED" && att.status !== "DISPATCHING") {
      break;
    }
    await new Promise((r) => setTimeout(r, CONCURRENT_POLL_INTERVAL_MS));
  }
  return (await getInvoice(db, organizationId, invoiceId)).invoice;
}

/**
 * Waits (bounded) for a genuinely live in-flight attempt to settle --
 * "genuinely live" meaning reconcileAttemptForInvoice already checked and
 * found it not yet stale, so this is a real concurrent dispatch rather than
 * a crashed worker. Shared by sendInvoice and resendInvoice's claim loops.
 *
 * Resolves `{ retry: true }` if the attempt settles to FAILED (caller
 * should loop back and claim fresh); resolves `{ retry: false, invoice }`
 * if it settles to SENT or the wait window is exceeded (return current
 * state rather than starting a second provider call); throws on UNKNOWN,
 * matching the never-auto-retry policy.
 */
async function waitForLiveAttemptOrRetry(
  db: Db,
  organizationId: string,
  invoiceId: string,
  attemptId: string
): Promise<
  { retry: true } | { retry: false; invoice: typeof invoices.$inferSelect }
> {
  const deadline = Date.now() + CONCURRENT_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CONCURRENT_POLL_INTERVAL_MS));
    const { invoice: latest } = await getInvoice(db, organizationId, invoiceId);
    if (latest.sentAt) {
      return { retry: false, invoice: latest };
    }
    const [att] = await db
      .select({ status: invoiceSendAttempts.status })
      .from(invoiceSendAttempts)
      .where(eq(invoiceSendAttempts.id, attemptId))
      .limit(1);
    if (att?.status === "SENT") {
      return {
        retry: false,
        invoice: (await getInvoice(db, organizationId, invoiceId)).invoice,
      };
    }
    if (att?.status === "UNKNOWN") {
      throw new ConflictError(UNCONFIRMED_DELIVERY_ERROR_MESSAGE);
    }
    if (att?.status === "FAILED") {
      return { retry: true };
    }
  }
  // Exceeded wait window: return current invoice unchanged without starting
  // a second provider call.
  return {
    retry: false,
    invoice: (await getInvoice(db, organizationId, invoiceId)).invoice,
  };
}

interface FinalizeInvoiceSentParams {
  organizationId: string;
  invoiceId: string;
  billingCaseId: string;
  actorUserId: string | null;
  attemptId?: string;
  attemptTargetStatus?: "SENT" | "FAILED" | "UNKNOWN";
  attemptErrorCode?: string | null;
  expectedAttemptStatus?: InvoiceSendAttemptStatus;
}

export interface FinalizeInvoiceSentResult {
  invoice: typeof invoices.$inferSelect;
  wasFirstTransition: boolean;
}

/**
 * The actual finalization work, assuming the caller already holds an open
 * transaction (and, for atomicity guarantees to mean anything, has already
 * locked the relevant invoice row within it). Marks attempt status if
 * provided, sets invoices.sentAt = now() (guarded by WHERE sent_at IS
 * NULL), sets billingCases.status = 'SENT', and records an INVOICE_SENT
 * audit event only if this invocation won the first transition. Extracted
 * so recordPaperDispatch can run its own insert + this finalization as ONE
 * atomic transaction (no crash window between them), while
 * finalizeInvoiceSent below still gives electronic callers a
 * self-contained version that opens its own transaction.
 */
async function finalizeInvoiceSentInTx(
  tx: Tx,
  params: FinalizeInvoiceSentParams
): Promise<FinalizeInvoiceSentResult> {
  let wasFirstTransition = false;
  let updatedInvoice: typeof invoices.$inferSelect | undefined;

  if (params.attemptId && params.attemptTargetStatus) {
    if (params.expectedAttemptStatus) {
      const transitioned = await tx
        .update(invoiceSendAttempts)
        .set({
          status: params.attemptTargetStatus,
          errorCode: params.attemptErrorCode ?? null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(invoiceSendAttempts.id, params.attemptId),
            eq(invoiceSendAttempts.status, params.expectedAttemptStatus)
          )
        )
        .returning({ id: invoiceSendAttempts.id });

      if (transitioned.length === 0) {
        // Another worker already moved this attempt off expectedStatus
        // before our CAS ran (e.g. a concurrent reconciler demoted a stale
        // DISPATCHING attempt to UNKNOWN in the same narrow window this
        // caller independently found confirmed SENT delivery evidence for
        // it). The sentAt CAS below is an INDEPENDENT guarantee on a
        // different row, so exactly one caller still wins the first
        // invoices.sentAt transition regardless -- but the attempt row
        // itself can be left contradicting its own linked evidence
        // (UNKNOWN/FAILED while a delivery row proves SENT), which is a
        // real inconsistency, not just cosmetic.
        //
        // Reconcile it: only ever forward-correct toward the caller's
        // OWN attemptTargetStatus, and only when that target is SENT --
        // reaching this code path at all already means the caller (see
        // reconcileAttemptForInvoice's hasConfirmedSent branch) has
        // independently verified a SENT delivery row exists for this
        // attempt. Never force FROM an already-SENT row (no-op, someone
        // else already agrees) and never force FROM CLAIMED/DISPATCHING
        // (another process may still actively own it -- forcing it to a
        // terminal state here would be a genuine ownership violation).
        if (params.attemptTargetStatus === "SENT") {
          const [current] = await tx
            .select({ status: invoiceSendAttempts.status })
            .from(invoiceSendAttempts)
            .where(eq(invoiceSendAttempts.id, params.attemptId))
            .limit(1);
          if (
            current &&
            (current.status === "UNKNOWN" || current.status === "FAILED")
          ) {
            await tx
              .update(invoiceSendAttempts)
              .set({
                status: "SENT",
                errorCode: null,
                completedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(invoiceSendAttempts.id, params.attemptId),
                  eq(invoiceSendAttempts.status, current.status)
                )
              );
          }
        }
      }
    } else {
      if (params.attemptTargetStatus === "SENT") {
        await markSent(tx, params.attemptId);
      } else if (params.attemptTargetStatus === "UNKNOWN") {
        await markUnknown(
          tx,
          params.attemptId,
          params.attemptErrorCode ?? "DELIVERY_OUTCOME_UNKNOWN"
        );
      } else if (params.attemptTargetStatus === "FAILED") {
        await markFailed(
          tx,
          params.attemptId,
          params.attemptErrorCode ?? "DELIVERY_FAILED"
        );
      }
    }
  }

  const [inv] = await tx
    .update(invoices)
    .set({ sentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.id, params.invoiceId), isNull(invoices.sentAt)))
    .returning();

  if (inv) {
    wasFirstTransition = true;
    updatedInvoice = inv;

    await tx
      .update(billingCases)
      .set({ status: "SENT", statusUpdatedAt: new Date() })
      .where(eq(billingCases.id, params.billingCaseId));

    await recordAuditEvent(tx, {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      action: "INVOICE_SENT",
      entityType: "invoice",
      entityId: params.invoiceId,
      afterData: updatedInvoice,
    });
  } else {
    const [current] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, params.invoiceId))
      .limit(1);
    updatedInvoice = current;
  }

  return {
    invoice: updatedInvoice!,
    wasFirstTransition,
  };
}

async function finalizeInvoiceSent(
  db: Db,
  params: FinalizeInvoiceSentParams
): Promise<FinalizeInvoiceSentResult> {
  const result = await db.transaction((tx) =>
    finalizeInvoiceSentInTx(tx, params)
  );

  const { invoice: authoritativeInvoice } = await getInvoice(
    db,
    params.organizationId,
    params.invoiceId
  );

  return {
    invoice: authoritativeInvoice,
    wasFirstTransition: result.wasFirstTransition,
  };
}

/**
 * Reconciles stale CLAIMED or DISPATCHING attempts within the invoice domain.
 *
 * If a DISPATCHING attempt has exceeded the staleness threshold, but the
 * EMAIL invoice_deliveries row linked to that attempt already shows a
 * confirmed SENT outcome (e.g. worker crashed after the delivery insert but
 * before the finalization transaction), completes the finalization rather
 * than falsely demoting to UNKNOWN. PAPER delivery is never considered here
 * -- manual PAPER dispatch is a separate, unattempted-linked channel (see
 * recordPaperDispatch), so it can never be this electronic attempt's own
 * evidence.
 */
async function reconcileAttemptForInvoice(
  db: Db,
  organizationId: string,
  invoiceId: string,
  billingCaseId: string,
  attempt: InvoiceSendAttempt,
  actorUserId: string | null
): Promise<
  | { action: "RETRY_CLAIM" }
  | { action: "FINALIZED"; invoice: typeof invoices.$inferSelect }
  | { action: "THROW_UNKNOWN" }
  | { action: "IN_FLIGHT"; attempt: InvoiceSendAttempt }
> {
  const [current] = await db
    .select()
    .from(invoiceSendAttempts)
    .where(eq(invoiceSendAttempts.id, attempt.id))
    .limit(1);

  const row = current ?? attempt;
  const classification = classifyAttemptStaleness(
    row.status,
    row.claimedAt,
    row.dispatchStartedAt
  );

  if (!classification.isStale) {
    return { action: "IN_FLIGHT", attempt: row };
  }

  if (classification.targetStatus === "FAILED") {
    const reconciled = await reconcileStaleAttempt(db, row);
    if (reconciled.status === "FAILED") {
      return { action: "RETRY_CLAIM" };
    }
    return { action: "IN_FLIGHT", attempt: reconciled };
  }

  // targetStatus is UNKNOWN (stale DISPATCHING). This attempt is an
  // ELECTRONIC (invoice_send_attempts) attempt, so only an EMAIL delivery
  // row can ever legitimately prove IT was confirmed -- manual PAPER
  // dispatch always sets attemptId: null (recordPaperDispatch never links
  // to an electronic attempt), so a PAPER row should never be able to
  // satisfy this check. Scoped to method='EMAIL' explicitly (rather than
  // "any linked row with status SENT") so a legacy/pre-refactor PAPER row
  // that might still carry a non-null attemptId from the old auto-success
  // era can never masquerade as confirmed evidence for an electronic
  // attempt -- the same reasoning that made isInitialPaperDispatch
  // unverified-by-default for old rows applies here too.
  const deliveries = await db
    .select()
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.attemptId, row.id),
        eq(invoiceDeliveries.organizationId, organizationId)
      )
    );

  const emailDelivery = deliveries.find((d) => d.method === "EMAIL");

  if (emailDelivery?.status === "SENT") {
    const { invoice: sentInvoice, wasFirstTransition } =
      await finalizeInvoiceSent(db, {
        organizationId,
        invoiceId,
        billingCaseId,
        actorUserId,
        attemptId: row.id,
        attemptTargetStatus: "SENT",
        attemptErrorCode: null,
        expectedAttemptStatus: "DISPATCHING",
      });

    // Not the first transition: the invoice was already sent through
    // another channel (e.g. PAPER) before this stale attempt's confirmed
    // EMAIL evidence was reconciled. Record it as a resend completion
    // rather than silently reconciling with no audit trail at all.
    if (!wasFirstTransition) {
      await recordAuditEvent(db, {
        organizationId,
        actorUserId,
        action: "INVOICE_RESENT",
        entityType: "invoice",
        entityId: invoiceId,
      });
    }

    return { action: "FINALIZED", invoice: sentInvoice };
  }

  if (emailDelivery?.status === "FAILED") {
    // Definitive failure evidence already exists (e.g. the Worker crashed
    // after deliver() inserted the FAILED delivery row but before its own
    // markFailed() call ran). We have definitive proof, not ambiguity --
    // reconcile to FAILED (safely retryable) rather than the more
    // conservative UNKNOWN, which would otherwise misclassify a known
    // outcome as needing manual judgment.
    const reconciled = await markFailedConditional(
      db,
      row.id,
      emailDelivery.errorCode ?? "DELIVERY_FAILED",
      "DISPATCHING"
    );
    if (reconciled?.status === "FAILED") {
      return { action: "RETRY_CLAIM" };
    }
    const [fresh] = await db
      .select()
      .from(invoiceSendAttempts)
      .where(eq(invoiceSendAttempts.id, row.id))
      .limit(1);
    return { action: "IN_FLIGHT", attempt: fresh ?? row };
  }

  // emailDelivery is UNKNOWN, or no EMAIL delivery row exists at all:
  // conservatively demote to UNKNOWN.
  const reconciled = await reconcileStaleAttempt(db, row);
  if (reconciled.status === "UNKNOWN") {
    return { action: "THROW_UNKNOWN" };
  }

  return { action: "IN_FLIGHT", attempt: reconciled };
}

// INV-006. A no-op (idempotent) once the invoice has already been sent --
// callers that just want "make sure this went out" can call this safely
// without an extra existence check.
export async function sendInvoice(
  db: Db,
  organizationId: string,
  invoiceId: string,
  deps: SendInvoiceDeps,
  actorUserId: string | null
) {
  // 1. Fetch invoice
  const { invoice } = await getInvoice(db, organizationId, invoiceId);

  // 2. Business fact check: "already sent" for the purpose of a FIRST EMAIL
  // send means the EMAIL channel's own history already has a SENT attempt
  // -- NOT invoice.sentAt, which a manual PAPER dispatch can set on its own
  // while EMAIL has never been attempted at all (independent channels). A
  // fast, unlocked read here is just an optimization; claimSendCommand's
  // locked re-read below is the actual authority.
  const latestAttempt = await getLatestSendAttempt(
    db,
    organizationId,
    invoiceId
  );
  if (latestAttempt?.status === "SENT") {
    return invoice;
  }

  // 3. Validation: PREPARED, or a later status a different delivery channel
  // (PAPER) already advanced it to while EMAIL is still untried.
  const [billingCase] = await db
    .select()
    .from(billingCases)
    .where(eq(billingCases.id, invoice.billingCaseId))
    .limit(1);
  if (
    !billingCase ||
    !(FIRST_DELIVERY_ELIGIBLE_CASE_STATUSES as readonly string[]).includes(
      billingCase.status
    )
  ) {
    throw new ConflictError(
      `Cannot send an invoice in ${billingCase?.status ?? "unknown"} status`
    );
  }

  // Validate dwelling has electronic delivery enabled and reachable before
  // ever claiming an attempt -- both are known locally, before any dispatch,
  // so they're rejected as plain validation errors rather than consuming an
  // attempt/producing a misleading FAILED delivery row. This is what lets
  // the scheduler's bulkSendInvoices catch-and-skip cleanly skip a
  // PAPER-only or no-usable-email invoice with zero provider calls and zero
  // delivery rows.
  const recipient = invoice.recipientSnapshot as {
    billingEmail?: string | null;
    invoiceByEmail?: boolean;
    invoiceByPaper?: boolean;
  };
  const invoiceByEmail = recipient.invoiceByEmail ?? true;
  // An attempt already CLAIMED/DISPATCHING must still be reconcilable even
  // if the dwelling's preference has since changed (or was seeded before
  // this preference existed) -- only reject outright when there is no
  // active attempt to fall through and reconcile.
  const hasActiveAttempt =
    latestAttempt?.status === "CLAIMED" ||
    latestAttempt?.status === "DISPATCHING";
  if (!invoiceByEmail && !hasActiveAttempt) {
    throw new ConflictError(
      "This dwelling has no electronic delivery method enabled; use Record paper dispatch instead."
    );
  }
  if (invoiceByEmail && !recipient.billingEmail) {
    throw new ConflictError(
      "Invoice email is missing. Add a billing email before sending."
    );
  }

  // 4. Atomic command claim loop (see claimSendCommand: the invoice row
  // lock closes the late-claim race where a loser re-checking for an active
  // attempt AFTER the winner already went terminal could otherwise start a
  // second, duplicate dispatch; it also re-validates case eligibility and
  // the EMAIL channel's own SENT status under the same lock).
  let attempt: InvoiceSendAttempt;

  while (true) {
    const claim = await claimSendCommand(
      db,
      organizationId,
      invoiceId,
      "FIRST_SEND"
    );

    if (claim.outcome === "CLAIMED") {
      attempt = claim.attempt;
      break;
    }
    if (claim.outcome === "ALREADY_SENT") {
      return claim.invoice;
    }
    if (claim.outcome === "UNKNOWN_BLOCKS_SEND") {
      throw new ConflictError(UNCONFIRMED_DELIVERY_ERROR_MESSAGE);
    }
    if (claim.outcome === "INELIGIBLE_CASE_STATUS") {
      throw new ConflictError(
        `Cannot send an invoice in ${claim.caseStatus ?? "unknown"} status`
      );
    }

    // IN_FLIGHT: a CLAIMED/DISPATCHING attempt genuinely exists right now.
    // Check whether it's actually stale (a crashed worker) before waiting
    // on it as if it were a live, healthy dispatch.
    const existingAttempt = claim.attempt;
    const outcome = await reconcileAttemptForInvoice(
      db,
      organizationId,
      invoiceId,
      billingCase.id,
      existingAttempt,
      actorUserId
    );

    if (outcome.action === "RETRY_CLAIM") {
      continue;
    }
    if (outcome.action === "FINALIZED") {
      return outcome.invoice;
    }
    if (outcome.action === "THROW_UNKNOWN") {
      throw new ConflictError(UNCONFIRMED_DELIVERY_ERROR_MESSAGE);
    }

    // Reconciled status is unchanged: a genuine concurrent in-flight caller
    // owns this attempt. Wait briefly for it to settle so concurrent
    // callers converge without attempting conflicting claims.
    const settlement = await waitForLiveAttemptOrRetry(
      db,
      organizationId,
      invoiceId,
      existingAttempt.id
    );
    if (settlement.retry) {
      continue;
    }
    return settlement.invoice;
  }

  // 5. We now own a fresh CLAIMED attempt.
  // Note: any genuinely unexpected error (e.g. DB error, PDF rendering error)
  // is left to bubble up without catching/marking failed; the attempt row is left as-is so
  // a later call's reconcileStaleAttempt can classify it once it exceeds staleness thresholds.
  // deliver() itself performs the CLAIMED->DISPATCHING CAS immediately
  // before the provider call (see deliver()'s own comment).
  await ensureCanonicalPdf(db, organizationId, invoiceId, deps);
  const deliverResult = await deliver(
    db,
    organizationId,
    invoiceId,
    deps,
    actorUserId,
    attempt.id
  );

  if (deliverResult.emailOutcome === "LOST_OWNERSHIP") {
    // Another worker already moved this attempt off CLAIMED before we
    // reached the provider boundary; the provider was never called. Return
    // current authoritative state rather than writing anything further to
    // an attempt we no longer own.
    return (await getInvoice(db, organizationId, invoiceId)).invoice;
  }

  const overallConfirmed = deliverResult.emailOutcome === "SENT";
  const overallDefinitivelyFailed =
    !overallConfirmed && deliverResult.emailOutcome !== "UNKNOWN";
  const overallUnknown =
    !overallConfirmed && deliverResult.emailOutcome === "UNKNOWN";

  if (overallConfirmed) {
    const { invoice: sentInvoice, wasFirstTransition } =
      await finalizeInvoiceSent(db, {
        organizationId,
        invoiceId,
        billingCaseId: billingCase.id,
        actorUserId,
        attemptId: attempt.id,
        attemptTargetStatus: "SENT",
        attemptErrorCode: null,
      });
    // Not the first transition: invoice.sentAt was already set before this
    // dispatch (e.g. by an earlier successful EMAIL send, or by PAPER) --
    // this call reached sendInvoice's claim loop because the latest EMAIL
    // attempt wasn't itself SENT (a FAILED retry, reconciled here). Record
    // it as an explicit resend, not a silent no-op with no audit trail.
    if (!wasFirstTransition) {
      await recordAuditEvent(db, {
        organizationId,
        actorUserId,
        action: "INVOICE_RESENT",
        entityType: "invoice",
        entityId: invoiceId,
      });
    }
    return sentInvoice;
  } else if (overallDefinitivelyFailed) {
    await markAttemptTerminalWithAudit(
      db,
      attempt.id,
      "FAILED",
      deliverResult.emailErrorCode,
      {
        organizationId,
        actorUserId,
        action: "INVOICE_SEND_FAILED",
        invoiceId,
      }
    );
    return (await getInvoice(db, organizationId, invoiceId)).invoice;
  } else if (overallUnknown) {
    await markAttemptTerminalWithAudit(
      db,
      attempt.id,
      "UNKNOWN",
      deliverResult.emailErrorCode,
      {
        organizationId,
        actorUserId,
        action: "INVOICE_SEND_UNKNOWN",
        invoiceId,
      }
    );
    return (await getInvoice(db, organizationId, invoiceId)).invoice;
  }

  return (await getInvoice(db, organizationId, invoiceId)).invoice;
}

export interface BulkSendResult {
  sent: string[];
  skipped: { invoiceId: string; reason: string }[];
}

// Spec Section 27: workbench "bulk selection" -- sends whichever
// admin-selected invoices are eligible (PREPARED and not yet sent), same
// one-failure-does-not-block-the-rest pattern as bulkGenerateInvoices.
// Reuses sendInvoice, so a failed provider delivery for one invoice still
// leaves it PREPARED/retryable rather than aborting the rest of the batch.
export async function bulkSendInvoices(
  db: Db,
  organizationId: string,
  invoiceIds: string[],
  deps: SendInvoiceDeps,
  actorUserId: string | null
): Promise<BulkSendResult> {
  const result: BulkSendResult = { sent: [], skipped: [] };
  for (const invoiceId of invoiceIds) {
    try {
      // sendInvoice is idempotent (a no-op returning the already-sent
      // invoice) -- checked here first so an already-sent/paid invoice in
      // the selection is reported as skipped, not double-counted as a
      // fresh send.
      const { invoice: before } = await getInvoice(
        db,
        organizationId,
        invoiceId
      );
      if (before.sentAt) {
        result.skipped.push({ invoiceId, reason: "Already sent" });
        continue;
      }
      const sent = await sendInvoice(
        db,
        organizationId,
        invoiceId,
        deps,
        actorUserId
      );
      if (sent.sentAt) {
        result.sent.push(invoiceId);
      } else {
        result.skipped.push({ invoiceId, reason: "Delivery failed" });
      }
    } catch (err) {
      result.skipped.push({
        invoiceId,
        reason: toSafeSkipReason(err),
      });
    }
  }
  return result;
}

// Spec Section 23: "explicit resend creates a new delivery attempt" --
// unlike sendInvoice, this always attempts delivery again.
// If sentAt was not yet set (e.g. recovering from a prior UNKNOWN attempt),
// a successful resend finalizes the invoice (sentAt and billing case SENT).
export async function resendInvoice(
  db: Db,
  organizationId: string,
  invoiceId: string,
  deps: SendInvoiceDeps,
  actorUserId: string,
  commandId: string | null = null
) {
  const { invoice } = await getInvoice(db, organizationId, invoiceId);
  const wasAlreadySent = !!invoice.sentAt;

  // Electronic-only check: if dwelling has no email enabled, reject immediately
  const recipient = invoice.recipientSnapshot as {
    billingEmail?: string | null;
    invoiceByEmail?: boolean;
    invoiceByPaper?: boolean;
  };
  const invoiceByEmail = recipient.invoiceByEmail ?? true;
  if (!invoiceByEmail) {
    throw new ConflictError(
      "This dwelling has no electronic delivery method enabled; use Record paper dispatch instead."
    );
  }
  if (!recipient.billingEmail) {
    throw new ConflictError(
      "Invoice email is missing. Add a billing email before resending."
    );
  }

  // Resend requires prior EMAIL-channel history specifically -- checked
  // regardless of overall wasAlreadySent, since a PAPER dispatch can set
  // invoice.sentAt while EMAIL has never been attempted at all (independent
  // channels: a PAPER delivery row must never satisfy "this was resent by
  // email before"). Also covers pre-migration historical failures that
  // have an invoice_deliveries row but no invoice_send_attempts row.
  const [hasEmailDelivery] = await db
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.invoiceId, invoiceId),
        eq(invoiceDeliveries.organizationId, organizationId),
        eq(invoiceDeliveries.method, "EMAIL")
      )
    )
    .limit(1);

  if (!hasEmailDelivery) {
    const latestAttempt = await getLatestSendAttempt(
      db,
      organizationId,
      invoiceId
    );
    if (!latestAttempt) {
      throw new ConflictError(
        "This invoice has not been sent by email yet; use Send instead."
      );
    }
  }

  // Atomic command claim loop (see claimSendCommand). commandId correlates
  // this call back to the specific Resend form submission -- a concurrent
  // replay of the SAME submission (double-click, browser retry) is
  // recognized as DUPLICATE_COMMAND and converges on the one real
  // dispatch's outcome rather than triggering a second one; a genuinely
  // later, separate click gets a fresh commandId and is free to resend
  // again once this one is no longer in flight.
  //
  // IN_FLIGHT is reconciled the same way sendInvoice's claim loop does
  // (reconcileAttemptForInvoice), not treated as permanently blocking: a
  // crashed Worker that died right after claiming a resend (or after
  // dispatching, before finalizing) must not leave the invoice stuck
  // showing "Sending in progress..." forever with no way to recover it.
  let attempt: InvoiceSendAttempt;

  while (true) {
    const claim = await claimSendCommand(
      db,
      organizationId,
      invoiceId,
      "RESEND",
      commandId
    );

    if (claim.outcome === "CLAIMED") {
      attempt = claim.attempt;
      break;
    }
    if (claim.outcome === "DUPLICATE_COMMAND") {
      return waitForAttemptSettlement(
        db,
        organizationId,
        invoiceId,
        claim.attempt.id
      );
    }
    if (claim.outcome !== "IN_FLIGHT") {
      // ALREADY_SENT / UNKNOWN_BLOCKS_SEND / INELIGIBLE_CASE_STATUS are
      // FIRST_SEND-only outcomes, never returned for mode "RESEND".
      throw new ConflictError(
        "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending."
      );
    }

    // IN_FLIGHT: check whether it's actually stale (a crashed worker)
    // before treating it as a live, healthy dispatch that must simply be
    // waited out.
    const existingAttempt = claim.attempt;
    const outcome = await reconcileAttemptForInvoice(
      db,
      organizationId,
      invoiceId,
      invoice.billingCaseId,
      existingAttempt,
      actorUserId
    );

    if (outcome.action === "RETRY_CLAIM") {
      continue;
    }
    if (outcome.action === "FINALIZED") {
      // The stale attempt already had confirmed EMAIL delivery evidence --
      // this resend converges on that outcome rather than dispatching again.
      return outcome.invoice;
    }
    if (outcome.action === "THROW_UNKNOWN") {
      throw new ConflictError(UNCONFIRMED_DELIVERY_ERROR_MESSAGE);
    }

    // Reconciled status is unchanged: this is a genuinely LIVE attempt (not
    // stale), so unlike sendInvoice's idempotent "just make sure it's
    // sent" semantics, resendInvoice is an explicit admin action -- fail
    // fast with a clear message rather than silently waiting up to
    // CONCURRENT_WAIT_MS for a response.
    throw new ConflictError(
      "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending."
    );
  }

  // deliver() itself performs the CLAIMED->DISPATCHING CAS immediately
  // before the provider call.
  const deliverResult = await deliver(
    db,
    organizationId,
    invoiceId,
    deps,
    actorUserId,
    attempt.id
  );

  if (deliverResult.emailOutcome === "LOST_OWNERSHIP") {
    return (await getInvoice(db, organizationId, invoiceId)).invoice;
  }

  const success = deliverResult.emailOutcome === "SENT";

  // If invoice.sentAt was null when resendInvoice started, AND this resend
  // succeeded, finalize the invoice (sentAt, billing case SENT, audit event INVOICE_SENT).
  if (!wasAlreadySent && success) {
    const { invoice: finalizedInvoice, wasFirstTransition } =
      await finalizeInvoiceSent(db, {
        organizationId,
        invoiceId,
        billingCaseId: invoice.billingCaseId,
        actorUserId,
        attemptId: attempt.id,
        attemptTargetStatus: "SENT",
      });

    // If a concurrent operation already set sentAt, record INVOICE_RESENT instead
    if (!wasFirstTransition) {
      await recordAuditEvent(db, {
        organizationId,
        actorUserId,
        action: "INVOICE_RESENT",
        entityType: "invoice",
        entityId: invoiceId,
      });
    }

    return finalizedInvoice;
  }

  // If invoice.sentAt was already set when resendInvoice started (normal
  // resend), or if resend failed/came back UNKNOWN: mark the attempt's
  // terminal outcome and record the resend audit event atomically, so a
  // crash between the two can never leave one without the other.
  const targetStatus =
    deliverResult.emailOutcome === "SENT"
      ? "SENT"
      : deliverResult.emailOutcome === "UNKNOWN"
        ? "UNKNOWN"
        : "FAILED";
  await markAttemptTerminalWithAudit(
    db,
    attempt.id,
    targetStatus,
    deliverResult.emailErrorCode,
    {
      organizationId,
      actorUserId,
      action: success ? "INVOICE_RESENT" : "INVOICE_RESEND_FAILED",
      invoiceId,
    }
  );
  return (await getInvoice(db, organizationId, invoiceId)).invoice;
}

/**
 * Explicit, idempotent, concurrency-safe manual paper dispatch confirmation.
 *
 * Recording physical dispatch is one atomic local DB business event -- no
 * external I/O is involved, so unlike electronic dispatch there is no
 * reason to split "insert the delivery row" from "finalize sentAt/case/
 * audit" into separate statements. The whole thing (invoice-row lock,
 * initial-PAPER-row insert-or-reconcile, and finalization) runs in ONE
 * transaction, so there is no crash window in which a PAPER row can exist
 * with sentAt still null / case still PREPARED.
 *
 * If a legacy or crashed state already has an initial PAPER row without a
 * completed finalization (sentAt still null), calling this again reconciles
 * it: finalization runs regardless of whether this call just inserted the
 * row or found it already there.
 *
 * Never touches invoice_send_attempts (electronic attempts only). Never
 * rewrites an existing EMAIL attempt/delivery outcome.
 */
export async function recordPaperDispatch(
  db: Db,
  organizationId: string,
  invoiceId: string,
  actorUserId: string
): Promise<typeof invoices.$inferSelect> {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!invoice) {
      throw new NotFoundError("Invoice not found");
    }

    // Locked (invoices-then-billing_cases order, consistent with
    // claimSendCommand) so a concurrent manual case-status override can't
    // race between this read and finalizeInvoiceSentInTx's later write --
    // without the lock, overrideCaseStatus could move the case to DRAFT
    // right after this read, and this transaction would silently overwrite
    // it back to SENT.
    const [billingCase] = await tx
      .select({ status: billingCases.status })
      .from(billingCases)
      .where(eq(billingCases.id, invoice.billingCaseId))
      .for("update")
      .limit(1);
    const caseStatus = billingCase?.status;

    const recipient = invoice.recipientSnapshot as {
      invoiceByPaper?: boolean;
    };
    const invoiceByPaper = recipient.invoiceByPaper ?? false;
    if (!invoiceByPaper) {
      throw new ConflictError(
        "Paper delivery is not enabled for this dwelling"
      );
    }
    if (
      !caseStatus ||
      !(FIRST_DELIVERY_ELIGIBLE_CASE_STATUSES as readonly string[]).includes(
        caseStatus
      )
    ) {
      throw new ConflictError(
        `Cannot record paper dispatch for an invoice in ${caseStatus ?? "unknown"} status`
      );
    }

    const [existingInitialDispatch] = await tx
      .select({ id: invoiceDeliveries.id })
      .from(invoiceDeliveries)
      .where(
        and(
          eq(invoiceDeliveries.invoiceId, invoiceId),
          eq(invoiceDeliveries.isInitialPaperDispatch, true)
        )
      )
      .limit(1);

    if (!existingInitialDispatch) {
      await tx.insert(invoiceDeliveries).values({
        organizationId,
        invoiceId,
        attemptId: null,
        method: "PAPER",
        destinationEmail: null,
        provider: "paper",
        status: "SENT",
        sentAt: new Date(),
        isInitialPaperDispatch: true,
      });
    }

    const { invoice: result } = await finalizeInvoiceSentInTx(tx, {
      organizationId,
      invoiceId,
      billingCaseId: invoice.billingCaseId,
      actorUserId,
    });
    return result;
  });
}
