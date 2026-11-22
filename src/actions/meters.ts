// Phase E (Periods/meters/readings) - Meter actions (spec Section 10, MTR-001).
import { z } from "astro/zod";
import { meterTypeEnum } from "../db/schema/dwellings";
import {
  archiveMeter,
  createMeter,
  updateMeter,
} from "../domain/organizations/meters";
import { withRequestDb as withDb } from "../lib/db-request";
import { orgAction } from "./_org-action";

const meterType = z.enum(meterTypeEnum.enumValues);

export const meters = {
  create: orgAction({
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
    handler: async (
      { organizationId, dwellingId, clientMutationId, ...input },
      { locals }
    ) => {
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
    },
  }),

  update: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      meterId: z.uuid(),
      serialNumber: z.string().max(100).optional(),
      unit: z.string().min(1).max(20),
      label: z.string().max(100).optional(),
      installedAt: z.iso.date().optional(),
    }),
    handler: async (
      { organizationId, meterId, serialNumber, unit, label, installedAt },
      { locals }
    ) => {
      const emptyToNull = (v?: string | null) =>
        v === undefined || v === null || v.trim() === "" ? null : v.trim();
      return withDb((db) =>
        updateMeter(
          db,
          organizationId,
          meterId,
          {
            serialNumber: emptyToNull(serialNumber),
            unit,
            label: emptyToNull(label),
            installedAt: emptyToNull(installedAt),
          },
          locals.auth!.userId
        )
      );
    },
  }),

  archive: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      meterId: z.uuid(),
    }),
    handler: async ({ organizationId, meterId }, { locals }) => {
      return withDb((db) =>
        archiveMeter(db, organizationId, meterId, locals.auth!.userId)
      );
    },
  }),
};
