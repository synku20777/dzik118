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
  billingRuleAssignments,
  manualRuleInputs,
  meterReadings,
} from "../../db/schema/billing";
import { meters } from "../../db/schema/dwellings";
import { getEffectiveRules } from "../billing/rules";

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

// A METER_CONSUMPTION rule assigned to this dwelling by name (ONE_TO_ONE /
// ONE_TO_MANY) that has no meter of its type active in the period. The rule
// cannot produce an invoice line, and the assignment says it must. An
// org-wide (ONE_TO_ALL) meter rule on a dwelling without that meter type is
// not a blocker: the rule does not apply there.
export interface NoActiveMeterForRuleItem {
  billingRuleId: string;
  ruleName: string;
  meterType: string;
  reason: "NO_ACTIVE_METER_FOR_RULE";
}

// No rule can produce an invoice line for this dwelling in this period, so
// there is nothing to invoice.
export interface NoApplicableRulesItem {
  reason: "NO_APPLICABLE_RULES";
}

// billing_cases.missing_data holds every blocker, not only missing inputs:
// READY means "the invoice can be generated".
export type MissingDataItem =
  | MissingMeterReadingItem
  | MissingManualRuleInputItem
  | NoActiveMeterForRuleItem
  | NoApplicableRulesItem;

// The one message for a blocked case. generateInvoice and bulk generation
// both use it, so the single and the bulk path give the same reason. Items
// are `unknown` because an old row can hold a legacy plain string.
export function invoiceBlockerMessage(items: unknown[]): string {
  const reasons = new Set(
    items.map((i) =>
      i && typeof i === "object" ? (i as { reason?: string }).reason : undefined
    )
  );
  if (reasons.has("NO_APPLICABLE_RULES")) {
    return "No billing rules apply to this dwelling for this period";
  }
  if (reasons.has("NO_ACTIVE_METER_FOR_RULE") && reasons.size === 1) {
    return "A billing rule assigned to this dwelling has no active meter for this period";
  }
  return "This dwelling has missing data for this period and cannot be invoiced yet";
}

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

type ApplicableRule = Awaited<ReturnType<typeof getEffectiveRules>>[number];

// A meter only requires a reading if some APPLICABLE METER_CONSUMPTION rule
// actually consumes its type -- before per-dwelling scoping existed, every
// METER_CONSUMPTION rule was implicitly org-wide, so "this meter type has a
// rule somewhere in the org" and "this rule applies to this dwelling" were
// the same fact. They no longer are: a ONE_TO_ONE/ONE_TO_MANY meter rule
// scoped to OTHER dwellings must not make an unrelated dwelling's same-type
// meter seem billable, or block that dwelling's invoice on a reading nothing
// will ever use (spec: "don't let an unrelated tariff's existence make every
// org meter seem billable").
//
// The single answer to "can this dwelling be invoiced for this period?".
// Case readiness stores `blockers`; generateInvoice builds its lines from
// `billableRules` and refuses when `blockers` is not empty. Because both use
// this function, READY cannot disagree with generation. With no blockers,
// every billable rule produces a line and there is at least one.
export interface InvoiceEligibility {
  blockers: MissingDataItem[];
  billableRules: ApplicableRule[];
  // Meters that need a reading for this period (the setup checks that each
  // has a starting reading).
  requiredMeterIds: string[];
}

// Everything the rules below need for ONE dwelling, already loaded. The
// decision is pure, so a single dwelling (generation, readiness) and a whole
// organization (setup progress) share exactly the same logic and cannot
// drift apart.
interface EligibilityInputs {
  // Effective rules for the period, every scope.
  rules: ApplicableRule[];
  // Ids of the scoped rules assigned to this dwelling.
  assignedRuleIds: Set<string>;
  meters: (typeof meters.$inferSelect)[];
  // Meters that already have a reading in this period.
  readMeterIds: Set<string>;
  // Manual rules that already have an input for this dwelling and period.
  suppliedRuleIds: Set<string>;
}

function evaluateEligibility(
  inputs: EligibilityInputs,
  period: PeriodDateRange
): InvoiceEligibility {
  const applicableRules = inputs.rules.filter(
    (r) =>
      r.applicationScope === "ONE_TO_ALL" || inputs.assignedRuleIds.has(r.id)
  );
  const dwellingMeters = inputs.meters;
  const activeMeters = dwellingMeters.filter((m) =>
    wasMeterActiveDuringPeriod(m, period)
  );
  const activeTypes = new Set<string>(activeMeters.map((m) => m.type));

  // A meter rule is billable only where a meter of its type was active.
  const isMeterRule = (r: ApplicableRule) =>
    r.calculationType === "METER_CONSUMPTION";
  const billableRules = applicableRules.filter(
    (r) => !isMeterRule(r) || (r.meterType && activeTypes.has(r.meterType))
  );
  const noActiveMeter: MissingDataItem[] = applicableRules
    .filter(
      (r) =>
        isMeterRule(r) &&
        r.applicationScope !== "ONE_TO_ALL" &&
        !billableRules.includes(r)
    )
    .map((r) => ({
      billingRuleId: r.id,
      ruleName: r.name,
      meterType: r.meterType ?? "",
      reason: "NO_ACTIVE_METER_FOR_RULE" as const,
    }));

  const meteredTypes = new Set(
    billableRules.filter(isMeterRule).map((r) => r.meterType)
  );
  const requiredMeters = activeMeters.filter((m) => meteredTypes.has(m.type));
  // Dwelling-scoped: a ONE_TO_ONE/ONE_TO_MANY manual rule must only ever
  // require input from the dwellings it's actually assigned to (spec: "a
  // ONE_TO_ONE manual rule on Apartment 5 must not require input from
  // Apartment 6").
  const requiredManualRules = billableRules.filter(
    (r) =>
      r.calculationType === "MANUAL_QUANTITY" ||
      r.calculationType === "MANUAL_AMOUNT"
  );

  const missingMeters: MissingDataItem[] = requiredMeters
    .filter((m) => !inputs.readMeterIds.has(m.id))
    .map((m) => ({
      meterId: m.id,
      meterType: m.type,
      label: m.label,
      reason: "NO_READING" as const,
    }));

  const missingManualInputs: MissingDataItem[] = requiredManualRules
    .filter((r) => !inputs.suppliedRuleIds.has(r.id))
    .map((r) => ({
      billingRuleId: r.id,
      ruleName: r.name,
      unit: r.unit,
      reason: "NO_MANUAL_INPUT" as const,
    }));

  const blockers = [...missingMeters, ...missingManualInputs, ...noActiveMeter];
  if (billableRules.length === 0 && blockers.length === 0) {
    blockers.push({ reason: "NO_APPLICABLE_RULES" });
  }
  return {
    blockers,
    billableRules,
    requiredMeterIds: requiredMeters.map((m) => m.id),
  };
}

// Loads the inputs for many dwellings at once: five queries however many
// dwellings there are. `onlyDwellingId` narrows every query to one dwelling.
async function resolveEligibilityMany(
  tx: DbOrTx,
  organizationId: string,
  periodId: string,
  period: PeriodDateRange,
  dwellingIds: string[],
  onlyDwellingId?: string
): Promise<Map<string, InvoiceEligibility>> {
  const rules = await getEffectiveRules(tx, organizationId, period);

  const scopedIds = rules
    .filter((r) => r.applicationScope !== "ONE_TO_ALL")
    .map((r) => r.id);
  const assignedByDwelling = new Map<string, Set<string>>();
  if (scopedIds.length > 0) {
    const rows = await tx
      .select({
        billingRuleId: billingRuleAssignments.billingRuleId,
        dwellingId: billingRuleAssignments.dwellingId,
      })
      .from(billingRuleAssignments)
      .where(
        and(
          inArray(billingRuleAssignments.billingRuleId, scopedIds),
          onlyDwellingId
            ? eq(billingRuleAssignments.dwellingId, onlyDwellingId)
            : undefined
        )
      );
    for (const row of rows) {
      const set = assignedByDwelling.get(row.dwellingId) ?? new Set<string>();
      set.add(row.billingRuleId);
      assignedByDwelling.set(row.dwellingId, set);
    }
  }

  const meterRows = await tx
    .select()
    .from(meters)
    .where(
      and(
        eq(meters.organizationId, organizationId),
        onlyDwellingId ? eq(meters.dwellingId, onlyDwellingId) : undefined
      )
    );
  const metersByDwelling = new Map<string, (typeof meters.$inferSelect)[]>();
  for (const m of meterRows) {
    const list = metersByDwelling.get(m.dwellingId) ?? [];
    list.push(m);
    metersByDwelling.set(m.dwellingId, list);
  }

  const readMeterIds = new Set<string>();
  if (meterRows.length > 0) {
    const readings = await tx
      .select({ meterId: meterReadings.meterId })
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.periodId, periodId),
          onlyDwellingId
            ? inArray(
                meterReadings.meterId,
                meterRows.map((m) => m.id)
              )
            : undefined
        )
      );
    for (const r of readings) readMeterIds.add(r.meterId);
  }

  const suppliedByDwelling = new Map<string, Set<string>>();
  if (
    rules.some(
      (r) =>
        r.calculationType === "MANUAL_QUANTITY" ||
        r.calculationType === "MANUAL_AMOUNT"
    )
  ) {
    const rows = await tx
      .select({
        dwellingId: manualRuleInputs.dwellingId,
        billingRuleId: manualRuleInputs.billingRuleId,
      })
      .from(manualRuleInputs)
      .where(
        and(
          eq(manualRuleInputs.periodId, periodId),
          onlyDwellingId
            ? eq(manualRuleInputs.dwellingId, onlyDwellingId)
            : undefined
        )
      );
    for (const row of rows) {
      const set = suppliedByDwelling.get(row.dwellingId) ?? new Set<string>();
      set.add(row.billingRuleId);
      suppliedByDwelling.set(row.dwellingId, set);
    }
  }

  const result = new Map<string, InvoiceEligibility>();
  for (const dwellingId of dwellingIds) {
    result.set(
      dwellingId,
      evaluateEligibility(
        {
          rules,
          assignedRuleIds: assignedByDwelling.get(dwellingId) ?? new Set(),
          meters: metersByDwelling.get(dwellingId) ?? [],
          readMeterIds,
          suppliedRuleIds: suppliedByDwelling.get(dwellingId) ?? new Set(),
        },
        period
      )
    );
  }
  return result;
}

export async function resolveInvoiceEligibility(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string,
  periodId: string,
  period: PeriodDateRange
): Promise<InvoiceEligibility> {
  const result = await resolveEligibilityMany(
    tx,
    organizationId,
    periodId,
    period,
    [dwellingId],
    dwellingId
  );
  return result.get(dwellingId)!;
}

// The same decision for several dwellings in one go (setup progress).
export function resolveInvoiceEligibilityForDwellings(
  tx: DbOrTx,
  organizationId: string,
  dwellingIds: string[],
  periodId: string,
  period: PeriodDateRange
): Promise<Map<string, InvoiceEligibility>> {
  return resolveEligibilityMany(
    tx,
    organizationId,
    periodId,
    period,
    dwellingIds
  );
}

export async function computeMissingData(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string,
  periodId: string,
  period: PeriodDateRange
): Promise<MissingDataItem[]> {
  const { blockers } = await resolveInvoiceEligibility(
    tx,
    organizationId,
    dwellingId,
    periodId,
    period
  );
  return blockers;
}

// The pre-invoice status derived purely from missingData (the blockers) --
// shared by case creation (periods.ts) and readiness recalculation below, so
// both agree that READY means "the invoice can be generated".
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
