// Phase E (Periods/meters/readings) - billing_case read model for the
// admin period workbench (spec Section 27, route
// /admin/o/[orgId]/periods/[periodId]).
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  billingCaseStatusEnum,
  billingCases,
  billingPeriods,
  meterReadings,
} from "../../db/schema/billing";
import { dwellings, meters } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";

// Spec Section 27's required default sort: status priority first, then
// natural dwelling number. Sorted client-side (post-fetch) rather than with
// a SQL CASE expression -- this list is at most one organization's worth of
// dwellings per period, never large enough to need it done in the database.
const STATUS_PRIORITY: Record<
  (typeof billingCaseStatusEnum.enumValues)[number],
  number
> = {
  MISSING_DATA: 0,
  DRAFT: 1,
  PREPARED: 2,
  OVERDUE: 3,
  SENT: 4,
  PAID: 5,
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
      status: billingCases.status,
      missingData: billingCases.missingData,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceTotal: invoices.total,
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
