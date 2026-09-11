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
import type { Db } from "../../db/client";
import { billingCases, billingPeriods } from "../../db/schema/billing";
import { invoiceDeliveries, invoices } from "../../db/schema/invoices";
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
  actorUserId: string | null
): Promise<{ success: boolean }> {
  const { invoice } = await getInvoice(db, organizationId, invoiceId);
  const [period] = await db
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.id, invoice.periodId))
    .limit(1);
  const recipient = invoice.recipientSnapshot as {
    billingEmail?: string | null;
  };
  const issuer = invoice.issuerSnapshot as { name?: string };

  if (!recipient.billingEmail) {
    await db.insert(invoiceDeliveries).values({
      organizationId,
      invoiceId,
      destinationEmail: "",
      provider: "none",
      status: "FAILED",
      errorCode: "NO_RECIPIENT_EMAIL",
    });
    return { success: false };
  }

  // Spec Section 24: "expiration configurable" -- 90 days is the default
  // policy; each delivery attempt (including a resend) gets its own token
  // with a fresh expiry, rather than a single token that outlives the
  // resident's practical need to view/download this invoice.
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
    total: invoice.total,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    viewInvoiceUrl: `${deps.appBaseUrl}/invoice/access/${rawToken}`,
    portalUrl: `${deps.appBaseUrl}/portal`,
  });

  await db.insert(invoiceDeliveries).values({
    organizationId,
    invoiceId,
    destinationEmail: recipient.billingEmail,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    status: result.success ? "SENT" : "FAILED",
    errorCode: result.errorCode,
    sentAt: result.success ? new Date() : null,
  });

  return { success: result.success };
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
  const { invoice } = await getInvoice(db, organizationId, invoiceId);
  if (invoice.sentAt) {
    return invoice;
  }

  const [billingCase] = await db
    .select()
    .from(billingCases)
    .where(eq(billingCases.id, invoice.billingCaseId))
    .limit(1);
  if (!billingCase || billingCase.status !== "PREPARED") {
    throw new ConflictError("Only a PREPARED invoice can be sent");
  }

  // Atomically claim the send by flipping sentAt away from null: only one
  // of two concurrent callers (double-click, client retry) can win this
  // conditional update, so only one ever generates the PDF and emails it.
  // Reverted below if delivery fails, so a failed send still ends up
  // retryable from PREPARED (spec Section 23).
  const [claimed] = await db
    .update(invoices)
    .set({ sentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.sentAt)))
    .returning();
  if (!claimed) {
    // Lost the race -- another call is sending/has already sent this.
    return (await getInvoice(db, organizationId, invoiceId)).invoice;
  }

  try {
    await ensureCanonicalPdf(db, organizationId, invoiceId, deps);
    const { success } = await deliver(
      db,
      organizationId,
      invoiceId,
      deps,
      actorUserId
    );

    if (!success) {
      // Spec Section 23: "failed delivery retains PREPARED if none
      // succeeded" -- release the claim so a later sendInvoice call retries.
      const [reverted] = await db
        .update(invoices)
        .set({ sentAt: null, updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId))
        .returning();
      await recordAuditEvent(db, {
        organizationId,
        actorUserId,
        action: "INVOICE_SEND_FAILED",
        entityType: "invoice",
        entityId: invoiceId,
      });
      return reverted;
    }

    await db
      .update(billingCases)
      .set({ status: "SENT", statusUpdatedAt: new Date() })
      .where(eq(billingCases.id, billingCase.id));
    // Re-fetch: `claimed` was captured before ensureCanonicalPdf wrote
    // pdfObjectKey/pdfSha256, so it's stale for the caller's purposes.
    const { invoice: sentInvoice } = await getInvoice(
      db,
      organizationId,
      invoiceId
    );
    await recordAuditEvent(db, {
      organizationId,
      actorUserId,
      action: "INVOICE_SENT",
      entityType: "invoice",
      entityId: invoiceId,
      afterData: sentInvoice,
    });
    return sentInvoice;
  } catch (err) {
    await db
      .update(invoices)
      .set({ sentAt: null, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    throw err;
  }
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
// unlike sendInvoice, this always attempts delivery again and never
// touches sentAt/case status (both already set by the original send).
export async function resendInvoice(
  db: Db,
  organizationId: string,
  invoiceId: string,
  deps: SendInvoiceDeps,
  actorUserId: string
) {
  const { invoice } = await getInvoice(db, organizationId, invoiceId);
  if (!invoice.sentAt) {
    throw new ConflictError(
      "This invoice has not been sent yet; send it first"
    );
  }
  const { success } = await deliver(
    db,
    organizationId,
    invoiceId,
    deps,
    actorUserId
  );
  await recordAuditEvent(db, {
    organizationId,
    actorUserId,
    action: success ? "INVOICE_RESENT" : "INVOICE_RESEND_FAILED",
    entityType: "invoice",
    entityId: invoiceId,
  });
  return invoice;
}
