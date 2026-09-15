// Phase E (Periods/meters/readings) - billing_case read model for the
// admin period workbench (spec Section 27, route
// /admin/o/[orgId]/periods/[periodId]).
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  billingCaseStatusEnum,
  billingCases,
  billingPeriods,
  manualRuleInputs,
  meterReadings,
} from "../../db/schema/billing";
import { dwellings, meters } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import { getEffectiveRules } from "../billing/rules";

// Spec Section 27's required default sort: status priority first, then
// natural dwelling number. Sorted client-side (post-fetch) rather than with
// a SQL CASE expression -- this list is at most one organization's worth of
// dwellings per period, never large enough to need it done in the database.
const STATUS_PRIORITY: Record<
  (typeof billingCaseStatusEnum.enumValues)[number],
  number
> = {
  MISSING_DATA: 0,
  READY: 1,
  DRAFT: 2,
  PREPARED: 3,
  OVERDUE: 4,
  SENT: 5,
  PAID: 6,
};

function compareDwellingNumbers(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

export interface ListCasesForPeriodOptions {
  search?: string;
  statusFilter?: (typeof billingCaseStatusEnum.enumValues)[number];
}

export async function listCasesForPeriod(
  db: Db,
  organizationId: string,
  periodId: string,
  options: ListCasesForPeriodOptions = {}
) {
  const rows = await db
    .select({
      id: billingCases.id,
      dwellingId: billingCases.dwellingId,
      dwellingNumber: dwellings.number,
      occupantName: dwellings.occupantName,
      billingEmail: dwellings.billingEmail,
      invoiceByEmail: dwellings.invoiceByEmail,
      invoiceByPaper: dwellings.invoiceByPaper,
      status: billingCases.status,
      missingData: billingCases.missingData,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceTotal: invoices.total,
      invoiceCurrentCharges: invoices.currentCharges,
      invoiceAmountDue: invoices.amountDue,
      invoicePreviousOutstanding: invoices.previousOutstanding,
      invoicePreviousCreditApplied: invoices.previousCreditApplied,
      invoiceLateFeeApplied: invoices.lateFeeApplied,
      invoiceIssuerSnapshot: invoices.issuerSnapshot,
      invoiceRecipientSnapshot: invoices.recipientSnapshot,
      invoicePaymentSnapshot: invoices.paymentSnapshot,
    })
    .from(billingCases)
    .innerJoin(dwellings, eq(dwellings.id, billingCases.dwellingId))
    .leftJoin(invoices, eq(invoices.billingCaseId, billingCases.id))
    .where(
      and(
        eq(billingCases.periodId, periodId),
        eq(billingCases.organizationId, organizationId)
      )
    );

  const search = options.search?.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (options.statusFilter && row.status !== options.statusFilter) {
      return false;
    }
    if (search && !row.dwellingNumber.toLowerCase().includes(search)) {
      return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    const byStatus = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (byStatus !== 0) return byStatus;
    return compareDwellingNumbers(a.dwellingNumber, b.dwellingNumber);
  });
}

// Phase D (Organizations/dwellings) - the dwelling-detail page's "Period
// history" tab: this dwelling's billing case in every period it's existed
// for, newest period first (the inverse of listCasesForPeriod, which lists
// every dwelling within one period).
export async function listCasesForDwelling(
  db: Db,
  organizationId: string,
  dwellingId: string
) {
  return db
    .select({
      id: billingCases.id,
      periodId: billingCases.periodId,
      periodYear: billingPeriods.year,
      periodMonth: billingPeriods.month,
      status: billingCases.status,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceAmountDue: invoices.amountDue,
    })
    .from(billingCases)
    .innerJoin(billingPeriods, eq(billingPeriods.id, billingCases.periodId))
    .leftJoin(invoices, eq(invoices.billingCaseId, billingCases.id))
    .where(
      and(
        eq(billingCases.dwellingId, dwellingId),
        eq(billingCases.organizationId, organizationId)
      )
    )
    .orderBy(desc(billingPeriods.year), desc(billingPeriods.month));
}

// Meters + this period's existing reading (if any) for one dwelling, for
// the workbench's per-dwelling reading entry form.
export async function listMetersWithReadingForPeriod(
  db: Db,
  organizationId: string,
  dwellingId: string,
  periodId: string
) {
  return db
    .select({
      meterId: meters.id,
      type: meters.type,
      label: meters.label,
      serialNumber: meters.serialNumber,
      unit: meters.unit,
      archivedAt: meters.archivedAt,
      currentValue: meterReadings.currentValue,
      previousValue: meterReadings.previousValue,
      consumption: meterReadings.consumption,
      source: meterReadings.source,
    })
    .from(meters)
    .leftJoin(
      meterReadings,
      and(
        eq(meterReadings.meterId, meters.id),
        eq(meterReadings.periodId, periodId)
      )
    )
    .where(
      and(
        eq(meters.dwellingId, dwellingId),
        eq(meters.organizationId, organizationId)
      )
    )
    .orderBy(meters.createdAt);
}

export interface ManualRuleInputForPeriod {
  billingRuleId: string;
  ruleName: string;
  unit: string;
  calculationType: "MANUAL_QUANTITY" | "MANUAL_AMOUNT";
  value: string | null;
}

// Every effective MANUAL_QUANTITY/MANUAL_AMOUNT rule for this period
// (applies to every dwelling unconditionally, same as FIXED/AREA/
// RESIDENT_COUNT -- see case-readiness.ts) + this dwelling's existing input
// value, if any -- the manual-input counterpart of
// listMetersWithReadingForPeriod above, for the same drawer.
export async function listManualRuleInputsForPeriod(
  db: Db,
  organizationId: string,
  dwellingId: string,
  periodId: string,
  period: { startsOn: string; endsOn: string }
): Promise<ManualRuleInputForPeriod[]> {
  const rules = await getEffectiveRules(db, organizationId, period);
  const manualRules = rules.filter(
    (
      r
    ): r is typeof r & {
      calculationType: "MANUAL_QUANTITY" | "MANUAL_AMOUNT";
    } =>
      r.calculationType === "MANUAL_QUANTITY" ||
      r.calculationType === "MANUAL_AMOUNT"
  );
  if (manualRules.length === 0) return [];

  const inputs = await db
    .select({
      billingRuleId: manualRuleInputs.billingRuleId,
      value: manualRuleInputs.value,
    })
    .from(manualRuleInputs)
    .where(
      and(
        eq(manualRuleInputs.periodId, periodId),
        eq(manualRuleInputs.dwellingId, dwellingId)
      )
    );
  const valueByRuleId = new Map(inputs.map((i) => [i.billingRuleId, i.value]));

  return manualRules.map((r) => ({
    billingRuleId: r.id,
    ruleName: r.name,
    unit: r.unit,
    calculationType: r.calculationType,
    value: valueByRuleId.get(r.id) ?? null,
  }));
}

export interface ConsumptionHistoryEntry {
  year: number;
  month: number;
  coldWaterConsumption: string | null;
  hotWaterConsumption: string | null;
}

// Phase I (Resident UX) - consumption history for the resident dwelling
// dashboard (spec Section 28), one row per period, newest first. Grouped
// and limited here rather than in the page: a dwelling can have more than
// one meter of the same type (replacements, extra meters), so limiting the
// underlying flat rows before grouping could cut an older period's data in
// half instead of dropping it cleanly.
export async function listConsumptionHistoryForDwelling(
  db: Db,
  dwellingId: string,
  periodLimit = 6
): Promise<ConsumptionHistoryEntry[]> {
  const rows = await db
    .select({
      year: billingPeriods.year,
      month: billingPeriods.month,
      meterType: meters.type,
      consumption: meterReadings.consumption,
    })
    .from(meterReadings)
    .innerJoin(meters, eq(meters.id, meterReadings.meterId))
    .innerJoin(billingPeriods, eq(billingPeriods.id, meterReadings.periodId))
    .where(eq(meters.dwellingId, dwellingId))
    .orderBy(desc(billingPeriods.year), desc(billingPeriods.month));

  const byPeriod = new Map<string, ConsumptionHistoryEntry>();
  for (const row of rows) {
    const key = `${row.year}-${row.month}`;
    let entry = byPeriod.get(key);
    if (!entry) {
      entry = {
        year: row.year,
        month: row.month,
        coldWaterConsumption: null,
        hotWaterConsumption: null,
      };
      byPeriod.set(key, entry);
    }
    if (row.meterType === "COLD_WATER") {
      entry.coldWaterConsumption = row.consumption;
    } else if (row.meterType === "HOT_WATER") {
      entry.hotWaterConsumption = row.consumption;
    }
  }
  return Array.from(byPeriod.values()).slice(0, periodLimit);
}
