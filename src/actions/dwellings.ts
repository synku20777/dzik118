// Phase D (Organizations/dwellings) - Dwelling actions (spec Section 10).
// CSV import (DWL-004) isn't here: it needs a raw multipart file upload,
// which doesn't fit an action's input shape, so
// src/pages/admin/o/[orgId]/dwellings/import.astro calls
// validateDwellingsCsv/importDwellingsCsv directly instead.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { dwellingTypeEnum } from "../db/schema/dwellings";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import {
  archiveDwelling,
  assignResident,
  createDwelling,
  removeResidentAccess,
  updateDwelling,
} from "../domain/organizations/dwellings";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";
import { getSupabaseAdmin } from "./_supabase_admin";

const dwellingType = z.enum(dwellingTypeEnum.enumValues);

export const dwellings = {
  // DWL-001
  create: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      number: z.string().min(1).max(50),
      type: dwellingType.optional(),
      displayName: z.string().max(200).optional(),
      occupantName: z.string().max(200).optional(),
      billingName: z.string().max(200).optional(),
      billingEmail: z.email().max(320).optional(),
      billingAddress: z.string().max(300).optional(),
      areaM2: z.coerce.number().min(0).optional(),
      residentCount: z.coerce.number().int().min(0).optional(),
      notes: z.string().max(2000).optional(),
    }),
    handler: safeHandler(
      async ({ organizationId, areaM2, ...input }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          createDwelling(
            db,
            organizationId,
            {
              ...input,
              areaM2: areaM2 !== undefined ? String(areaM2) : undefined,
            },
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
      dwellingId: z.uuid(),
      type: dwellingType.optional(),
      displayName: z.string().max(200).nullable().optional(),
      occupantName: z.string().max(200).nullable().optional(),
      billingName: z.string().max(200).nullable().optional(),
      billingEmail: z.email().max(320).nullable().optional(),
      billingAddress: z.string().max(300).nullable().optional(),
      areaM2: z.coerce.number().min(0).optional(),
      residentCount: z.coerce.number().int().min(0).optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
    handler: safeHandler(
      async ({ organizationId, dwellingId, areaM2, ...input }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          updateDwelling(
            db,
            organizationId,
            dwellingId,
            {
              ...input,
              areaM2: areaM2 !== undefined ? String(areaM2) : undefined,
            },
            locals.auth!.userId
          )
        );
      }
    ),
  }),

  // DWL-002
  archive: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, dwellingId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        archiveDwelling(db, organizationId, dwellingId, locals.auth!.userId)
      );
    }),
  }),

  // DWL-003
  assignResident: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      email: z.email(),
    }),
    handler: safeHandler(
      async ({ organizationId, dwellingId, email }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          assignResident(
            db,
            organizationId,
            dwellingId,
            email,
            locals.auth!.userId,
            getSupabaseAdmin()
          )
        );
      }
    ),
  }),

  removeResident: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      userId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, dwellingId, userId }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          removeResidentAccess(
            db,
            organizationId,
            dwellingId,
            userId,
            locals.auth!.userId
          )
        );
      }
    ),
  }),
};
