// Phase E (Periods/meters/readings) - billing_case read model for the
// admin period workbench (spec Section 27, route
// /admin/o/[orgId]/periods/[periodId]).
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { billingCases, meterReadings } from "../../db/schema/billing";
import { dwellings, meters } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";

export async function listCasesForPeriod(
  db: Db,
  organizationId: string,
  periodId: string
) {
  return db
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
    )
    .orderBy(dwellings.number);
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
