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
  getLatestSendAttempt,
  markDispatching,
  markFailed,
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
  emailOutcome: "SENT" | "FAILED" | "UNKNOWN" | "NOT_ENABLED";
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
  attemptId: string | null
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

  let emailOutcome: "SENT" | "FAILED" | "UNKNOWN" | "NOT_ENABLED" =
    "NOT_ENABLED";
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

      // Zero rows: another worker already moved this attempt off
      // expectedAttemptStatus (e.g. a concurrent reconciliation of the
      // same stale DISPATCHING attempt already finalized it). Do not
      // overwrite whatever it is now -- never regress an attempt's
      // status. This is safe to leave as a no-op here: the sentAt CAS
      // immediately below is an INDEPENDENT guarantee on a different row,
      // so exactly one caller still wins the first invoices.sentAt
      // transition (and therefore the single INVOICE_SENT audit event)
      // regardless of which caller's attempt-status CAS happened to win.
      void transitioned;
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
 * If a DISPATCHING attempt has exceeded the staleness threshold, but an
 * invoice_deliveries row linked to that attempt already shows a confirmed
 * SENT outcome (e.g. worker crashed after paper/email delivery insert but
 * before finalization transaction), completes the finalization rather than
 * falsely demoting to UNKNOWN.
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

  // targetStatus is UNKNOWN (stale DISPATCHING)
  // Fix 6: Check whether any invoice_deliveries row linked to that attempt_id
  // already shows a confirmed SENT outcome (PAPER always qualifies since it's never ambiguous;
  // EMAIL qualifies too, since if the delivery row says SENT, the email genuinely was confirmed
  // even if the finalization transaction itself never ran).
  const deliveries = await db
    .select()
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.attemptId, row.id),
        eq(invoiceDeliveries.organizationId, organizationId)
      )
    );

  const hasConfirmedSent = deliveries.some((d) => d.status === "SENT");

  if (hasConfirmedSent) {
    let attemptTargetStatus: "SENT" | "UNKNOWN" | "FAILED" = "SENT";
    let attemptErrorCode: string | null = null;

    const emailDelivery = deliveries.find((d) => d.method === "EMAIL");
    if (emailDelivery?.status === "UNKNOWN") {
      attemptTargetStatus = "UNKNOWN";
      attemptErrorCode = emailDelivery.errorCode ?? "DELIVERY_OUTCOME_UNKNOWN";
    } else if (emailDelivery?.status === "FAILED") {
      attemptTargetStatus = "FAILED";
      attemptErrorCode = emailDelivery.errorCode ?? "DELIVERY_FAILED";
    }

    const { invoice: sentInvoice } = await finalizeInvoiceSent(db, {
      organizationId,
      invoiceId,
      billingCaseId,
      actorUserId,
      attemptId: row.id,
      attemptTargetStatus,
      attemptErrorCode,
      expectedAttemptStatus: "DISPATCHING",
    });

    return { action: "FINALIZED", invoice: sentInvoice };
  }

  // No confirmed SENT delivery row: fall through to demoting to UNKNOWN
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

  // 2. Business fact check: already sent is an immediate no-op.
  if (invoice.sentAt) {
    return invoice;
  }

  // 3. Validation: only PREPARED can be sent
  const [billingCase] = await db
    .select()
    .from(billingCases)
    .where(eq(billingCases.id, invoice.billingCaseId))
    .limit(1);
  if (!billingCase || billingCase.status !== "PREPARED") {
    throw new ConflictError("Only a PREPARED invoice can be sent");
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
  const latestAttemptForValidation = invoiceByEmail
    ? null
    : await getLatestSendAttempt(db, organizationId, invoiceId);
  const hasActiveAttempt =
    latestAttemptForValidation?.status === "CLAIMED" ||
    latestAttemptForValidation?.status === "DISPATCHING";
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
  // second, duplicate dispatch).
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
    // owns this attempt. Wait briefly for it to settle via read-only
    // queries so concurrent callers converge without attempting conflicting
    // claims.
    const deadline = Date.now() + CONCURRENT_WAIT_MS;
    let settled = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CONCURRENT_POLL_INTERVAL_MS));
      const { invoice: latest } = await getInvoice(
        db,
        organizationId,
        invoiceId
      );
      if (latest.sentAt) {
        return latest;
      }
      const [att] = await db
        .select({ status: invoiceSendAttempts.status })
        .from(invoiceSendAttempts)
        .where(eq(invoiceSendAttempts.id, existingAttempt.id))
        .limit(1);
      if (att?.status === "SENT") {
        return (await getInvoice(db, organizationId, invoiceId)).invoice;
      }
      if (att?.status === "UNKNOWN") {
        throw new ConflictError(UNCONFIRMED_DELIVERY_ERROR_MESSAGE);
      }
      if (att?.status === "FAILED") {
        settled = true;
        break;
      }
    }

    if (settled) {
      // Previous attempt failed definitively; loop back to claim fresh
      continue;
    }

    // Exceeded wait window: return current invoice unchanged without starting a second provider call
    return (await getInvoice(db, organizationId, invoiceId)).invoice;
  }

  // 5. We now own a fresh CLAIMED attempt.
  // Note: any genuinely unexpected error (e.g. DB error, PDF rendering error)
  // is left to bubble up without catching/marking failed; the attempt row is left as-is so
  // a later call's reconcileStaleAttempt can classify it once it exceeds staleness thresholds.
  await ensureCanonicalPdf(db, organizationId, invoiceId, deps);
  await markDispatching(db, attempt.id);
  const deliverResult = await deliver(
    db,
    organizationId,
    invoiceId,
    deps,
    actorUserId,
    attempt.id
  );

  const overallConfirmed = deliverResult.emailOutcome === "SENT";
  const overallDefinitivelyFailed =
    !overallConfirmed && deliverResult.emailOutcome !== "UNKNOWN";
  const overallUnknown =
    !overallConfirmed && deliverResult.emailOutcome === "UNKNOWN";

  if (overallConfirmed) {
    const { invoice: sentInvoice } = await finalizeInvoiceSent(db, {
      organizationId,
      invoiceId,
      billingCaseId: billingCase.id,
      actorUserId,
      attemptId: attempt.id,
      attemptTargetStatus: "SENT",
      attemptErrorCode: null,
    });
    return sentInvoice;
  } else if (overallDefinitivelyFailed) {
    await markFailed(
      db,
      attempt.id,
      deliverResult.emailErrorCode ?? "DELIVERY_FAILED"
    );
    await recordAuditEvent(db, {
      organizationId,
      actorUserId,
      action: "INVOICE_SEND_FAILED",
      entityType: "invoice",
      entityId: invoiceId,
    });
    return (await getInvoice(db, organizationId, invoiceId)).invoice;
  } else if (overallUnknown) {
    await markUnknown(
      db,
      attempt.id,
      deliverResult.emailErrorCode ?? "DELIVERY_OUTCOME_UNKNOWN"
    );
    await recordAuditEvent(db, {
      organizationId,
      actorUserId,
      action: "INVOICE_SEND_UNKNOWN",
      entityType: "invoice",
      entityId: invoiceId,
    });
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

  if (!wasAlreadySent) {
    // Check whether this invoice has prior delivery history at all
    // (covers pre-migration historical failures that have invoice_deliveries rows
    // but no invoice_send_attempts row, matching the UI condition)
    const [hasDelivery] = await db
      .select({ id: invoiceDeliveries.id })
      .from(invoiceDeliveries)
      .where(
        and(
          eq(invoiceDeliveries.invoiceId, invoiceId),
          eq(invoiceDeliveries.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!hasDelivery) {
      const latestAttempt = await getLatestSendAttempt(
        db,
        organizationId,
        invoiceId
      );
      if (!latestAttempt) {
        throw new ConflictError(
          "This invoice has not been sent yet; send it first"
        );
      }
    }
  }

  // Atomic command claim (see claimSendCommand). commandId correlates this
  // call back to the specific Resend form submission -- a concurrent replay
  // of the SAME submission (double-click, browser retry) is recognized as
  // DUPLICATE_COMMAND and converges on the one real dispatch's outcome
  // rather than triggering a second one; a genuinely later, separate click
  // gets a fresh commandId and is free to resend again once this one is no
  // longer in flight.
  const claim = await claimSendCommand(
    db,
    organizationId,
    invoiceId,
    "RESEND",
    commandId
  );

  if (claim.outcome === "IN_FLIGHT") {
    throw new ConflictError(
      "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending."
    );
  }
  if (claim.outcome === "DUPLICATE_COMMAND") {
    return waitForAttemptSettlement(
      db,
      organizationId,
      invoiceId,
      claim.attempt.id
    );
  }
  // ALREADY_SENT / UNKNOWN_BLOCKS_SEND are FIRST_SEND-only outcomes, never
  // returned for mode "RESEND".
  if (claim.outcome !== "CLAIMED") {
    throw new ConflictError(
      "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending."
    );
  }
  const attempt = claim.attempt;

  await markDispatching(db, attempt.id);

  const deliverResult = await deliver(
    db,
    organizationId,
    invoiceId,
    deps,
    actorUserId,
    attempt.id
  );
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

  if (success) {
    await markSent(db, attempt.id);
  } else if (deliverResult.emailOutcome === "UNKNOWN") {
    await markUnknown(
      db,
      attempt.id,
      deliverResult.emailErrorCode ?? "DELIVERY_OUTCOME_UNKNOWN"
    );
  } else {
    await markFailed(
      db,
      attempt.id,
      deliverResult.emailErrorCode ?? "DELIVERY_FAILED"
    );
  }

  // If invoice.sentAt was already set when resendInvoice started (normal resend),
  // or if resend failed, record resend audit event and return invoice unchanged.
  await recordAuditEvent(db, {
    organizationId,
    actorUserId,
    action: success ? "INVOICE_RESENT" : "INVOICE_RESEND_FAILED",
    entityType: "invoice",
    entityId: invoiceId,
  });
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

    const [billingCase] = await tx
      .select({ status: billingCases.status })
      .from(billingCases)
      .where(eq(billingCases.id, invoice.billingCaseId))
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
      !["PREPARED", "SENT", "PAID", "OVERDUE"].includes(caseStatus)
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
