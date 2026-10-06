// Charge presets for the setup: familiar charges that become ordinary billing
// rules through createRule, so no second billing model exists. Rerunnable:
// a preset whose code already exists is reported, never created twice, so a
// run that failed half way is finished by running it again.
// Callers must call requireActiveOrganization() first.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { billingRules } from "../../db/schema/billing";
import { createRule } from "../billing/rules";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { getFirstBillingPeriod } from "../periods/periods";

export const NO_PERIOD_FOR_CHARGES_MESSAGE =
  "Create the first billing period before you add charges";

// Invoice labels: Latvian is canonical (`name`), as on the rules page.
export const CHARGE_PRESETS = {
  maintenance: {
    code: "maintenance",
    name: "Apsaimniekošanas maksa",
    nameEn: "Maintenance",
    nameRu: "Плата за обслуживание",
    calculationType: "AREA",
    unit: "m2",
  },
  fixed: {
    code: "fixed_fee",
    name: "Fiksētā maksa",
    nameEn: "Fixed fee",
    nameRu: "Фиксированная плата",
    calculationType: "FIXED",
    unit: "dwelling",
  },
  perResident: {
    code: "per_resident",
    name: "Maksa par iedzīvotāju",
    nameEn: "Fee per resident",
    nameRu: "Плата за жильца",
    calculationType: "RESIDENT_COUNT",
    unit: "resident",
  },
  coldWater: {
    code: "cold_water",
    name: "Aukstais ūdens",
    nameEn: "Cold water",
    nameRu: "Холодная вода",
    calculationType: "METER_CONSUMPTION",
    meterType: "COLD_WATER",
    unit: "m3",
  },
  hotWater: {
    code: "hot_water",
    name: "Karstais ūdens",
    nameEn: "Hot water",
    nameRu: "Горячая вода",
    calculationType: "METER_CONSUMPTION",
    meterType: "HOT_WATER",
    unit: "m3",
  },
} as const;

export type ChargePresetKey = keyof typeof CHARGE_PRESETS;

export interface ChargePresetInput {
  key: ChargePresetKey;
  unitPrice: string;
  vatRate: string;
}

export type ChargePresetResult =
  | { key: ChargePresetKey; outcome: "CREATED"; ruleId: string }
  | { key: ChargePresetKey; outcome: "EXISTS"; ruleId: string }
  // An archived rule holds the code; the admin decides on the rules page.
  | { key: ChargePresetKey; outcome: "ARCHIVED"; ruleId: string }
  | { key: ChargePresetKey; outcome: "ERROR"; message: string };

export async function applyChargePresets(
  db: Db,
  organizationId: string,
  inputs: ChargePresetInput[],
  actorUserId: string
): Promise<ChargePresetResult[]> {
  if (inputs.length === 0) {
    throw new ValidationError("Select at least one charge");
  }
  const first = await getFirstBillingPeriod(db, organizationId);
  if (!first) throw new ConflictError(NO_PERIOD_FOR_CHARGES_MESSAGE);

  const codes = inputs.map((i) => CHARGE_PRESETS[i.key].code);
  const existing = await db
    .select({
      id: billingRules.id,
      code: billingRules.code,
      archivedAt: billingRules.archivedAt,
    })
    .from(billingRules)
    .where(
      and(
        eq(billingRules.organizationId, organizationId),
        inArray(billingRules.code, codes)
      )
    );
  const byCode = new Map(existing.map((r) => [r.code, r]));

  const results: ChargePresetResult[] = [];
  for (const input of inputs) {
    const { code, ...preset } = CHARGE_PRESETS[input.key];
    const found = byCode.get(code);
    if (found) {
      results.push({
        key: input.key,
        outcome: found.archivedAt ? "ARCHIVED" : "EXISTS",
        ruleId: found.id,
      });
      continue;
    }
    try {
      const rule = await createRule(
        db,
        organizationId,
        {
          ...preset,
          code,
          unitPrice: input.unitPrice,
          vatRate: input.vatRate,
          effectiveFrom: first.startsOn,
        },
        actorUserId
      );
      results.push({ key: input.key, outcome: "CREATED", ruleId: rule.id });
    } catch (err) {
      // Another request created the same preset in the meantime.
      if (err instanceof ConflictError) {
        const [raced] = await db
          .select({ id: billingRules.id, archivedAt: billingRules.archivedAt })
          .from(billingRules)
          .where(
            and(
              eq(billingRules.organizationId, organizationId),
              eq(billingRules.code, code)
            )
          )
          .limit(1);
        if (raced) {
          results.push({
            key: input.key,
            outcome: raced.archivedAt ? "ARCHIVED" : "EXISTS",
            ruleId: raced.id,
          });
          continue;
        }
      }
      // Expected domain refusals become a per-charge result; anything else
      // (database down, bug) still fails the whole request.
      if (
        err instanceof ValidationError ||
        err instanceof ConflictError ||
        err instanceof NotFoundError
      ) {
        results.push({
          key: input.key,
          outcome: "ERROR",
          message: err.message,
        });
      } else {
        throw err;
      }
    }
  }
  return results;
}
