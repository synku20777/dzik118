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
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import {
  billingCalculationTypeEnum,
  billingRules,
} from "../../db/schema/billing";
import { meterTypeEnum } from "../../db/schema/dwellings";
import { isUniqueViolation } from "../../lib/db-errors";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { recalculateCaseReadinessForOrganizationOpenPeriods } from "../periods/case-readiness";

export { ConflictError, NotFoundError, ValidationError };

export interface CreateBillingRuleInput {
  name: string;
  code: string;
  description?: string;
  calculationType: (typeof billingCalculationTypeEnum.enumValues)[number];
  meterType?: (typeof meterTypeEnum.enumValues)[number];
  unit: string;
  unitPrice?: string;
  vatRate?: string;
  effectiveFrom: string;
  effectiveUntil?: string;
  sortOrder?: number;
}

// A rule missing a field its calculation type needs wouldn't fail loudly
// at generation time -- METER_CONSUMPTION would just silently skip the
// line (no meterType to match against), and a missing unitPrice would
// silently bill 0 net (spec Section 18's formula treats a null price as
// 0, not an error). Catching it here, at the only place these fields are
// ever set, is cheaper and safer than re-validating on every generation.
function validateRuleShape(input: {
  calculationType: string;
  meterType?: string | null;
  unitPrice?: string | null;
}) {
  if (input.calculationType === "METER_CONSUMPTION" && !input.meterType) {
    throw new ValidationError("A meter consumption rule requires a meter type");
  }
  if (input.calculationType !== "MANUAL_AMOUNT" && !input.unitPrice) {
    throw new ValidationError(
      "This rule requires a unit price (it would otherwise always bill 0)"
    );
  }
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
  try {
    return await db.transaction(async (tx) => {
      const [rule] = await tx
        .insert(billingRules)
        .values({ organizationId, ...input })
        .returning();
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "BILLING_RULE_CREATED",
        entityType: "billing_rule",
        entityId: rule.id,
        afterData: rule,
      });
      // A new enabled manual rule immediately requires input on every open
      // period's case -- without this, existing cases would keep showing
      // READY/whatever they last computed until some unrelated write (a
      // reading, a meter change) happened to recalculate them.
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
  description?: string | null;
  unitPrice?: string | null;
  vatRate?: string;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
  sortOrder?: number;
  enabled?: boolean;
}

// Deliberately does not accept `code`, `calculationType`, or `meterType`:
// changing what a rule measures, or its identity, would misattribute every
// past invoice line snapshot that references it (billing_rule_id). Archive
// and create a new one instead.
export async function updateRule(
  db: Db,
  organizationId: string,
  ruleId: string,
  input: UpdateBillingRuleInput,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const before = await getRule(tx, organizationId, ruleId);
    if (
      input.unitPrice === null &&
      before.calculationType !== "MANUAL_AMOUNT"
    ) {
      throw new ValidationError(
        "This rule requires a unit price (it would otherwise always bill 0)"
      );
    }
    const [after] = await tx
      .update(billingRules)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(billingRules.id, ruleId),
          eq(billingRules.organizationId, organizationId)
        )
      )
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "BILLING_RULE_UPDATED",
      entityType: "billing_rule",
      entityId: ruleId,
      beforeData: before,
      afterData: after,
    });
    // enabled or the effective window can change whether a manual rule
    // currently applies -- either direction (newly required, no longer
    // required) needs every open case's missingData re-derived.
    if (isManualCalculationType(after.calculationType)) {
      await recalculateCaseReadinessForOrganizationOpenPeriods(
        tx,
        organizationId
      );
    }
    return after;
  });
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
