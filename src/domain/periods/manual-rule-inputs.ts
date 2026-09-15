// Phase F (Billing) - Admin-supplied input for MANUAL_QUANTITY/MANUAL_AMOUNT
// billing rules (spec Section 18). Mirrors readings.ts's shape (same
// validate -> lock period -> upsert -> audit -> recalculate-readiness flow)
// for the same reason: this is a per-(period, dwelling, rule) value that
// generation.ts reads the same way it reads a meter reading, and
// case-readiness.ts tracks its absence the same way it tracks a missing
// reading.
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  billingCases,
  billingPeriods,
  billingRules,
  manualRuleInputs,
} from "../../db/schema/billing";
import { recordAuditEvent } from "../../lib/logging/audit";
import { recalculateCaseReadiness } from "./case-readiness";
import { NotFoundError, ConflictError, ValidationError } from "./periods";

export { NotFoundError, ConflictError, ValidationError };

// Matches billing_rules.unit_price / manual_rule_inputs.value's
// numeric(14,4) column precision.
const DECIMAL4_PATTERN = /^\d{1,10}(\.\d{1,4})?$/;

export interface SubmitManualRuleInputOptions {
  note?: string;
}

// Admin-only for now (spec Section 18 doesn't ask for a resident-facing
// path, unlike meter readings) -- residents have no visibility into billing
// rules at all today, so there's nowhere in the resident UI this would even
// be triggered from.
export async function submitManualRuleInput(
  db: Db,
  organizationId: string,
  periodId: string,
  dwellingId: string,
  billingRuleId: string,
  value: string,
  actorUserId: string,
  options: SubmitManualRuleInputOptions = {}
) {
  if (!DECIMAL4_PATTERN.test(value)) {
    throw new ValidationError(
      "Value must be a non-negative number with at most 4 decimal places"
    );
  }

  return db.transaction(async (tx) => {
    // FOR UPDATE: same race this guards against in readings.ts's
    // recordReading -- without it, a concurrent lockPeriod could commit
    // between this SELECT and this transaction's own write.
    const [period] = await tx
      .select()
      .from(billingPeriods)
      .where(
        and(
          eq(billingPeriods.id, periodId),
          eq(billingPeriods.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!period) throw new NotFoundError("Billing period not found");
    if (period.status === "LOCKED") {
      throw new ConflictError("This billing period is locked");
    }

    const [rule] = await tx
      .select()
      .from(billingRules)
      .where(
        and(
          eq(billingRules.id, billingRuleId),
          eq(billingRules.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!rule) throw new NotFoundError("Billing rule not found");
    if (
      rule.calculationType !== "MANUAL_QUANTITY" &&
      rule.calculationType !== "MANUAL_AMOUNT"
    ) {
      throw new ValidationError(
        `The rule "${rule.name}" does not accept a manually supplied value`
      );
    }

    const [existingCase] = await tx
      .select({ id: billingCases.id })
      .from(billingCases)
      .where(
        and(
          eq(billingCases.periodId, periodId),
          eq(billingCases.dwellingId, dwellingId)
        )
      )
      .limit(1);
    if (!existingCase) {
      throw new NotFoundError(
        "No billing case exists for this dwelling in this period"
      );
    }

    const [existing] = await tx
      .select()
      .from(manualRuleInputs)
      .where(
        and(
          eq(manualRuleInputs.periodId, periodId),
          eq(manualRuleInputs.dwellingId, dwellingId),
          eq(manualRuleInputs.billingRuleId, billingRuleId)
        )
      )
      .limit(1);

    const values = {
      value,
      submittedByUserId: actorUserId,
      submittedAt: new Date(),
      note: options.note ?? null,
    };

    // Atomic upsert, same reasoning as recordReading's onConflictDoUpdate:
    // avoids a raw unique-violation on a concurrent first submission for
    // the same never-yet-filled (period, dwelling, rule).
    const [input] = await tx
      .insert(manualRuleInputs)
      .values({
        organizationId,
        periodId,
        dwellingId,
        billingRuleId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          manualRuleInputs.periodId,
          manualRuleInputs.dwellingId,
          manualRuleInputs.billingRuleId,
        ],
        set: values,
      })
      .returning();

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: existing
        ? "MANUAL_RULE_INPUT_UPDATED"
        : "MANUAL_RULE_INPUT_CREATED",
      entityType: "manual_rule_input",
      entityId: input.id,
      beforeData: existing,
      afterData: input,
    });

    await recalculateCaseReadiness(tx, organizationId, dwellingId, periodId);
    return input;
  });
}
