// Phase E (Periods/meters/readings) - Reading submission actions (spec
// Section 10, MTR-002/003).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import {
  requireDwellingAccess,
  requireOrganizationAccess,
} from "../domain/authorization/guards";
import { submitManualRuleInput } from "../domain/periods/manual-rule-inputs";
import {
  submitAdminReading,
  submitResidentReading,
} from "../domain/periods/readings";
import { DECIMAL3_PATTERN } from "../lib/decimal3";
import { decimalInput } from "../lib/decimal-input";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

// Kept as a string end to end (spec Section 17: no JS binary floating
// point for persisted calculations), validated the same way the domain
// layer re-validates it. Accepts a comma decimal separator (Latvia-first
// UX) via decimalInput's normalization before the regex runs.
const decimal3 = decimalInput(
  DECIMAL3_PATTERN,
  "Enter a valid meter reading, for example 123.456. Use up to 3 decimal places."
);

// Matches manual_rule_inputs.value's numeric(14,4) column precision.
const decimal4 = decimalInput(
  /^\d{1,10}(\.\d{1,4})?$/,
  "Enter a valid value, for example 12.3456. Use up to 4 decimal places."
);

export const readings = {
  // MTR-002
  adminSubmit: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
      meterId: z.uuid(),
      currentValue: decimal3,
      note: z.string().max(500).optional(),
      force: z.coerce.boolean().optional(),
    }),
    handler: safeHandler(
      async (
        { organizationId, periodId, meterId, currentValue, note, force },
        { locals }
      ) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          submitAdminReading(
            db,
            organizationId,
            periodId,
            meterId,
            currentValue,
            locals.auth!.userId,
            { note, force }
          )
        );
      }
    ),
  }),

  // MTR-003
  residentSubmit: defineAction({
    accept: "form",
    input: z.object({
      dwellingId: z.uuid(),
      periodId: z.uuid(),
      meterId: z.uuid(),
      currentValue: decimal3,
    }),
    handler: safeHandler(
      async ({ dwellingId, periodId, meterId, currentValue }, { locals }) => {
        requireDwellingAccess(locals.auth, dwellingId);
        return withDb((db) =>
          submitResidentReading(
            db,
            dwellingId,
            periodId,
            meterId,
            currentValue,
            locals.auth!.userId
          )
        );
      }
    ),
  }),

  // Admin-only: no resident-facing equivalent (spec Section 18 doesn't ask
  // for one, and residents have no visibility into billing rules today).
  adminSubmitManualRuleInput: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
      dwellingId: z.uuid(),
      billingRuleId: z.uuid(),
      value: decimal4,
      note: z.string().max(500).optional(),
    }),
    handler: safeHandler(
      async (
        { organizationId, periodId, dwellingId, billingRuleId, value, note },
        { locals }
      ) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          submitManualRuleInput(
            db,
            organizationId,
            periodId,
            dwellingId,
            billingRuleId,
            value,
            locals.auth!.userId,
            { note }
          )
        );
      }
    ),
  }),
};
