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
  updateInvoiceDeliveryPreferences,
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
      clientMutationId: z.uuid(),
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
      async (
        { organizationId, clientMutationId, areaM2, ...input },
        { locals }
      ) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          createDwelling(
            db,
            organizationId,
            {
              ...input,
              areaM2: areaM2 !== undefined ? String(areaM2) : undefined,
            },
            locals.auth!.userId,
            clientMutationId
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

  // Kept separate from `update` on purpose -- see the comment on
  // updateInvoiceDeliveryPreferences for why a shared action would be
  // unsafe here. Both fields are plain (non-optional) booleans: this
  // action's own form always renders exactly these two checkboxes, so an
  // unchecked box correctly resolves to `false` (Astro's own form-to-object
  // coercion), never "leave unchanged".
  updateInvoiceDelivery: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      invoiceByEmail: z.boolean(),
      invoiceByPaper: z.boolean(),
    }),
    handler: safeHandler(
      async (
        { organizationId, dwellingId, invoiceByEmail, invoiceByPaper },
        { locals }
      ) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          updateInvoiceDeliveryPreferences(
            db,
            organizationId,
            dwellingId,
            { invoiceByEmail, invoiceByPaper },
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
      clientMutationId: z.uuid(),
    }),
    handler: safeHandler(
      async (
        { organizationId, dwellingId, email, clientMutationId },
        { locals }
      ) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          assignResident(
            db,
            organizationId,
            dwellingId,
            email,
            locals.auth!.userId,
            getSupabaseAdmin(),
            clientMutationId
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
