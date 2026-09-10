// Phase E (Periods/meters/readings) - Meter actions (spec Section 10, MTR-001).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import {
  archiveMeter,
  createMeter,
  updateMeter,
} from "../domain/organizations/meters";
import { safeHandler } from "./_errors";
import { withDb } from "./_db";

const meterType = z.enum([
  "COLD_WATER",
  "HOT_WATER",
  "ELECTRICITY",
  "GAS",
  "HEAT",
  "OTHER",
]);

export const meters = {
  create: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      type: meterType,
      serialNumber: z.string().max(100).optional(),
      unit: z.string().min(1).max(20),
      label: z.string().max(100).optional(),
      installedAt: z.iso.date().optional(),
    }),
    handler: safeHandler(
      async ({ organizationId, dwellingId, ...input }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          createMeter(
            db,
            organizationId,
            dwellingId,
            input,
            locals.auth!.userId
          )
        );
      }
    ),
  }),

  update: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      meterId: z.uuid(),
      serialNumber: z.string().max(100).nullable().optional(),
      unit: z.string().min(1).max(20).optional(),
      label: z.string().max(100).nullable().optional(),
      installedAt: z.iso.date().nullable().optional(),
    }),
    handler: safeHandler(
      async ({ organizationId, meterId, ...input }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          updateMeter(db, organizationId, meterId, input, locals.auth!.userId)
        );
      }
    ),
  }),

  archive: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      meterId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, meterId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        archiveMeter(db, organizationId, meterId, locals.auth!.userId)
      );
    }),
  }),
};
