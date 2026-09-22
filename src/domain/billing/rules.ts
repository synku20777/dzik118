// Phase F (Billing) - Billing rule CRUD and effective-rule resolution (spec
// Section 13.9, 18, BIL-001..005). Callers must call
// requireOrganizationAccess() before calling any of these (spec Section 14).
//
// billing_rules is a live, mutable table of current terms, not a version
// history: `code` is unique per org, so a tariff change edits the same row
// (or archives it and creates a new one with a different code). effective_from/
// effective_until just say "this rule counts for periods within this window"
// (BIL-005) -- they are not multiple historical rows for one code. Past
// invoices are protected from a later edit not by row history here but by
// invoice_lines.source_snapshot, taken at generation time (spec Section 21).
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../../db/client";
import {
  billingCalculationTypeEnum,
  billingRuleAssignments,
  billingRuleScopeEnum,
  billingRules,
} from "../../db/schema/billing";
import { dwellings, meterTypeEnum } from "../../db/schema/dwellings";
import { isUniqueViolation } from "../../lib/db-errors";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  recalculateCaseReadinessForOpenPeriods,
  recalculateCaseReadinessForOrganizationOpenPeriods,
} from "../periods/case-readiness";

export { ConflictError, NotFoundError, ValidationError };

export type BillingRuleScope = (typeof billingRuleScopeEnum.enumValues)[number];

// undefined/null/blank are "not supplied"; every other string (including
// "0", "0.00", "0.0000") is a supplied value. Never use JS truthiness here
// -- unitPrice "0" is valid financial data (spec: a zero-price tariff must
// never be treated as absent).
function isBlank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === "";
}

export interface CreateBillingRuleInput {
  name: string;
  // Optional translated invoice labels -- `name` is the Latvian canonical
  // label; a missing translation falls back to it at render time.
  nameEn?: string | null;
  nameRu?: string | null;
  code: string;
  description?: string;
  calculationType: (typeof billingCalculationTypeEnum.enumValues)[number];
  meterType?: (typeof meterTypeEnum.enumValues)[number] | null;
  unit: string;
  unitPrice?: string | null;
  vatRate?: string;
  effectiveFrom: string;
  effectiveUntil?: string;
  applicationScope?: BillingRuleScope;
  dwellingIds?: string[];
  sortOrder?: number;
  enabled?: boolean;
}

// A rule missing a field its calculation type needs wouldn't fail loudly
// at generation time -- METER_CONSUMPTION would just silently skip the
// line (no meterType to match against), and a missing unitPrice would
// silently bill 0 net (spec Section 18's formula treats a null price as
// 0, not an error). Catching it here, at the only place these fields are
// ever set, is cheaper and safer than re-validating on every generation.
// Called with the FINAL merged candidate (existing row + patch), not a
// partial patch alone, so e.g. switching calculationType away from
// METER_CONSUMPTION without also clearing a stale meterType still passes.
function validateRuleShape(candidate: {
  calculationType: string;
  meterType?: string | null;
  unitPrice?: string | null;
}) {
  if (
    candidate.calculationType === "METER_CONSUMPTION" &&
    isBlank(candidate.meterType)
  ) {
    throw new ValidationError("A meter consumption rule requires a meter type");
  }
  if (
    candidate.calculationType !== "MANUAL_AMOUNT" &&
    isBlank(candidate.unitPrice)
  ) {
    throw new ValidationError(
      "This rule requires a unit price (it would otherwise always bill 0)"
    );
  }
}

// Cardinality + tenant-membership checks for the assignment set a
// create/update is about to write. Scope is the only source of truth for
// how many dwellingIds are allowed -- ONE_TO_ALL must have none (it never
// uses assignment rows), ONE_TO_ONE must have exactly one.
async function validateAssignmentTargets(
  tx: Tx,
  organizationId: string,
  scope: BillingRuleScope,
  dwellingIds: string[]
) {
  const unique = [...new Set(dwellingIds)];
  if (scope === "ONE_TO_ALL" && unique.length > 0) {
    throw new ValidationError(
      "A rule that applies to all dwellings cannot also have specific dwelling assignments"
    );
  }
  if (scope === "ONE_TO_ONE" && unique.length !== 1) {
    throw new ValidationError(
      "A one-to-one rule must be assigned to exactly one dwelling"
    );
  }
  if (unique.length === 0) return unique;
  const rows = await tx
    .select({ id: dwellings.id })
    .from(dwellings)
    .where(
      and(
        eq(dwellings.organizationId, organizationId),
        inArray(dwellings.id, unique)
      )
    );
  if (rows.length !== unique.length) {
    throw new ValidationError(
      "One or more selected dwellings do not belong to this organization"
    );
  }
  return unique;
}

// Delete-and-reinsert inside the caller's transaction -- simplest correct
// strategy for these org sizes (spec: "acceptable for ordinary org sizes").
// Does not enforce ONE_TO_ONE-belongs-to-only-one-dwelling across rules;
// that's the unique(billing_rule_id, dwelling_id) constraint's job for
// per-row uniqueness plus validateAssignmentTargets's cardinality check for
// this rule's own row count -- a dwelling having two different ONE_TO_ONE
// rules is fine and expected (spec's two-parking-entitlements example).
async function replaceRuleAssignments(
  tx: Tx,
  organizationId: string,
  billingRuleId: string,
  dwellingIds: string[]
) {
  await tx
    .delete(billingRuleAssignments)
    .where(eq(billingRuleAssignments.billingRuleId, billingRuleId));
  if (dwellingIds.length === 0) return;
  await tx.insert(billingRuleAssignments).values(
    dwellingIds.map((dwellingId) => ({
      organizationId,
      billingRuleId,
      dwellingId,
    }))
  );
}

// Only these two calculation types can ever produce missing_data (spec
// Section 18) -- FIXED/AREA/RESIDENT_COUNT/METER_CONSUMPTION are either
// always derivable or already tracked via meters, so a create/update/
// archive of one of those never needs the (org-wide, all-open-periods)
// readiness recalculation below.
function isManualCalculationType(
  calculationType: string
): calculationType is "MANUAL_QUANTITY" | "MANUAL_AMOUNT" {
  return (
    calculationType === "MANUAL_QUANTITY" || calculationType === "MANUAL_AMOUNT"
  );
}

export async function createRule(
  db: Db,
  organizationId: string,
  input: CreateBillingRuleInput,
  actorUserId: string
) {
  validateRuleShape(input);
  const scope = input.applicationScope ?? "ONE_TO_ALL";
  const { dwellingIds = [], ...ruleFields } = input;
  try {
    return await db.transaction(async (tx) => {
      const targets = await validateAssignmentTargets(
        tx,
        organizationId,
        scope,
        dwellingIds
      );
      const [rule] = await tx
        .insert(billingRules)
        .values({ organizationId, ...ruleFields, applicationScope: scope })
        .returning();
      if (targets.length > 0) {
        await replaceRuleAssignments(tx, organizationId, rule.id, targets);
      }
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "BILLING_RULE_CREATED",
        entityType: "billing_rule",
        entityId: rule.id,
        afterData: { ...rule, dwellingIds: targets },
      });
      // A new enabled manual rule immediately requires input on every open
      // period's case its scope applies to -- without this, existing cases
      // would keep showing READY/whatever they last computed until some
      // unrelated write (a reading, a meter change) happened to recalculate
      // them. Org-wide recalculation is still correct for a scoped rule:
      // recalculateCaseReadiness resolves applicability per dwelling.
      if (isManualCalculationType(rule.calculationType) && rule.enabled) {
        await recalculateCaseReadinessForOrganizationOpenPeriods(
          tx,
          organizationId
        );
      }
      return rule;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        `A billing rule with code "${input.code}" already exists in this organization`
      );
    }
    throw err;
  }
}

export async function getRule(
  db: DbOrTx,
  organizationId: string,
  ruleId: string
) {
  const [rule] = await db
    .select()
    .from(billingRules)
    .where(
      and(
        eq(billingRules.id, ruleId),
        eq(billingRules.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!rule) throw new NotFoundError("Billing rule not found");
  return rule;
}

export async function listRules(
  db: Db,
  organizationId: string,
  options: { includeArchived?: boolean } = {}
) {
  const conditions = [eq(billingRules.organizationId, organizationId)];
  if (!options.includeArchived) {
    conditions.push(isNull(billingRules.archivedAt));
  }
  return db
    .select()
    .from(billingRules)
    .where(and(...conditions))
    .orderBy(asc(billingRules.sortOrder), asc(billingRules.name));
}

export interface UpdateBillingRuleInput {
  name?: string;
  nameEn?: string | null;
  nameRu?: string | null;
  code?: string;
  description?: string | null;
  calculationType?: (typeof billingCalculationTypeEnum.enumValues)[number];
  meterType?: (typeof meterTypeEnum.enumValues)[number] | null;
  unit?: string;
  unitPrice?: string | null;
  vatRate?: string;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
  applicationScope?: BillingRuleScope;
  // Only meaningful when applicationScope resolves to ONE_TO_MANY/ONE_TO_ONE
  // (own value or the rule's current one, whichever the merged candidate
  // ends up with). Omitted entirely -> assignments are left untouched.
  dwellingIds?: string[];
  sortOrder?: number;
  enabled?: boolean;
}

// `code`, `calculationType`, `meterType`, and `unit` are editable: past
// invoices are protected by invoice_lines.source_snapshot (a full copy of
// the rule taken at generation time), never by re-reading the live
// billing_rules row, so editing these only changes what FUTURE generation
// does. Validation runs against the FINAL merged candidate (before + patch),
// not the patch alone, so e.g. switching to MANUAL_AMOUNT without touching
// unitPrice still re-checks the combination that will actually be saved.
export async function updateRule(
  db: Db,
  organizationId: string,
  ruleId: string,
  input: UpdateBillingRuleInput,
  actorUserId: string
) {
  const { dwellingIds, ...patch } = input;
  try {
    return await db.transaction(async (tx) => {
      // FOR UPDATE: this rule's scope/assignments can also change from the
      // dwelling side (setDwellingRuleParticipation) -- locking here
      // serializes the two paths against the same rule the same way
      // setDwellingRuleParticipation locks a ONE_TO_ONE rule it's touching.
      const [lockedBefore] = await tx
        .select()
        .from(billingRules)
        .where(
          and(
            eq(billingRules.id, ruleId),
            eq(billingRules.organizationId, organizationId)
          )
        )
        .for("update")
        .limit(1);
      if (!lockedBefore) throw new NotFoundError("Billing rule not found");
      const before = lockedBefore;
      const candidate = { ...before, ...patch };
      validateRuleShape(candidate);

      const scope = candidate.applicationScope;
      let targets: string[] | undefined;
      if (dwellingIds !== undefined) {
        targets = await validateAssignmentTargets(
          tx,
          organizationId,
          scope,
          dwellingIds
        );
      } else if (patch.applicationScope !== undefined) {
        // Scope changed but no explicit dwellingIds given -- re-validate
        // whatever assignments already exist against the NEW scope (e.g. a
        // rule with 3 dwellings switched to ONE_TO_ONE must be rejected,
        // not silently left with 3 rows under a scope that forbids that).
        const existing = await tx
          .select({ dwellingId: billingRuleAssignments.dwellingId })
          .from(billingRuleAssignments)
          .where(eq(billingRuleAssignments.billingRuleId, ruleId));
        targets = await validateAssignmentTargets(
          tx,
          organizationId,
          scope,
          existing.map((r) => r.dwellingId)
        );
      }

      const [after] = await tx
        .update(billingRules)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(billingRules.id, ruleId),
            eq(billingRules.organizationId, organizationId)
          )
        )
        .returning();

      if (targets !== undefined) {
        await replaceRuleAssignments(tx, organizationId, ruleId, targets);
      }

      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "BILLING_RULE_UPDATED",
        entityType: "billing_rule",
        entityId: ruleId,
        beforeData: before,
        afterData: { ...after, dwellingIds: targets },
      });
      // enabled, the effective window, calculation type, or scope/assignment
      // changes can all change whether a manual rule currently applies to a
      // given dwelling -- either direction needs every open case's
      // missingData re-derived. Org-wide is still correct: readiness now
      // resolves applicability per dwelling.
      if (
        isManualCalculationType(after.calculationType) ||
        isManualCalculationType(before.calculationType)
      ) {
        await recalculateCaseReadinessForOrganizationOpenPeriods(
          tx,
          organizationId
        );
      }
      return after;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        `A billing rule with code "${input.code}" already exists in this organization`
      );
    }
    throw err;
  }
}

export async function archiveRule(
  db: Db,
  organizationId: string,
  ruleId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [rule] = await tx
      .update(billingRules)
      .set({ archivedAt: new Date(), enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(billingRules.id, ruleId),
          eq(billingRules.organizationId, organizationId)
        )
      )
      .returning();
    if (!rule) throw new NotFoundError("Billing rule not found");
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "BILLING_RULE_ARCHIVED",
      entityType: "billing_rule",
      entityId: ruleId,
    });
    if (isManualCalculationType(rule.calculationType)) {
      await recalculateCaseReadinessForOrganizationOpenPeriods(
        tx,
        organizationId
      );
    }
    return rule;
  });
}

interface PeriodDateRange {
  startsOn: string;
  endsOn: string;
}

// BIL-005: only the effective rule version applied -- enabled, not
// archived, and this period's date range overlaps [effective_from,
// effective_until or forever).
export async function getEffectiveRules(
  db: DbOrTx,
  organizationId: string,
  period: PeriodDateRange
) {
  return db
    .select()
    .from(billingRules)
    .where(
      and(
        eq(billingRules.organizationId, organizationId),
        eq(billingRules.enabled, true),
        isNull(billingRules.archivedAt),
        lte(billingRules.effectiveFrom, period.endsOn),
        or(
          isNull(billingRules.effectiveUntil),
          gte(billingRules.effectiveUntil, period.startsOn)
        )
      )
    )
    .orderBy(asc(billingRules.sortOrder), asc(billingRules.name));
}

// The canonical per-dwelling applicability resolver -- every caller that
// needs to know "which rules actually apply to THIS dwelling this period"
// (invoice generation, case readiness) must go through this, not
// getEffectiveRules directly, or ONE_TO_MANY/ONE_TO_ONE rules leak onto
// every dwelling's invoice again.
export async function getApplicableRulesForDwelling(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string,
  period: PeriodDateRange
) {
  const rules = await getEffectiveRules(db, organizationId, period);
  const scoped = rules.filter((r) => r.applicationScope !== "ONE_TO_ALL");
  if (scoped.length === 0) return rules;
  const assigned = await db
    .select({ billingRuleId: billingRuleAssignments.billingRuleId })
    .from(billingRuleAssignments)
    .where(
      and(
        eq(billingRuleAssignments.dwellingId, dwellingId),
        inArray(
          billingRuleAssignments.billingRuleId,
          scoped.map((r) => r.id)
        )
      )
    );
  const assignedIds = new Set(assigned.map((a) => a.billingRuleId));
  return rules.filter(
    (r) => r.applicationScope === "ONE_TO_ALL" || assignedIds.has(r.id)
  );
}

// For the tariff drawer's edit-mode prefill and the "Applies to" column.
export async function getRuleAssignedDwellingIds(
  db: DbOrTx,
  billingRuleId: string
): Promise<string[]> {
  const rows = await db
    .select({ dwellingId: billingRuleAssignments.dwellingId })
    .from(billingRuleAssignments)
    .where(eq(billingRuleAssignments.billingRuleId, billingRuleId));
  return rows.map((r) => r.dwellingId);
}

// Dwelling page's "Recurring tariffs" section -- which ONE_TO_MANY/
// ONE_TO_ONE rules THIS dwelling currently participates in.
export async function getAssignedRuleIdsForDwelling(
  db: DbOrTx,
  dwellingId: string
): Promise<Set<string>> {
  const rows = await db
    .select({ billingRuleId: billingRuleAssignments.billingRuleId })
    .from(billingRuleAssignments)
    .where(eq(billingRuleAssignments.dwellingId, dwellingId));
  return new Set(rows.map((r) => r.billingRuleId));
}

// Batch form of the above for the tariff list page -- one query for every
// non-ONE_TO_ALL rule's assignments, joined to the dwelling number so the
// "Applies to" column never has to show a raw UUID.
export async function listRuleAssignmentsWithDwellingNumbers(
  db: DbOrTx,
  organizationId: string
): Promise<Map<string, { dwellingId: string; number: string }[]>> {
  const rows = await db
    .select({
      billingRuleId: billingRuleAssignments.billingRuleId,
      dwellingId: billingRuleAssignments.dwellingId,
      number: dwellings.number,
    })
    .from(billingRuleAssignments)
    .innerJoin(dwellings, eq(dwellings.id, billingRuleAssignments.dwellingId))
    .where(eq(billingRuleAssignments.organizationId, organizationId));
  const map = new Map<string, { dwellingId: string; number: string }[]>();
  for (const row of rows) {
    const list = map.get(row.billingRuleId) ?? [];
    list.push({ dwellingId: row.dwellingId, number: row.number });
    map.set(row.billingRuleId, list);
  }
  return map;
}

// Dwelling-side "Manage tariffs": a resident/admin can toggle THIS
// dwelling's participation in ONE_TO_MANY/ONE_TO_ONE rules, never touch a
// rule's own definition (name/price/scope/etc -- that's Tariffs & Rules'
// job only). ONE_TO_ALL rules are never accepted here (informational-only
// on the dwelling side, per spec: "cannot be individually unchecked").
// A ONE_TO_ONE rule already assigned to a DIFFERENT dwelling is rejected
// outright rather than silently moved -- the UI is expected to disable
// that checkbox up front (see the dwelling page's drawer), this is
// defense in depth against a stale/tampered submission.
export async function setDwellingRuleParticipation(
  db: Db,
  organizationId: string,
  dwellingId: string,
  billingRuleIds: string[],
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [dwelling] = await tx
      .select({ id: dwellings.id })
      .from(dwellings)
      .where(
        and(
          eq(dwellings.id, dwellingId),
          eq(dwellings.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!dwelling) throw new NotFoundError("Dwelling not found");

    // Matches the dwelling page's own filter exactly (enabled, non-archived,
    // non-ONE_TO_ALL) -- a rule this call doesn't consider "eligible" must
    // never be touched, disabled included. Without the enabled filter here,
    // a disabled rule the UI never rendered as a checkbox (so it can never
    // appear in `billingRuleIds`) would still count as "currently assigned
    // but not desired" below and get silently unassigned by an unrelated
    // save.
    const eligibleRules = await tx
      .select({
        id: billingRules.id,
        applicationScope: billingRules.applicationScope,
      })
      .from(billingRules)
      .where(
        and(
          eq(billingRules.organizationId, organizationId),
          eq(billingRules.enabled, true),
          isNull(billingRules.archivedAt),
          inArray(billingRules.applicationScope, ["ONE_TO_MANY", "ONE_TO_ONE"])
        )
      );
    const eligibleIds = new Set(eligibleRules.map((r) => r.id));
    const desired = [...new Set(billingRuleIds)];
    const invalid = desired.filter((id) => !eligibleIds.has(id));
    if (invalid.length > 0) {
      throw new ValidationError(
        "One or more selected tariffs are not eligible for dwelling-level assignment"
      );
    }

    // Only assignments to a currently-eligible rule are in scope for this
    // call -- an assignment to an ineligible rule (disabled, archived, or
    // switched to ONE_TO_ALL since assigned) is left completely alone.
    const currentRows = await tx
      .select({ billingRuleId: billingRuleAssignments.billingRuleId })
      .from(billingRuleAssignments)
      .where(eq(billingRuleAssignments.dwellingId, dwellingId));
    const current = new Set(
      currentRows
        .map((r) => r.billingRuleId)
        .filter((id) => eligibleIds.has(id))
    );

    const toAdd = desired.filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.includes(id));

    const scopeById = new Map(
      eligibleRules.map((r) => [r.id, r.applicationScope])
    );
    // Every ONE_TO_ONE rule this call touches (add OR remove) gets its
    // billing_rules row locked first, serializing concurrent calls against
    // the SAME rule so the "is it already assigned elsewhere" check below
    // can't race with another transaction's insert of a competing
    // assignment (the unique constraint only prevents the same (rule,
    // dwelling) pair twice, not two different dwellings for one ONE_TO_ONE
    // rule).
    // Sorted so two concurrent calls touching the same two ONE_TO_ONE rules
    // always lock them in the same order (deadlock avoidance).
    const oneToOneTouched = [...toAdd, ...toRemove]
      .filter((id) => scopeById.get(id) === "ONE_TO_ONE")
      .sort();
    for (const ruleId of oneToOneTouched) {
      await tx
        .select({ id: billingRules.id })
        .from(billingRules)
        .where(eq(billingRules.id, ruleId))
        .for("update");
    }
    // A ONE_TO_ONE tariff can never be unassigned from here down to zero
    // dwellings -- that would violate "exactly one dwelling at all times".
    // Moving it is only possible by assigning it to a different dwelling
    // directly (which itself requires editing the tariff, per the conflict
    // check below) or by editing the tariff's own scope/assignment in
    // Tariffs & Rules.
    const orphanedOneToOne = toRemove.find(
      (id) => scopeById.get(id) === "ONE_TO_ONE"
    );
    if (orphanedOneToOne) {
      throw new ConflictError(
        "A one-to-one tariff cannot be unassigned this way; edit the tariff directly to move or remove it"
      );
    }
    for (const ruleId of toAdd) {
      if (scopeById.get(ruleId) !== "ONE_TO_ONE") continue;
      const [conflict] = await tx
        .select({ dwellingId: billingRuleAssignments.dwellingId })
        .from(billingRuleAssignments)
        .where(eq(billingRuleAssignments.billingRuleId, ruleId))
        .limit(1);
      if (conflict && conflict.dwellingId !== dwellingId) {
        throw new ConflictError(
          "This tariff is already assigned to another dwelling; edit the tariff directly to move it"
        );
      }
    }

    if (toRemove.length > 0) {
      await tx
        .delete(billingRuleAssignments)
        .where(
          and(
            eq(billingRuleAssignments.dwellingId, dwellingId),
            inArray(billingRuleAssignments.billingRuleId, toRemove)
          )
        );
    }
    if (toAdd.length > 0) {
      await tx.insert(billingRuleAssignments).values(
        toAdd.map((billingRuleId) => ({
          organizationId,
          billingRuleId,
          dwellingId,
        }))
      );
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "DWELLING_TARIFF_ASSIGNMENTS_UPDATED",
        entityType: "dwelling",
        entityId: dwellingId,
        beforeData: { billingRuleIds: [...current] },
        afterData: { billingRuleIds: desired },
      });
      // A newly assigned/unassigned MANUAL_QUANTITY/MANUAL_AMOUNT rule
      // changes this dwelling's missing-data requirement immediately.
      await recalculateCaseReadinessForOpenPeriods(
        tx,
        organizationId,
        dwellingId
      );
    }

    return { added: toAdd, removed: toRemove };
  });
}
