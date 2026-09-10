// Phase E (Periods/meters/readings) - Reading submission actions (spec
// Section 10, MTR-002/003).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import {
  requireDwellingAccess,
  requireOrganizationAccess,
} from "../domain/authorization/guards";
import {
  submitAdminReading,
  submitResidentReading,
} from "../domain/periods/readings";
import { DECIMAL3_PATTERN } from "../lib/decimal3";
import { safeHandler } from "./_errors";
import { withDb } from "./_db";

// Kept as a string end to end (spec Section 17: no JS binary floating
// point for persisted calculations), validated the same way the domain
// layer re-validates it.
const decimal3 = z
  .string()
  .regex(
    DECIMAL3_PATTERN,
    "Must be a non-negative number with at most 3 decimal places"
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
};
