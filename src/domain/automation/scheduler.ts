// Phase L (Automation/audit) - scheduled jobs (spec Section 32). Cloudflare
// Cron invokes a single entry point (runScheduledJobs); this module decides
// which organizations' jobs are due. Every mutation here reuses the exact
// same domain functions the admin UI calls (generateInvoice/prepareInvoice/
// sendInvoice via their bulk wrappers). Repeated scheduler runs are safe
// against duplicate sends (already-sent invoices are skipped), and an invoice
// with an unresolved (UNKNOWN) delivery outcome is deliberately skipped
// rather than auto-retried, requiring admin attention via an explicit resend.
import { and, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { organizations } from "../../db/schema/organizations";
import { billingCases } from "../../db/schema/billing";
import { suppressedEmails } from "../../db/schema/email";
import { invoiceSendAttempts, invoices } from "../../db/schema/invoices";
import {
  bulkGenerateInvoices,
  bulkPrepareInvoices,
} from "../billing/generation";
import { invoiceDelivery } from "../billing/invoice-snapshots";
import { bulkSendInvoices, type SendInvoiceDeps } from "../billing/sending";
import { getCurrentOpenPeriod } from "../periods/periods";
import { carryForwardMissingReadings } from "../periods/readings";
import { orgLocalDateString } from "../../lib/org-time";
import type { SkipKind } from "../errors";
import { latestSendDay, selectAutoSendBatch } from "./send-window";

// billing-overdue-scan. No audit event: spec Section 31's list has no
// dedicated OVERDUE action (BILLING_STATUS_OVERRIDDEN is for manual admin
// overrides specifically), and this is a passive, date-derived status
// recompute, not a discrete admin-initiated event.
export async function scanOverdueInvoices(
  db: Db,
  organizationId: string,
  todayLocal: string
): Promise<{ overdue: number }> {
  // One statement, so a payment confirmed at the same moment (case -> PAID)
  // is never overwritten: the status check and the update cannot come apart.
  const updated = await db
    .update(billingCases)
    .set({ status: "OVERDUE", statusUpdatedAt: new Date() })
    .where(
      and(
        eq(billingCases.organizationId, organizationId),
        eq(billingCases.status, "SENT"),
        inArray(
          billingCases.id,
          db
            .select({ id: invoices.billingCaseId })
            .from(invoices)
            .where(
              and(
                eq(invoices.organizationId, organizationId),
                isNull(invoices.paidAt),
                lt(invoices.dueDate, todayLocal),
                // An invoice a credit covered in full asks for nothing, so it
                // cannot be late.
                gt(invoices.amountDue, "0")
              )
            )
        )
      )
    )
    .returning({ id: billingCases.id });
  return { overdue: updated.length };
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
): Promise<{
  generated: number;
  prepared: number;
  // Invoices that cannot be prepared until an admin adds billing details.
  blocked: number;
  // Invoices that stopped on a technical error.
  failed: number;
}> {
  const period = await getCurrentOpenPeriod(db, organizationId);
  if (!period) return { generated: 0, prepared: 0, blocked: 0, failed: 0 };

  const { generated, skipped: notGenerated } = await bulkGenerateInvoices(
    db,
    organizationId,
    period.id,
    actorUserId
  );
  // A dwelling with missing readings or no tariff is not counted: its case is
  // MISSING_DATA, which the dashboard already lists under "Needs attention".
  const failedToGenerate = notGenerated.filter(
    (s) => s.kind === "FAILED"
  ).length;
  if (generated.length === 0) {
    return { generated: 0, prepared: 0, blocked: 0, failed: failedToGenerate };
  }

  // One query, not one per dwelling, in the order of `generated`. No case
  // status filter: these invoices are DRAFT, made a moment ago.
  const idByDwelling = new Map(
    (
      await db
        .select({ id: invoices.id, dwellingId: invoices.dwellingId })
        .from(invoices)
        .where(
          and(
            eq(invoices.periodId, period.id),
            inArray(invoices.dwellingId, generated)
          )
        )
    ).map((row) => [row.dwellingId, row.id])
  );
  const invoiceIds = generated.flatMap(
    (dwellingId) => idByDwelling.get(dwellingId) ?? []
  );
  const { prepared, skipped: notPrepared } = await bulkPrepareInvoices(
    db,
    organizationId,
    invoiceIds,
    actorUserId
  );
  const count = (kind: SkipKind) =>
    notPrepared.filter((s) => s.kind === kind).length;
  return {
    generated: generated.length,
    prepared: prepared.length,
    blocked: count("NEEDS_ATTENTION"),
    failed: failedToGenerate + count("FAILED"),
  };
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
  actorUserId: string | null,
  // Given by runScheduledJobs. Without it every prepared invoice is due.
  window?: { timezone: string; sendDayDate: string }
): Promise<{
  sent: number;
  failed: number;
  suppressed: number;
  waiting: number;
}> {
  const preparedInvoices = await db
    .select({
      id: invoices.id,
      preparedAt: invoices.preparedAt,
      recipient: invoices.recipientSnapshot,
    })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(billingCases.status, "PREPARED")
      )
    );
  if (preparedInvoices.length === 0) {
    return { sent: 0, failed: 0, suppressed: 0, waiting: 0 };
  }

  const suppressed = new Set(
    (
      await db
        .select({ email: suppressedEmails.email })
        .from(suppressedEmails)
        .where(eq(suppressedEmails.organizationId, organizationId))
    ).map((row) => row.email)
  );
  // An invoice whose last send has no confirmed outcome is never retried
  // automatically: an admin resends it. Left in the queue it would take a
  // batch place every day and block the invoices behind it.
  const unresolved = new Set(
    (
      await db
        .selectDistinctOn([invoiceSendAttempts.invoiceId], {
          invoiceId: invoiceSendAttempts.invoiceId,
          status: invoiceSendAttempts.status,
        })
        .from(invoiceSendAttempts)
        .where(
          and(
            eq(invoiceSendAttempts.organizationId, organizationId),
            inArray(
              invoiceSendAttempts.invoiceId,
              preparedInvoices.map((row) => row.id)
            )
          )
        )
        .orderBy(
          invoiceSendAttempts.invoiceId,
          desc(invoiceSendAttempts.createdAt)
        )
    )
      .filter((attempt) => attempt.status === "UNKNOWN")
      .map((attempt) => attempt.invoiceId)
  );
  const selection = selectAutoSendBatch(
    preparedInvoices
      .filter((row) => !unresolved.has(row.id))
      .map((row) => {
        const { billingEmail, invoiceByEmail } = invoiceDelivery(row.recipient);
        return {
          id: row.id,
          preparedAt: row.preparedAt,
          billingEmail,
          invoiceByEmail,
        };
      }),
    {
      // No window: everything prepared is due (the old one-day behavior).
      timezone: window?.timezone ?? "UTC",
      sendDayDate: window?.sendDayDate ?? "9999-12-31",
      suppressed,
    }
  );
  const counts = {
    suppressed: selection.suppressed,
    waiting: selection.waiting,
  };
  if (selection.batch.length === 0) {
    return { sent: 0, failed: unresolved.size, ...counts };
  }

  const { sent, skipped } = await bulkSendInvoices(
    db,
    organizationId,
    selection.batch,
    deps,
    actorUserId
  );
  // A skipped invoice is one that did not go out. Already sent is not a failure.
  // The unresolved ones still count, so the owner alert keeps naming them.
  return {
    sent: sent.length,
    failed:
      skipped.filter((s) => s.reason !== "Already sent").length +
      unresolved.size,
    ...counts,
  };
}

export interface OrganizationJobResult {
  organizationId: string;
  overdue: number;
  generated: number;
  prepared: number;
  sent: number;
  // Invoices that auto send tried and could not deliver.
  failedSends: number;
  // Auto generation: invoices waiting for billing details, and invoices that
  // stopped on a technical error. Both go into the owner alert.
  blockedInvoices?: number;
  failedInvoices?: number;
  // Not an error. Prepared invoices skipped because the address is suppressed,
  // and invoices left for the next run by the batch limit.
  suppressedSends?: number;
  waitingSends?: number;
  // Readings the system wrote after the deadline from the previous value.
  carriedForward?: number;
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
      failedSends: 0,
    };
    // An organization archived after the list above was read must not get a
    // new invoice or an email (ADR 0009). An email cannot be taken back, so
    // this asks the database again before each step that changes something.
    const stillActive = async () => {
      const [row] = await db
        .select({ archivedAt: organizations.archivedAt })
        .from(organizations)
        .where(eq(organizations.id, org.id))
        .limit(1);
      return !!row && !row.archivedAt;
    };
    try {
      const todayLocal = orgLocalDateString(now, org.timezone);
      if (!(await stillActive())) continue;
      result.overdue = (
        await scanOverdueInvoices(db, org.id, todayLocal)
      ).overdue;

      // Runs for every organization, not only with auto generation: the
      // admin must see the carried readings on the day after the deadline.
      const currentPeriod = await getCurrentOpenPeriod(db, org.id);
      if (currentPeriod && (await stillActive())) {
        result.carriedForward = await carryForwardMissingReadings(
          db,
          org.id,
          currentPeriod.id,
          actorUserId,
          now
        );
      }

      if (org.autoGenerateEnabled && (await stillActive())) {
        const { generated, prepared, blocked, failed } =
          await autoGenerateForOrganization(db, org.id, actorUserId);
        result.generated = generated;
        result.prepared = prepared;
        result.blockedInvoices = blocked;
        result.failedInvoices = failed;
      }

      if (
        org.autoSendEnabled &&
        org.autoSendDay !== null &&
        (await stillActive())
      ) {
        // On the send day and for a few days after it, also across a month
        // end. A failed or partial run is tried again the next day. See
        // send-window.ts for which invoices are due.
        const sendDayDate = latestSendDay(todayLocal, org.autoSendDay);
        if (sendDayDate) {
          const sendResult = await autoSendForOrganization(
            db,
            org.id,
            deps,
            actorUserId,
            { timezone: org.timezone, sendDayDate }
          );
          result.sent = sendResult.sent;
          result.failedSends = sendResult.failed;
          result.suppressedSends = sendResult.suppressed;
          result.waitingSends = sendResult.waiting;
        }
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    results.push(result);
  }
  return results;
}
