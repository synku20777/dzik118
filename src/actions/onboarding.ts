// Guided setup actions (ADR 0012). Thin wrappers: the setup coordinates the
// existing domain functions, it is not a second billing engine.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireActiveOrganization } from "../domain/authorization/guards";
import { ValidationError } from "../domain/errors";
import {
  applyChargePresets,
  CHARGE_PRESETS,
  type ChargePresetInput,
  type ChargePresetKey,
} from "../domain/onboarding/presets";
import { recordOpeningReadings } from "../domain/periods/opening-readings";
import { DECIMAL3_PATTERN } from "../lib/decimal3";
import { decimalInput } from "../lib/decimal-input";
import { withRequestDb as withDb } from "../lib/db-request";
import { safeHandler } from "./_errors";

export const PRESET_PRICE_MESSAGE =
  "Enter a price for each selected charge, for example 0.35 or 12.50";

const PRESET_KEYS = Object.keys(CHARGE_PRESETS) as ChargePresetKey[];
const price = decimalInput(
  /^\d{1,10}(\.\d{1,4})?$/,
  "Enter a valid unit price, for example 0.35 or 12.50. Use up to 4 decimal places."
);
const vat = decimalInput(
  /^\d{1,3}(\.\d{1,4})?$/,
  "Enter a valid VAT percentage, for example 21 or 21.5."
);

// One checkbox, price and VAT field per preset: `maintenanceEnabled`,
// `maintenancePrice`, `maintenanceVat`, and so on.
type PresetFieldName = `${ChargePresetKey}${"Enabled" | "Price" | "Vat"}`;
const presetFields = Object.fromEntries(
  PRESET_KEYS.flatMap((key) => [
    [`${key}Enabled`, z.boolean().optional()],
    [`${key}Price`, price.optional()],
    [`${key}Vat`, vat.optional()],
  ])
) as Record<PresetFieldName, z.ZodOptional<z.ZodType>>;

export const onboarding = {
  applyChargePresets: defineAction({
    accept: "form",
    input: z.object({ organizationId: z.uuid(), ...presetFields }),
    handler: safeHandler(async ({ organizationId, ...fields }, { locals }) => {
      requireActiveOrganization(locals.auth, organizationId);
      const values = fields as Record<string, unknown>;
      const inputs: ChargePresetInput[] = [];
      for (const key of PRESET_KEYS) {
        if (!values[`${key}Enabled`]) continue;
        const unitPrice = values[`${key}Price`] as string | undefined;
        if (!unitPrice) throw new ValidationError(PRESET_PRICE_MESSAGE);
        inputs.push({
          key,
          unitPrice,
          vatRate: (values[`${key}Vat`] as string | undefined) ?? "0",
        });
      }
      return withDb((db) =>
        applyChargePresets(db, organizationId, inputs, locals.auth!.userId)
      );
    }),
  }),

  // Typed starting readings: one row per meter, blank values skipped.
  recordOpeningReadings: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      meterId: z.array(z.uuid()).max(5000),
      value: z.array(z.string().max(30)).max(5000),
    }),
    handler: safeHandler(
      async ({ organizationId, meterId, value }, { locals }) => {
        requireActiveOrganization(locals.auth, organizationId);
        if (meterId.length !== value.length) {
          throw new ValidationError("Enter at least one starting reading");
        }
        const rows = meterId
          .map((id, i) => ({
            meterId: id,
            value: value[i].trim().replace(",", "."),
          }))
          .filter((r) => r.value !== "");
        for (const r of rows) {
          if (!DECIMAL3_PATTERN.test(r.value)) {
            throw new ValidationError(
              "Current value must be a non-negative number with at most 3 decimal places"
            );
          }
        }
        return withDb((db) =>
          recordOpeningReadings(db, organizationId, rows, locals.auth!.userId)
        );
      }
    ),
  }),
};
