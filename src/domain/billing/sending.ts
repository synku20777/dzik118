// Phase G (Invoices/delivery) - invoice email sending (spec Section 23,
// INV-006). Two distinct entry points, matching the spec's own wording:
// sendInvoice is the idempotent first send (normally only from PREPARED,
// a no-op if already sent); resendInvoice is the explicit action that
// always creates a new delivery attempt once something has been sent
// before. The canonical PDF (Section 22) is generated exactly once, on
// the first successful send -- a resend reuses the same pdf_object_key/
// pdf_sha256, never regenerates it (Section 21: "canonical PDF
// immutable").
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { billingCases, billingPeriods } from "../../db/schema/billing";
import {
  invoiceDeliveries,
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
  claimSendAttempt,
  classifyAttemptStaleness,
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
  paperOutcome: "SENT" | "NOT_ENABLED";
}

async function ensureCanonicalPdf(
  db: Db,
  organizationId: string,
  invoiceId: string,
  deps: SendInvoiceDeps
): Promise<{ pdfObjectKey: string; pdfSha256: string }> {
  const { invoice, lines } = await getInvoice(db, organizationId, invoiceId);
  if (invoice.pdfObjectKey && invoice.pdfSha256) {
    return { pdfObjectKey: invoice.pdfObjectKey, pdfSha256: invoice.pdfSha256 };
  }
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
  await db
    .update(invoices)
    .set({ pdfObjectKey, pdfSha256 })
    .where(eq(invoices.id, invoiceId));
  return { pdfObjectKey, pdfSha256 };
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
  const invoiceByPaper = recipient.invoiceByPaper ?? false;

  let emailOutcome: "SENT" | "FAILED" | "UNKNOWN" | "NOT_ENABLED" =
    "NOT_ENABLED";
  let emailErrorCode: string | undefined;

  if (invoiceByEmail) {
    if (!recipient.billingEmail) {
      await db.insert(invoiceDeliveries).values({
        organizationId,
        invoiceId,
        attemptId,
        method: "EMAIL",
        destinationEmail: null,
        provider: "none",
        status: "FAILED",
        errorCode: "NO_RECIPIENT_EMAIL",
      });
      emailOutcome = "FAILED";
      emailErrorCode = "NO_RECIPIENT_EMAIL";
    } else {
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
  }

  // No print/mail integration exists (nor was one asked for): the canonical
  // PDF is already generated by ensureCanonicalPdf before deliver() runs, so
  // marking this delivered just records that the admin's next step is to
  // print and hand or mail out that document -- there is nothing else for
  // the system to do, so it's recorded as an immediate success.
  let paperOutcome: "SENT" | "NOT_ENABLED" = "NOT_ENABLED";
  if (invoiceByPaper) {
    await db.insert(invoiceDeliveries).values({
      organizationId,
      invoiceId,
      attemptId,
      method: "PAPER",
      destinationEmail: null,
      provider: "paper",
      status: "SENT",
      sentAt: new Date(),
    });
    paperOutcome = "SENT";
  }

  return {
    emailOutcome,
    ...(emailErrorCode ? { emailErrorCode } : {}),
    paperOutcome,
  };
}

const UNCONFIRMED_DELIVERY_ERROR_MESSAGE =
  "The previous delivery attempt's outcome could not be confirmed. Verify whether the invoice was actually delivered, then use Resend if it needs to go out again.";

const CONCURRENT_WAIT_MS = 10_000;
const CONCURRENT_POLL_INTERVAL_MS = 25;

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

/**
 * Shared atomic finalization transaction: marks attempt status if provided,
 * sets invoices.sentAt = now(), sets billingCases.status = 'SENT',
 * and records an INVOICE_SENT audit event.
 */
async function finalizeInvoiceSent(
  db: Db,
  params: FinalizeInvoiceSentParams
): Promise<typeof invoices.$inferSelect> {
  let updatedInvoice: typeof invoices.$inferSelect | undefined;

  await db.transaction(async (tx) => {
    if (params.attemptId && params.attemptTargetStatus) {
      if (params.expectedAttemptStatus) {
        await tx
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
          );
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
      .where(eq(invoices.id, params.invoiceId))
      .returning();
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
  });

  const { invoice: sentInvoice } = await getInvoice(
    db,
    params.organizationId,
    params.invoiceId
  );
  return sentInvoice;
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

    const sentInvoice = await finalizeInvoiceSent(db, {
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
  // Must run before any attempt-table logic: if EMAIL+PAPER are both enabled and email ends up UNKNOWN
  // while paper succeeds, sentAt WILL be set even though the email attempt itself is UNKNOWN.
  // Checking sentAt first means subsequent calls are fast no-ops rather than throwing ConflictError.
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

  // 4. Concurrency claim loop
  let attempt: InvoiceSendAttempt;

  while (true) {
    const result = await claimSendAttempt(db, organizationId, invoiceId);
    if (result.claimed) {
      attempt = result.attempt;
      break;
    }

    const existingAttempt = result.attempt;
    if (existingAttempt.status === "SENT") {
      let latest = (await getInvoice(db, organizationId, invoiceId)).invoice;
      if (!latest.sentAt) {
        // Narrow timing window: another caller marked SENT on the attempt but hasn't committed
        // sentAt on the invoice yet; wait briefly for finalization transaction to commit.
        await new Promise((r) => setTimeout(r, 20));
        latest = (await getInvoice(db, organizationId, invoiceId)).invoice;
      }
      return latest;
    }

    if (
      existingAttempt.status === "CLAIMED" ||
      existingAttempt.status === "DISPATCHING"
    ) {
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

      // Reconciled status is unchanged or row transitioned concurrently.
      // A genuine concurrent in-flight caller owns this attempt.
      // Wait briefly for the in-flight send to settle via read-only queries so concurrent callers
      // converge on the sent invoice without attempting conflicting inserts on the connection.
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

    if (existingAttempt.status === "UNKNOWN") {
      throw new ConflictError(UNCONFIRMED_DELIVERY_ERROR_MESSAGE);
    }

    // Defensive fallback
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

  const overallConfirmed =
    deliverResult.emailOutcome === "SENT" ||
    deliverResult.paperOutcome === "SENT";
  const overallDefinitivelyFailed =
    !overallConfirmed && deliverResult.emailOutcome !== "UNKNOWN";
  const overallUnknown =
    !overallConfirmed && deliverResult.emailOutcome === "UNKNOWN";

  if (overallConfirmed) {
    const attemptTargetStatus =
      deliverResult.emailOutcome === "SENT"
        ? "SENT"
        : deliverResult.emailOutcome === "UNKNOWN"
          ? "UNKNOWN"
          : deliverResult.emailOutcome === "FAILED"
            ? "FAILED"
            : "SENT";

    const attemptErrorCode =
      deliverResult.emailOutcome === "UNKNOWN"
        ? (deliverResult.emailErrorCode ?? "DELIVERY_OUTCOME_UNKNOWN")
        : deliverResult.emailOutcome === "FAILED"
          ? (deliverResult.emailErrorCode ?? "DELIVERY_FAILED")
          : null;

    return finalizeInvoiceSent(db, {
      organizationId,
      invoiceId,
      billingCaseId: billingCase.id,
      actorUserId,
      attemptId: attempt.id,
      attemptTargetStatus,
      attemptErrorCode,
    });
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
  actorUserId: string
) {
  const { invoice } = await getInvoice(db, organizationId, invoiceId);
  const wasAlreadySent = !!invoice.sentAt;

  if (!wasAlreadySent) {
    // Fix 3: check the invoice's MOST RECENT attempt
    const [latestAttempt] = await db
      .select({
        id: invoiceSendAttempts.id,
        status: invoiceSendAttempts.status,
      })
      .from(invoiceSendAttempts)
      .where(
        and(
          eq(invoiceSendAttempts.invoiceId, invoiceId),
          eq(invoiceSendAttempts.organizationId, organizationId)
        )
      )
      .orderBy(desc(invoiceSendAttempts.createdAt))
      .limit(1);

    // If latest attempt is CLAIMED or DISPATCHING, a send is actively in flight
    if (
      latestAttempt &&
      (latestAttempt.status === "CLAIMED" ||
        latestAttempt.status === "DISPATCHING")
    ) {
      throw new ConflictError(
        "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending."
      );
    }

    // Fix 5: check whether this invoice has prior delivery history at all
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

    if (!hasDelivery && !latestAttempt) {
      throw new ConflictError(
        "This invoice has not been sent yet; send it first"
      );
    }
  }

  const deliverResult = await deliver(
    db,
    organizationId,
    invoiceId,
    deps,
    actorUserId,
    null
  );
  const success =
    deliverResult.emailOutcome === "SENT" ||
    deliverResult.paperOutcome === "SENT";

  // Fix 2: if invoice.sentAt was null when resendInvoice started, AND this resend
  // succeeded, finalize the invoice (sentAt, billing case SENT, audit event INVOICE_SENT).
  if (!wasAlreadySent && success) {
    return finalizeInvoiceSent(db, {
      organizationId,
      invoiceId,
      billingCaseId: invoice.billingCaseId,
      actorUserId,
    });
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
  return invoice;
}
