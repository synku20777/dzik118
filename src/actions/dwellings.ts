// Phase D (Organizations/dwellings) - Dwelling actions (spec Section 10).
// Spreadsheet imports run through the Migration Center.
import { z } from "astro/zod";
import { dwellingTypeEnum } from "../db/schema/dwellings";
import {
  archiveDwelling,
  assignResident,
  createDwelling,
  removeResidentAccess,
  setResidentDisabled,
  updateDwelling,
  updateInvoiceDeliveryPreferences,
} from "../domain/organizations/dwellings";
import {
  readClearableTextFields,
  trimmedEmailOrNull,
} from "./_clearable-fields";
import { withRequestDb as withDb } from "../lib/db-request";
import {
  BUILDING_LIMITS,
  resetBuildingLayout,
  saveBuildingLayout,
} from "../domain/organizations/building";
import { getSupabaseAdmin } from "./_supabase_admin";
import { orgAction } from "./_org-action";

const dwellingType = z.enum(dwellingTypeEnum.enumValues);

const placement = z.object({
  dwellingId: z.uuid(),
  floor: z.number().int().min(0),
  slot: z.number().int().min(0),
});

export const dwellings = {
  // The building view's arrangement, saved whole (domain/organizations/building).
  saveLayout: orgAction({
    accept: "json",
    input: z.object({
      organizationId: z.uuid(),
      entrances: z
        .array(
          z.object({
            name: z.string().max(BUILDING_LIMITS.nameLength),
            floors: z.number().int(),
            columns: z.number().int(),
            placements: z.array(placement).max(5000),
          })
        )
        .max(BUILDING_LIMITS.entrances),
    }),
    handler: async ({ organizationId, entrances }, { locals }) =>
      withDb((db) =>
        saveBuildingLayout(db, organizationId, entrances, locals.auth!.userId)
      ),
  }),

  resetLayout: orgAction({
    accept: "form",
    input: z.object({ organizationId: z.uuid() }),
    handler: async ({ organizationId }, { locals }) =>
      withDb((db) =>
        resetBuildingLayout(db, organizationId, locals.auth!.userId)
      ),
  }),

  // DWL-001
  create: orgAction({
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
    handler: async (
      { organizationId, clientMutationId, areaM2, ...input },
      { locals }
    ) => {
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
    },
  }),

  update: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      type: dwellingType.optional(),
      displayName: z.string().max(200).nullable().optional(),
      occupantName: z.string().max(200).nullable().optional(),
      billingName: z.string().max(200).nullable().optional(),
      billingEmail: z
        .preprocess(trimmedEmailOrNull, z.email().max(320).nullable())
        .optional(),
      billingAddress: z.string().max(300).nullable().optional(),
      areaM2: z.coerce.number().min(0).optional(),
      residentCount: z.coerce.number().int().min(0).optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
    handler: async (
      { organizationId, dwellingId, areaM2, ...input },
      { locals, request }
    ) => {
      const clearable = await readClearableTextFields(request, [
        "displayName",
        "occupantName",
        "billingName",
        "billingEmail",
        "billingAddress",
        "notes",
      ] as const);
      return withDb((db) =>
        updateDwelling(
          db,
          organizationId,
          dwellingId,
          {
            ...input,
            ...clearable,
            areaM2: areaM2 !== undefined ? String(areaM2) : undefined,
          },
          locals.auth!.userId
        )
      );
    },
  }),

  // Kept separate from `update` on purpose -- see the comment on
  // updateInvoiceDeliveryPreferences for why a shared action would be
  // unsafe here. Both fields are plain (non-optional) booleans: this
  // action's own form always renders exactly these two checkboxes, so an
  // unchecked box correctly resolves to `false` (Astro's own form-to-object
  // coercion), never "leave unchanged".
  updateInvoiceDelivery: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      invoiceByEmail: z.boolean(),
      invoiceByPaper: z.boolean(),
    }),
    handler: async (
      { organizationId, dwellingId, invoiceByEmail, invoiceByPaper },
      { locals }
    ) => {
      return withDb((db) =>
        updateInvoiceDeliveryPreferences(
          db,
          organizationId,
          dwellingId,
          { invoiceByEmail, invoiceByPaper },
          locals.auth!.userId
        )
      );
    },
  }),

  // DWL-002
  archive: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
    }),
    handler: async ({ organizationId, dwellingId }, { locals }) => {
      return withDb((db) =>
        archiveDwelling(db, organizationId, dwellingId, locals.auth!.userId)
      );
    },
  }),

  // DWL-003
  assignResident: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      email: z.email(),
      clientMutationId: z.uuid(),
    }),
    handler: async (
      { organizationId, dwellingId, email, clientMutationId },
      { locals }
    ) => {
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
    },
  }),

  removeResident: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      userId: z.uuid(),
    }),
    handler: async ({ organizationId, dwellingId, userId }, { locals }) => {
      return withDb((db) =>
        removeResidentAccess(
          db,
          organizationId,
          dwellingId,
          userId,
          locals.auth!.userId
        )
      );
    },
  }),

  setResidentDisabled: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      userId: z.uuid(),
      disabled: z.enum(["true", "false"]),
    }),
    handler: async ({ organizationId, userId, disabled }, { locals }) => {
      return withDb((db) =>
        setResidentDisabled(
          db,
          organizationId,
          userId,
          disabled === "true",
          locals.auth!.userId
        )
      );
    },
  }),
};
