// Phase L (Automation/audit) - scheduled jobs (spec Section 32). Cloudflare
// Cron invokes a single entry point (runScheduledJobs); this module decides
// which organizations' jobs are due. Every mutation here reuses the exact
// same domain functions the admin UI calls (generateInvoice/prepareInvoice/
// sendInvoice via their bulk wrappers). Repeated scheduler runs are safe
// against duplicate sends (already-sent invoices are skipped), and an invoice
// with an unresolved (UNKNOWN) delivery outcome is deliberately skipped
// rather than auto-retried, requiring admin attention via an explicit resend.
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { organizations } from "../../db/schema/organizations";
import { billingCases } from "../../db/schema/billing";
import { invoices } from "../../db/schema/invoices";
import {
  bulkGenerateInvoices,
  bulkPrepareInvoices,
  getInvoiceIdForDwellingPeriod,
} from "../billing/generation";
import { bulkSendInvoices, type SendInvoiceDeps } from "../billing/sending";
import { getCurrentOpenPeriod } from "../periods/periods";
import { orgLocalDateString } from "../../lib/org-time";

// billing-overdue-scan. No audit event: spec Section 31's list has no
// dedicated OVERDUE action (BILLING_STATUS_OVERRIDDEN is for manual admin
// overrides specifically), and this is a passive, date-derived status
// recompute, not a discrete admin-initiated event.
export async function scanOverdueInvoices(
  db: Db,
  organizationId: string,
  todayLocal: string
): Promise<{ overdue: number }> {
  const rows = await db
    .select({ caseId: billingCases.id })
    .from(billingCases)
    .innerJoin(invoices, eq(invoices.billingCaseId, billingCases.id))
    .where(
      and(
        eq(billingCases.organizationId, organizationId),
        eq(billingCases.status, "SENT"),
        isNull(invoices.paidAt),
        lt(invoices.dueDate, todayLocal)
      )
    );

  let overdue = 0;
  for (const row of rows) {
    // Re-assert status = SENT in the WHERE clause itself: if a payment was
    // confirmed (billing_cases -> PAID) between the SELECT above and this
    // UPDATE, this becomes a no-op instead of blindly overwriting PAID back
    // to OVERDUE.
    const [updated] = await db
      .update(billingCases)
      .set({ status: "OVERDUE", statusUpdatedAt: new Date() })
      .where(
        and(eq(billingCases.id, row.caseId), eq(billingCases.status, "SENT"))
      )
      .returning({ id: billingCases.id });
    if (updated) overdue++;
  }
  return { overdue };
}

// auto-invoice-generate: generate + prepare in one step for orgs with
// autoGenerateEnabled, since there's no automated path from DRAFT to
// PREPARED otherwise and auto-send only ever sends PREPARED invoices (spec
// Section 32). Safe to run every scheduler tick -- bulkGenerateInvoices
// only acts on MISSING_DATA/READY/DRAFT cases, so a case some earlier run
// already advanced past DRAFT is silently skipped, not re-processed.
export async function autoGenerateForOrganization(
  db: Db,
  organizationId: string,
  actorUserId: string | null
): Promise<{ generated: number; prepared: number }> {
  const period = await getCurrentOpenPeriod(db, organizationId);
  if (!period) return { generated: 0, prepared: 0 };

  const { generated } = await bulkGenerateInvoices(
    db,
    organizationId,
    period.id,
    actorUserId
  );
  if (generated.length === 0) return { generated: 0, prepared: 0 };

  const invoiceIds: string[] = [];
  for (const dwellingId of generated) {
    const invoiceId = await getInvoiceIdForDwellingPeriod(
      db,
      dwellingId,
      period.id
    );
    if (invoiceId) invoiceIds.push(invoiceId);
  }
  const { prepared } = await bulkPrepareInvoices(
    db,
    organizationId,
    invoiceIds,
    actorUserId
  );
  return { generated: generated.length, prepared: prepared.length };
}

// auto-invoice-send: sends every PREPARED invoice for the organization,
// across every period -- not just the current open one. A period being
// locked, or not the newest OPEN one, doesn't make an already-prepared
// invoice ineligible to send (spec Section 32 says auto-send sends
// PREPARED invoices, with no "current period only" restriction). Whether
// "today" is this org's configured autoSendDay is the caller's
// (runScheduledJobs') decision, not this function's, so it stays reusable
// for a future manual "send all prepared now" trigger too.
export async function autoSendForOrganization(
  db: Db,
  organizationId: string,
  deps: SendInvoiceDeps,
  actorUserId: string | null
): Promise<{ sent: number }> {
  const preparedInvoices = await db
    .select({ id: invoices.id })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(billingCases.status, "PREPARED")
      )
    );
  if (preparedInvoices.length === 0) return { sent: 0 };

  const { sent } = await bulkSendInvoices(
    db,
    organizationId,
    preparedInvoices.map((row) => row.id),
    deps,
    actorUserId
  );
  return { sent: sent.length };
}

export interface OrganizationJobResult {
  organizationId: string;
  overdue: number;
  generated: number;
  prepared: number;
  sent: number;
  error?: string;
}

// The single scheduler entry point Cloudflare Cron invokes (spec Section
// 32). Each organization's jobs run independently -- one org's failure
// (a bad email config, a locked row, anything) is caught and recorded in
// that org's own result rather than aborting every other organization's
// run (spec: "scoped").
export async function runScheduledJobs(
  db: Db,
  deps: SendInvoiceDeps,
  now: Date = new Date()
): Promise<OrganizationJobResult[]> {
  // null actor: audit_logs.actor_user_id is nullable specifically for this
  // (spec Section 13.20), and every mutation function here only ever
  // forwards actorUserId into an audit-event write -- no fabricated
  // app_users row is needed, which would otherwise violate spec Section
  // 12's "app_users.id must equal auth.users.id" invariant for no reason.
  const actorUserId = null;

  const orgs = await db
    .select({
      id: organizations.id,
      timezone: organizations.timezone,
      autoGenerateEnabled: organizations.autoGenerateEnabled,
      autoSendEnabled: organizations.autoSendEnabled,
      autoSendDay: organizations.autoSendDay,
    })
    .from(organizations)
    .where(isNull(organizations.archivedAt));

  const results: OrganizationJobResult[] = [];
  for (const org of orgs) {
    const result: OrganizationJobResult = {
      organizationId: org.id,
      overdue: 0,
      generated: 0,
      prepared: 0,
      sent: 0,
    };
    try {
      const todayLocal = orgLocalDateString(now, org.timezone);
      result.overdue = (
        await scanOverdueInvoices(db, org.id, todayLocal)
      ).overdue;

      if (org.autoGenerateEnabled) {
        const { generated, prepared } = await autoGenerateForOrganization(
          db,
          org.id,
          actorUserId
        );
        result.generated = generated;
        result.prepared = prepared;
      }

      if (org.autoSendEnabled && org.autoSendDay !== null) {
        const dayOfMonth = Number(todayLocal.split("-")[2]);
        if (dayOfMonth === org.autoSendDay) {
          result.sent = (
            await autoSendForOrganization(db, org.id, deps, actorUserId)
          ).sent;
        }
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    results.push(result);
  }
  return results;
}
