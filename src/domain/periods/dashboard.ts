// Phase H (Admin UX) - dashboard summary (spec Section 27 "Dashboard",
// route /admin/o/[orgId]/dashboard).
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  billingCaseStatusEnum,
  billingCases,
  meterReadings,
} from "../../db/schema/billing";
import { dwellings, meters } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import { paymentAllocations } from "../../db/schema/accounts";
import { organizations } from "../../db/schema/organizations";
import { maxExact, subtractExact, sumExact } from "../../lib/decimal2";
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
}

export interface DashboardSummary {
  period: Awaited<ReturnType<typeof getPeriod>>;
  totalInvoiced: string;
  currentCharges: string;
  carriedOutstanding: string;
  creditsApplied: string;
  lateFees: string;
  amountDue: string;
  totalPaid: string;
  totalOutstanding: string;
  coldWaterConsumption: string;
  hotWaterConsumption: string;
  caseStatusCounts: CaseStatusCounts;
  needsAttention: AttentionItem[];
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
    .select({ currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const allPeriodInvoices = await db
    .select({
      id: invoices.id,
      currentCharges: invoices.currentCharges,
      previousOutstanding: invoices.previousOutstanding,
      previousCreditApplied: invoices.previousCreditApplied,
      lateFeeApplied: invoices.lateFeeApplied,
      amountDue: invoices.amountDue,
      paidAt: invoices.paidAt,
      currency: invoices.currency,
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
  const allocations = await db
    .select({
      invoiceId: paymentAllocations.invoiceId,
      amount: paymentAllocations.allocatedAmount,
    })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.organizationId, organizationId));
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
  const currentCharges = sumExact(periodInvoices.map((i) => i.currentCharges));
  const carriedOutstanding = sumExact(
    periodInvoices.map((i) => i.previousOutstanding)
  );
  const creditsApplied = sumExact(
    periodInvoices.map((i) => i.previousCreditApplied)
  );
  const lateFees = sumExact(periodInvoices.map((i) => i.lateFeeApplied));
  const amountDue = sumExact(periodInvoices.map((i) => i.amountDue));
  const totalPaid = sumExact(
    periodInvoices.map((invoice) => {
      const allocated = allocatedByInvoice.get(invoice.id) ?? "0.00";
      return invoice.paidAt && allocated === "0.00"
        ? invoice.amountDue
        : allocated;
    })
  );
  const totalOutstanding = sumExact(
    periodInvoices.map((invoice) =>
      maxExact(
        subtractExact(
          invoice.amountDue,
          invoice.paidAt && !allocatedByInvoice.has(invoice.id)
            ? invoice.amountDue
            : (allocatedByInvoice.get(invoice.id) ?? "0.00")
        ),
        "0.00"
      )
    )
  );
  const totalInvoiced = currentCharges;

  const readings = await db
    .select({
      type: meters.type,
      unit: meters.unit,
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

  const cases = await db
    .select({
      id: billingCases.id,
      dwellingId: billingCases.dwellingId,
      dwellingNumber: dwellings.number,
      status: billingCases.status,
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
  const needsAttention: AttentionItem[] = [];
  for (const c of cases) {
    caseStatusCounts[c.status]++;
    if (ATTENTION_STATUSES.has(c.status)) {
      needsAttention.push({
        caseId: c.id,
        dwellingId: c.dwellingId,
        dwellingNumber: c.dwellingNumber,
        status: c.status,
      });
    }
  }

  return {
    period,
    totalInvoiced,
    currentCharges,
    carriedOutstanding,
    creditsApplied,
    lateFees,
    amountDue,
    totalPaid,
    totalOutstanding,
    coldWaterConsumption,
    hotWaterConsumption,
    caseStatusCounts,
    needsAttention,
  };
}
