// Phase E (Periods/meters/readings) - Meter actions (spec Section 10, MTR-001).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { meterTypeEnum } from "../db/schema/dwellings";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import { archiveMeter, createMeter } from "../domain/organizations/meters";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

const meterType = z.enum(meterTypeEnum.enumValues);

export const meters = {
  create: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      clientMutationId: z.uuid(),
      type: meterType,
      serialNumber: z.string().max(100).optional(),
      unit: z.string().min(1).max(20),
      label: z.string().max(100).optional(),
      installedAt: z.iso.date().optional(),
    }),
    handler: safeHandler(
      async (
        { organizationId, dwellingId, clientMutationId, ...input },
        { locals }
      ) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          createMeter(
            db,
            organizationId,
            dwellingId,
            input,
            locals.auth!.userId,
            clientMutationId
          )
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
