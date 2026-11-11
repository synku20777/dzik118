// Phase H (Admin UX) - dashboard summary (spec Section 27 "Dashboard",
// route /admin/o/[orgId]/dashboard).
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  billingCaseStatusEnum,
  billingCases,
  billingPeriods,
  meterReadings,
} from "../../db/schema/billing";
import { dwellings, meters } from "../../db/schema/dwellings";
import { invoiceDeliveries, invoices } from "../../db/schema/invoices";
import { paymentAllocations, paymentReversals } from "../../db/schema/accounts";
import { organizations } from "../../db/schema/organizations";
import { maxExact, subtractExact, sumExact } from "../../lib/decimal2";
import { orgLocalDateString } from "../../lib/org-time";
import {
  listPaymentMatches,
  listUnmatchedTransactions,
} from "../payments/matching";
import {
  missingBillingDetails,
  readInvoiceSnapshots,
} from "../billing/invoice-snapshots";
import { NotFoundError } from "../errors";
import { getPeriod } from "./periods";

export type CaseStatusCounts = Record<
  (typeof billingCaseStatusEnum.enumValues)[number],
  number
>;

export interface AttentionItem {
  caseId: string;
  dwellingId: string;
  dwellingNumber: string;
  status: (typeof billingCaseStatusEnum.enumValues)[number];
  // billing_cases.missing_data JSONB (legacy rows may hold plain strings).
  missingData: unknown[];
  // OVERDUE rows only (null otherwise): what this dwelling still owes on the
  // period invoice, the invoice due date, and whole days past it.
  overdueAmount: string | null;
  dueDate: string | null;
  daysLate: number | null;
}

export type NextActionKey =
  | "ENTER_READINGS"
  | "GENERATE_INVOICES"
  | "SEND_INVOICES"
  | "REVIEW_PAYMENTS"
  | "CREATE_NEXT_PERIOD"
  | "ALL_DONE";

export interface DashboardSummary {
  period: Awaited<ReturnType<typeof getPeriod>>;
  // True when this is the organization's newest billing month.
  isNewestPeriod: boolean;
  // totalInvoiced is this month's CHARGES only (= currentCharges). Paid and
  // outstanding are measured against amountDue (charges + carried debt -
  // credits + late fees), so headline amountDue and show the breakdown.
  totalInvoiced: string;
  currentCharges: string;
  carriedOutstanding: string;
  creditsApplied: string;
  lateFees: string;
  // The stored adjustments. Not "amount due minus the rest": an invoice whose
  // credit is larger than its charges has amount due 0, and the rest would not
  // add up.
  manualAdjustments: string;
  amountDue: string;
  totalPaid: string;
  totalOutstanding: string;
  coldWaterConsumption: string;
  hotWaterConsumption: string;
  // Readings the system carried forward after the deadline (zero consumption).
  carriedForwardReadingCount: number;
  caseStatusCounts: CaseStatusCounts;
  needsAttention: AttentionItem[];
  progress: {
    dwellingsTotal: number;
    // Cases past MISSING_DATA.
    readingsDone: number;
    // Cases with an invoice: DRAFT, PREPARED, SENT, OVERDUE, PAID.
    invoicesGenerated: number;
    // Cases whose invoice went out: SENT, OVERDUE, PAID.
    invoicesSent: number;
    invoicesPaid: number;
  };
  nextAction: { key: NextActionKey; count: number };
  deadlines: {
    readingDeadline: string | null;
    invoiceIssueDate: string;
    invoiceDueDate: string;
  };
  // Org-wide: bank transactions with no match yet / matches awaiting review.
  unmatchedPaymentCount: number;
  proposedPaymentCount: number;
  // This period's invoices not sent whose last delivery FAILED or is UNKNOWN.
  deliveryFailureCount: number;
  // This period's DRAFT invoices that cannot be prepared: the issuer, the
  // recipient or the payment details are incomplete.
  blockedDraftCount: number;
  readiness: { billingReady: boolean; readyToSend: boolean };
}

// First applicable step of the month, in workflow order.
function pickNextAction(
  counts: CaseStatusCounts,
  locked: boolean,
  isNewest: boolean
): DashboardSummary["nextAction"] {
  if (locked)
    return { key: isNewest ? "CREATE_NEXT_PERIOD" : "ALL_DONE", count: 0 };
  const steps: [NextActionKey, number][] = [
    ["ENTER_READINGS", counts.MISSING_DATA],
    ["GENERATE_INVOICES", counts.READY],
    ["SEND_INVOICES", counts.DRAFT + counts.PREPARED],
    ["REVIEW_PAYMENTS", counts.SENT + counts.OVERDUE],
  ];
  const [key, count] = steps.find(([, n]) => n > 0) ?? ["ALL_DONE", 0];
  return { key, count };
}

// "Work requiring attention" (spec Section 27): a dwelling with no reading
// yet (MISSING_DATA) or a sent invoice already past its due date (OVERDUE)
// -- both need an admin to do something, unlike DRAFT/PREPARED which are
// just normal steps in the monthly workflow still in progress.
const ATTENTION_STATUSES = new Set(["MISSING_DATA", "OVERDUE"]);

export async function getDashboardSummary(
  db: Db,
  organizationId: string,
  periodId: string
): Promise<DashboardSummary> {
  const period = await getPeriod(db, organizationId, periodId);
  const [org] = await db
    .select({
      currency: organizations.currency,
      timezone: organizations.timezone,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new NotFoundError("Organization not found");

  const allPeriodInvoices = await db
    .select({
      id: invoices.id,
      currentCharges: invoices.currentCharges,
      previousOutstanding: invoices.previousOutstanding,
      previousCreditApplied: invoices.previousCreditApplied,
      lateFeeApplied: invoices.lateFeeApplied,
      manualAdjustment: invoices.manualAdjustment,
      amountDue: invoices.amountDue,
      paidAt: invoices.paidAt,
      sentAt: invoices.sentAt,
      dueDate: invoices.dueDate,
      billingCaseId: invoices.billingCaseId,
      currency: invoices.currency,
      issuerSnapshot: invoices.issuerSnapshot,
      recipientSnapshot: invoices.recipientSnapshot,
      paymentSnapshot: invoices.paymentSnapshot,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.periodId, periodId)
      )
    );
  // An invoice's currency is snapshotted from the organization's setting at
  // generation time (spec Section 21) and never changes afterward, but the
  // organization's own currency setting can change later (ORG-002). Summing
  // every invoice regardless would silently add incompatible currencies
  // together under whatever label the org happens to have today -- only
  // invoices still matching today's currency are counted.
  const periodInvoices = allPeriodInvoices.filter(
    (i) => i.currency === org.currency
  );
  const invoiceIds = periodInvoices.map((i) => i.id);
  const allocations = invoiceIds.length
    ? await db
        .select({
          invoiceId: paymentAllocations.invoiceId,
          amount: paymentAllocations.allocatedAmount,
        })
        .from(paymentAllocations)
        .where(
          and(
            eq(paymentAllocations.organizationId, organizationId),
            inArray(paymentAllocations.invoiceId, invoiceIds)
          )
        )
    : [];
  const reversals = invoiceIds.length
    ? await db
        .select({
          invoiceId: paymentReversals.invoiceId,
          amount: paymentReversals.reversedAllocationAmount,
        })
        .from(paymentReversals)
        .where(
          and(
            eq(paymentReversals.organizationId, organizationId),
            inArray(paymentReversals.invoiceId, invoiceIds)
          )
        )
    : [];
  const allocatedByInvoice = new Map<string, string>();
  for (const allocation of allocations) {
    allocatedByInvoice.set(
      allocation.invoiceId,
      sumExact([
        allocatedByInvoice.get(allocation.invoiceId) ?? "0.00",
        allocation.amount,
      ])
    );
  }
  for (const reversal of reversals) {
    allocatedByInvoice.set(
      reversal.invoiceId,
      maxExact(
        subtractExact(
          allocatedByInvoice.get(reversal.invoiceId) ?? "0.00",
          reversal.amount
        ),
        "0.00"
      )
    );
  }
  const currentCharges = sumExact(periodInvoices.map((i) => i.currentCharges));
  const carriedOutstanding = sumExact(
    periodInvoices.map((i) => i.previousOutstanding)
  );
  const creditsApplied = sumExact(
    periodInvoices.map((i) => i.previousCreditApplied)
  );
  const lateFees = sumExact(periodInvoices.map((i) => i.lateFeeApplied));
  const manualAdjustments = sumExact(
    periodInvoices.map((i) => i.manualAdjustment)
  );
  const amountDue = sumExact(periodInvoices.map((i) => i.amountDue));
  const totalPaid = sumExact(
    periodInvoices.map((invoice) => {
      const allocated = allocatedByInvoice.get(invoice.id) ?? "0.00";
      return invoice.paidAt && allocated === "0.00"
        ? invoice.amountDue
        : allocated;
    })
  );
  const outstandingByInvoice = new Map(
    periodInvoices.map((invoice) => [
      invoice.id,
      maxExact(
        subtractExact(
          invoice.amountDue,
          invoice.paidAt && !allocatedByInvoice.has(invoice.id)
            ? invoice.amountDue
            : (allocatedByInvoice.get(invoice.id) ?? "0.00")
        ),
        "0.00"
      ),
    ])
  );
  const totalOutstanding = sumExact([...outstandingByInvoice.values()]);
  const totalInvoiced = currentCharges;

  const readings = await db
    .select({
      type: meters.type,
      unit: meters.unit,
      source: meterReadings.source,
      consumption: meterReadings.consumption,
    })
    .from(meterReadings)
    .innerJoin(meters, eq(meters.id, meterReadings.meterId))
    .where(
      and(
        eq(meterReadings.organizationId, organizationId),
        eq(meterReadings.periodId, periodId)
      )
    );
  // meters.unit is free text, not an enum -- summing consumption across
  // meters with different units (e.g. m3 and litres) would silently add
  // incompatible quantities. This dashboard KPI only ever labels the result
  // "m3" (the unit this app's water meters are always configured with), so
  // only readings actually in that unit are counted.
  const WATER_UNIT = "m3";
  const coldWaterConsumption = sumExact(
    readings
      .filter((r) => r.type === "COLD_WATER" && r.unit === WATER_UNIT)
      .map((r) => r.consumption)
  );
  const hotWaterConsumption = sumExact(
    readings
      .filter((r) => r.type === "HOT_WATER" && r.unit === WATER_UNIT)
      .map((r) => r.consumption)
  );

  const carriedForwardReadingCount = readings.filter(
    (r) => r.source === "CARRIED_FORWARD"
  ).length;

  const cases = await db
    .select({
      id: billingCases.id,
      dwellingId: billingCases.dwellingId,
      dwellingNumber: dwellings.number,
      status: billingCases.status,
      missingData: billingCases.missingData,
    })
    .from(billingCases)
    .innerJoin(dwellings, eq(dwellings.id, billingCases.dwellingId))
    .where(
      and(
        eq(billingCases.organizationId, organizationId),
        eq(billingCases.periodId, periodId)
      )
    );
  const caseStatusCounts = Object.fromEntries(
    billingCaseStatusEnum.enumValues.map((status) => [status, 0])
  ) as CaseStatusCounts;
  const invoiceByCase = new Map(
    periodInvoices.map((i) => [i.billingCaseId, i])
  );
  const needsAttention: AttentionItem[] = [];
  for (const c of cases) {
    caseStatusCounts[c.status]++;
    if (ATTENTION_STATUSES.has(c.status)) {
      const overdue = c.status === "OVERDUE" ? invoiceByCase.get(c.id) : null;
      needsAttention.push({
        caseId: c.id,
        dwellingId: c.dwellingId,
        dwellingNumber: c.dwellingNumber,
        status: c.status,
        missingData: Array.isArray(c.missingData) ? c.missingData : [],
        overdueAmount: overdue ? outstandingByInvoice.get(overdue.id)! : null,
        dueDate: overdue?.dueDate ?? null,
        daysLate: overdue
          ? Math.max(
              0,
              // Whole days between two dates in the organization's own
              // timezone, like the overdue scan. Not UTC: the count would be a
              // day short until 02:00 or 03:00 in Riga.
              (Date.parse(orgLocalDateString(new Date(), org.timezone)) -
                Date.parse(overdue.dueDate)) /
                86_400_000
            )
          : null,
      });
    }
  }
  needsAttention.sort(
    (a, b) =>
      Number(b.status === "MISSING_DATA") -
        Number(a.status === "MISSING_DATA") ||
      a.dwellingNumber.localeCompare(b.dwellingNumber, undefined, {
        numeric: true,
        sensitivity: "base",
      })
  );
  const n = caseStatusCounts;
  const invoicesSent = n.SENT + n.OVERDUE + n.PAID;

  // Newest real billing month (the starting-readings month is never one).
  const [newest] = await db
    .select({ id: billingPeriods.id })
    .from(billingPeriods)
    .where(
      and(
        eq(billingPeriods.organizationId, organizationId),
        eq(billingPeriods.openingReadings, false)
      )
    )
    .orderBy(desc(billingPeriods.year), desc(billingPeriods.month))
    .limit(1);
  const isNewestPeriod = newest?.id === periodId;

  // The same check prepareInvoice makes, so the count is what automatic and
  // manual preparation would refuse. A damaged snapshot counts too.
  const blockedDraftCount = cases.filter((c) => {
    const invoice = c.status === "DRAFT" ? invoiceByCase.get(c.id) : undefined;
    if (!invoice) return false;
    const snapshots = readInvoiceSnapshots(invoice);
    return !snapshots || missingBillingDetails(snapshots) !== null;
  }).length;

  // Unsent invoices whose last delivery attempt did not succeed.
  const unsentIds = periodInvoices.filter((i) => !i.sentAt).map((i) => i.id);
  const failedDeliveries = unsentIds.length
    ? await db
        .selectDistinct({ invoiceId: invoiceDeliveries.invoiceId })
        .from(invoiceDeliveries)
        .where(
          and(
            eq(invoiceDeliveries.organizationId, organizationId),
            inArray(invoiceDeliveries.invoiceId, unsentIds),
            inArray(invoiceDeliveries.status, ["FAILED", "UNKNOWN"])
          )
        )
    : [];

  return {
    period,
    isNewestPeriod,
    totalInvoiced,
    currentCharges,
    carriedOutstanding,
    creditsApplied,
    lateFees,
    manualAdjustments,
    amountDue,
    totalPaid,
    totalOutstanding,
    coldWaterConsumption,
    hotWaterConsumption,
    carriedForwardReadingCount,
    caseStatusCounts,
    needsAttention,
    progress: {
      dwellingsTotal: cases.length,
      readingsDone: cases.length - n.MISSING_DATA,
      invoicesGenerated: n.DRAFT + n.PREPARED + invoicesSent,
      invoicesSent,
      invoicesPaid: n.PAID,
    },
    nextAction: pickNextAction(n, period.status === "LOCKED", isNewestPeriod),
    deadlines: {
      readingDeadline: period.readingDeadline,
      invoiceIssueDate: period.invoiceIssueDate,
      invoiceDueDate: period.invoiceDueDate,
    },
    // ponytail: both lists load full rows just to count them; add COUNT
    // queries if an org ever has thousands of open bank transactions.
    unmatchedPaymentCount: (await listUnmatchedTransactions(db, organizationId))
      .length,
    proposedPaymentCount: (
      await listPaymentMatches(db, organizationId, "PROPOSED")
    ).length,
    deliveryFailureCount: failedDeliveries.length,
    blockedDraftCount,
    readiness: {
      billingReady: cases.length > 0 && n.MISSING_DATA === 0,
      readyToSend: n.DRAFT + n.PREPARED > 0,
    },
  };
}
