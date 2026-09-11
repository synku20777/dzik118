// Phase K (Messaging/data) - GET /api/v1/admin/o/:orgId/readings/export
// (spec Section 11). Read-only reporting export, kept out of readings.ts
// (submission logic) the same way Phase J split bank-import.ts from
// matching.ts by concern.
import Papa from "papaparse";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { billingPeriods, meterReadings } from "../../db/schema/billing";
import { dwellings, meters } from "../../db/schema/dwellings";

const EXPORT_HEADERS = [
  "dwelling_number",
  "meter_type",
  "period_year",
  "period_month",
  "previous_value",
  "current_value",
  "consumption",
  "source",
  "submitted_at",
];

export async function exportReadingsCsv(
  db: Db,
  organizationId: string
): Promise<string> {
  const rows = await db
    .select({
      dwellingNumber: dwellings.number,
      meterType: meters.type,
      periodYear: billingPeriods.year,
      periodMonth: billingPeriods.month,
      previousValue: meterReadings.previousValue,
      currentValue: meterReadings.currentValue,
      consumption: meterReadings.consumption,
      source: meterReadings.source,
      submittedAt: meterReadings.submittedAt,
    })
    .from(meterReadings)
    .innerJoin(meters, eq(meters.id, meterReadings.meterId))
    .innerJoin(dwellings, eq(dwellings.id, meters.dwellingId))
    .innerJoin(billingPeriods, eq(billingPeriods.id, meterReadings.periodId))
    .where(eq(meterReadings.organizationId, organizationId));

  const csvRows = rows.map((r) => ({
    dwelling_number: r.dwellingNumber,
    meter_type: r.meterType,
    period_year: r.periodYear,
    period_month: r.periodMonth,
    previous_value: r.previousValue ?? "",
    current_value: r.currentValue,
    consumption: r.consumption,
    source: r.source,
    submitted_at: r.submittedAt.toISOString(),
  }));

  // Spec Section 26: protect exports against spreadsheet formula injection
  // (escapeFormulae, same as exportDwellingsCsv). The {fields, data} object
  // form (rather than passing csvRows with a `columns` option) keeps the
  // header row even when there are zero readings -- Papa.unparse([], {
  // columns }) returns an empty string with no headers at all.
  return Papa.unparse(
    { fields: EXPORT_HEADERS, data: csvRows },
    { escapeFormulae: true }
  );
}
