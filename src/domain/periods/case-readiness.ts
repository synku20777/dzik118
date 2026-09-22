// Phase E (Periods/meters/readings) - billing_case.missing_data upkeep
// (spec Section 16 step 4/5, Section 13.10). Status tracks readiness up to
// the point an invoice exists: MISSING_DATA while required readings are
// outstanding, READY once they're all in but no invoice has been generated
// yet. The DRAFT transition (and everything after it) only happens when
// Phase F actually generates an invoice -- recalculateCaseReadiness never
// touches a case that has already reached DRAFT or later, since at that
// point "Regenerate invoice" is the mechanism for re-syncing it.
import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import {
  billingCases,
  billingPeriods,
  manualRuleInputs,
  meterReadings,
} from "../../db/schema/billing";
import { meters } from "../../db/schema/dwellings";
import { getApplicableRulesForDwelling } from "../billing/rules";

export interface MissingMeterReadingItem {
  meterId: string;
  meterType: string;
  label: string | null;
  reason: "NO_READING";
}

// MANUAL_QUANTITY/MANUAL_AMOUNT rules (spec Section 18) need a per-case
// admin-supplied value the same way METER_CONSUMPTION needs a reading --
// tracked as missing data until manual_rule_inputs has a row for this
// (period, dwelling, rule).
export interface MissingManualRuleInputItem {
  billingRuleId: string;
  ruleName: string;
  unit: string;
  reason: "NO_MANUAL_INPUT";
}

export type MissingDataItem =
  MissingMeterReadingItem | MissingManualRuleInputItem;

interface PeriodDateRange {
  startsOn: string;
  endsOn: string;
}

interface MeterActiveWindow {
  installedAt: string | null;
  archivedAt: Date | null;
}

// A meter needs a reading for a period -- and, symmetrically, an admin may
// still back-fill a reading for it -- if it existed (installed, not yet
// archived) at some point during the period; one installed after the
// period ends, or archived before it starts, is excluded (spec Section 16
// step 4, "determine required readings/data"). Exported so readings.ts can
// apply the identical rule when deciding whether a since-archived meter is
// still a legitimate admin backfill target.
export function wasMeterActiveDuringPeriod(
  meter: MeterActiveWindow,
  period: PeriodDateRange
): boolean {
  const startsOn = new Date(period.startsOn);
  const endsOn = new Date(period.endsOn);
  if (meter.installedAt && new Date(meter.installedAt) > endsOn) return false;
  if (meter.archivedAt && new Date(meter.archivedAt) < startsOn) return false;
  return true;
}

type ApplicableRule = Awaited<
  ReturnType<typeof getApplicableRulesForDwelling>
>[number];

// A meter only requires a reading if some APPLICABLE METER_CONSUMPTION rule
// actually consumes its type -- before per-dwelling scoping existed, every
// METER_CONSUMPTION rule was implicitly org-wide, so "this meter type has a
// rule somewhere in the org" and "this rule applies to this dwelling" were
// the same fact. They no longer are: a ONE_TO_ONE/ONE_TO_MANY meter rule
// scoped to OTHER dwellings must not make an unrelated dwelling's same-type
// meter seem billable, or block that dwelling's invoice on a reading nothing
// will ever use (spec: "don't let an unrelated tariff's existence make every
// org meter seem billable").
async function requiredMetersForPeriod(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string,
  period: PeriodDateRange,
  applicableRules: ApplicableRule[]
) {
  const dwellingMeters = await tx
    .select()
    .from(meters)
    .where(
      and(
        eq(meters.dwellingId, dwellingId),
        eq(meters.organizationId, organizationId)
      )
    );
  const active = dwellingMeters.filter((m) =>
    wasMeterActiveDuringPeriod(m, period)
  );
  if (active.length === 0) return active;
  const meteredTypes = new Set(
    applicableRules
      .filter((r) => r.calculationType === "METER_CONSUMPTION" && r.meterType)
      .map((r) => r.meterType)
  );
  return active.filter((m) => meteredTypes.has(m.type));
}

// Dwelling-scoped: a ONE_TO_ONE/ONE_TO_MANY manual rule must only ever
// require input from the dwellings it's actually assigned to (spec: "a
// ONE_TO_ONE manual rule on Apartment 5 must not require input from
// Apartment 6").
function requiredManualRulesForPeriod(applicableRules: ApplicableRule[]) {
  return applicableRules.filter(
    (r) =>
      r.calculationType === "MANUAL_QUANTITY" ||
      r.calculationType === "MANUAL_AMOUNT"
  );
}

export async function computeMissingData(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string,
  periodId: string,
  period: PeriodDateRange
): Promise<MissingDataItem[]> {
  const applicableRules = await getApplicableRulesForDwelling(
    tx,
    organizationId,
    dwellingId,
    period
  );
  const requiredMeters = await requiredMetersForPeriod(
    tx,
    organizationId,
    dwellingId,
    period,
    applicableRules
  );
  const requiredManualRules = requiredManualRulesForPeriod(applicableRules);
  if (requiredMeters.length === 0 && requiredManualRules.length === 0) {
    return [];
  }

  const readings = await tx
    .select({ meterId: meterReadings.meterId })
    .from(meterReadings)
    .where(eq(meterReadings.periodId, periodId));
  const readMeterIds = new Set(readings.map((r) => r.meterId));

  const missingMeters: MissingDataItem[] = requiredMeters
    .filter((m) => !readMeterIds.has(m.id))
    .map((m) => ({
      meterId: m.id,
      meterType: m.type,
      label: m.label,
      reason: "NO_READING" as const,
    }));

  let missingManualInputs: MissingDataItem[] = [];
  if (requiredManualRules.length > 0) {
    const inputs = await tx
      .select({ billingRuleId: manualRuleInputs.billingRuleId })
      .from(manualRuleInputs)
      .where(
        and(
          eq(manualRuleInputs.periodId, periodId),
          eq(manualRuleInputs.dwellingId, dwellingId),
          inArray(
            manualRuleInputs.billingRuleId,
            requiredManualRules.map((r) => r.id)
          )
        )
      );
    const suppliedRuleIds = new Set(inputs.map((i) => i.billingRuleId));
    missingManualInputs = requiredManualRules
      .filter((r) => !suppliedRuleIds.has(r.id))
      .map((r) => ({
        billingRuleId: r.id,
        ruleName: r.name,
        unit: r.unit,
        reason: "NO_MANUAL_INPUT" as const,
      }));
  }

  return [...missingMeters, ...missingManualInputs];
}

// The pre-invoice status derived purely from missingData -- shared by case
// creation (periods.ts) and readiness recalculation below, so both agree on
// what "no missing data" means before an invoice exists.
export function deriveReadinessStatus(
  missingData: MissingDataItem[]
): "MISSING_DATA" | "READY" {
  return missingData.length === 0 ? "READY" : "MISSING_DATA";
}

// Recomputes and persists missing_data for one billing_case. Call this
// inside the same transaction as whatever changed the inputs (a reading
// write, a meter create/archive) so the case never reflects a half-applied
// change. A no-op billing_case (period locked, case not found -- e.g. a
// meter created after the period closed) is left untouched.
export async function recalculateCaseReadiness(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string,
  periodId: string
) {
  const [period] = await tx
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.id, periodId))
    .limit(1);
  if (!period) return;

  const [existingCase] = await tx
    .select()
    .from(billingCases)
    .where(
      and(
        eq(billingCases.periodId, periodId),
        eq(billingCases.dwellingId, dwellingId)
      )
    )
    .limit(1);
  if (!existingCase) return;

  const missingData = await computeMissingData(
    tx,
    organizationId,
    dwellingId,
    periodId,
    period
  );
  const missingDataChanged =
    JSON.stringify(existingCase.missingData) !== JSON.stringify(missingData);

  // Only the pre-invoice stage tracks live readiness; a case that already
  // has an invoice (DRAFT or later) keeps its status regardless of what
  // missingData now says (e.g. a meter added after generation).
  const nextStatus =
    existingCase.status === "MISSING_DATA" || existingCase.status === "READY"
      ? deriveReadinessStatus(missingData)
      : existingCase.status;

  if (!missingDataChanged && nextStatus === existingCase.status) return;

  await tx
    .update(billingCases)
    .set({ missingData, status: nextStatus, statusUpdatedAt: new Date() })
    .where(eq(billingCases.id, existingCase.id));
}

// Creating or archiving a meter changes what's required for every OPEN
// period's case for that dwelling (a LOCKED period's cases are frozen, so
// skip those). Called from meter CRUD, not just reading submission.
export async function recalculateCaseReadinessForOpenPeriods(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string
) {
  const openCases = await tx
    .select({ periodId: billingCases.periodId })
    .from(billingCases)
    .innerJoin(billingPeriods, eq(billingPeriods.id, billingCases.periodId))
    .where(
      and(
        eq(billingCases.dwellingId, dwellingId),
        eq(billingPeriods.organizationId, organizationId),
        eq(billingPeriods.status, "OPEN")
      )
    );
  for (const { periodId } of openCases) {
    await recalculateCaseReadiness(tx, organizationId, dwellingId, periodId);
  }
}

// Creating, enabling, disabling, archiving, or re-dating a billing rule
// changes what's required for every OPEN period's case *across the whole
// organization* -- unlike a meter, a rule isn't scoped to one dwelling
// (spec Section 18: FIXED/AREA/RESIDENT_COUNT/MANUAL_* apply to every
// dwelling unconditionally). Only MANUAL_QUANTITY/MANUAL_AMOUNT rules can
// actually change missingData today (the other types have no missing-data
// concept), but this runs for any rule change since it's cheap relative to
// a rule edit and correct regardless of calculation type.
export async function recalculateCaseReadinessForOrganizationOpenPeriods(
  tx: DbOrTx,
  organizationId: string
) {
  const openCases = await tx
    .select({
      periodId: billingCases.periodId,
      dwellingId: billingCases.dwellingId,
    })
    .from(billingCases)
    .innerJoin(billingPeriods, eq(billingPeriods.id, billingCases.periodId))
    .where(
      and(
        eq(billingPeriods.organizationId, organizationId),
        eq(billingPeriods.status, "OPEN")
      )
    );
  for (const { periodId, dwellingId } of openCases) {
    await recalculateCaseReadiness(tx, organizationId, dwellingId, periodId);
  }
}
