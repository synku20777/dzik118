// Phase F (Billing) - Billing rule CRUD and invoice generation actions
// (spec Section 10, BIL-001..005, INV-001/002/004).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { billingCalculationTypeEnum } from "../db/schema/billing";
import { meterTypeEnum } from "../db/schema/dwellings";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import { archiveRule, createRule, updateRule } from "../domain/billing/rules";
import {
  bulkGenerateInvoices,
  bulkPrepareInvoices,
  generateInvoice,
  overrideCaseStatus,
  prepareInvoice,
} from "../domain/billing/generation";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

const billingCaseStatus = z.enum([
  "MISSING_DATA",
  "READY",
  "DRAFT",
  "PREPARED",
  "SENT",
  "PAID",
  "OVERDUE",
]);

export const billing = {
  // BIL-001..005
  createRule: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      name: z.string().min(1).max(200),
      // Optional translated invoice labels -- Latvian (`name` above) is
      // canonical; a missing translation falls back to it at render time
      // (src/domain/billing/invoice-i18n.ts's pickLocalizedText).
      // `.nullable()` WITHOUT `.optional()` deliberately: the form always
      // submits this field (even blank), and Astro's own form-to-object
      // conversion maps a blank value on an `.optional()` field to
      // `undefined` (which updateRule then treats as "don't touch this
      // column"), not `null` -- there would be no way to ever clear an
      // existing translation. A `.nullable()`-only field maps a blank
      // value to `null` instead, which does clear it.
      nameEn: z.string().max(200).nullable(),
      nameRu: z.string().max(200).nullable(),
      code: z.string().min(1).max(50),
      description: z.string().max(1000).optional(),
      calculationType: z.enum(billingCalculationTypeEnum.enumValues),
      meterType: z.enum(meterTypeEnum.enumValues).optional(),
      unit: z.string().min(1).max(20),
      unitPrice: z
        .string()
        .regex(/^\d{1,10}(\.\d{1,4})?$/)
        .optional(),
      vatRate: z
        .string()
        .regex(/^\d{1,3}(\.\d{1,4})?$/)
        .optional(),
      effectiveFrom: z.iso.date(),
      effectiveUntil: z.iso.date().optional(),
      sortOrder: z.coerce.number().int().optional(),
    }),
    handler: safeHandler(async ({ organizationId, ...input }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        createRule(db, organizationId, input, locals.auth!.userId)
      );
    }),
  }),

  updateRule: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      ruleId: z.uuid(),
      name: z.string().min(1).max(200).optional(),
      // See the identical comment on createRule's input above -- `.nullable()`
      // without `.optional()` so a cleared field actually clears the column.
      nameEn: z.string().max(200).nullable(),
      nameRu: z.string().max(200).nullable(),
      description: z.string().max(1000).nullable().optional(),
      unitPrice: z
        .string()
        .regex(/^\d{1,10}(\.\d{1,4})?$/)
        .nullable()
        .optional(),
      vatRate: z
        .string()
        .regex(/^\d{1,3}(\.\d{1,4})?$/)
        .optional(),
      effectiveFrom: z.iso.date().optional(),
      effectiveUntil: z.iso.date().nullable().optional(),
      sortOrder: z.coerce.number().int().optional(),
      enabled: z.coerce.boolean().optional(),
    }),
    handler: safeHandler(
      async ({ organizationId, ruleId, ...input }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          updateRule(db, organizationId, ruleId, input, locals.auth!.userId)
        );
      }
    ),
  }),

  archiveRule: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      ruleId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, ruleId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        archiveRule(db, organizationId, ruleId, locals.auth!.userId)
      );
    }),
  }),

  // INV-001
  generate: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
      dwellingId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, periodId, dwellingId }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          generateInvoice(
            db,
            organizationId,
            periodId,
            dwellingId,
            locals.auth!.userId
          )
        );
      }
    ),
  }),

  // INV-002
  bulkGenerate: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, periodId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        bulkGenerateInvoices(db, organizationId, periodId, locals.auth!.userId)
      );
    }),
  }),

  // INV-004
  prepare: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, invoiceId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        prepareInvoice(db, organizationId, invoiceId, locals.auth!.userId)
      );
    }),
  }),

  // spec Section 27: workbench bulk selection.
  bulkPrepare: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceIds: z.array(z.uuid()).min(1),
    }),
    handler: safeHandler(async ({ organizationId, invoiceIds }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        bulkPrepareInvoices(db, organizationId, invoiceIds, locals.auth!.userId)
      );
    }),
  }),

  // spec Section 19: manual admin status override, requires a reason.
  overrideStatus: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      caseId: z.uuid(),
      status: billingCaseStatus,
      reason: z.string().min(1).max(500),
    }),
    handler: safeHandler(
      async ({ organizationId, caseId, status, reason }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          overrideCaseStatus(
            db,
            organizationId,
            caseId,
            status,
            reason,
            locals.auth!.userId
          )
        );
      }
    ),
  }),
};
