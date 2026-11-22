// Phase F (Billing) - Billing rule CRUD and invoice generation actions
// (spec Section 10, BIL-001..005, INV-001/002/004).
import { z } from "astro/zod";
import {
  billingCalculationTypeEnum,
  billingRuleScopeEnum,
} from "../db/schema/billing";
import { meterTypeEnum } from "../db/schema/dwellings";
import {
  archiveRule,
  createRule,
  updateRule,
  restoreRule,
  setRuleEnabled,
} from "../domain/billing/rules";
import { decimalInput } from "../lib/decimal-input";
import {
  bulkGenerateInvoices,
  bulkPrepareInvoices,
  generateInvoice,
  overrideCaseStatus,
  prepareInvoice,
} from "../domain/billing/generation";
import { withRequestDb as withDb } from "../lib/db-request";
import { orgAction } from "./_org-action";

const UNIT_PRICE_MESSAGE =
  "Enter a valid unit price, for example 0.35 or 12.50. Use up to 4 decimal places.";
const VAT_RATE_MESSAGE =
  "Enter a valid VAT percentage, for example 21 or 21.5.";

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
  createRule: orgAction({
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
      unitPrice: decimalInput(
        /^\d{1,10}(\.\d{1,4})?$/,
        UNIT_PRICE_MESSAGE
      ).optional(),
      vatRate: decimalInput(
        /^\d{1,3}(\.\d{1,4})?$/,
        VAT_RATE_MESSAGE
      ).optional(),
      effectiveFrom: z.iso.date(),
      effectiveUntil: z.iso.date().optional(),
      applicationScope: z.enum(billingRuleScopeEnum.enumValues).optional(),
      dwellingIds: z.array(z.uuid()).max(200).optional(),
      sortOrder: z.coerce.number().int().optional(),
      enabled: z.coerce.boolean().optional(),
    }),
    handler: async ({ organizationId, ...input }, { locals }) => {
      return withDb((db) =>
        createRule(db, organizationId, input, locals.auth!.userId)
      );
    },
  }),

  updateRule: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      ruleId: z.uuid(),
      name: z.string().min(1).max(200).optional(),
      // See the identical comment on createRule's input above -- `.nullable()`
      // without `.optional()` so a cleared field actually clears the column.
      nameEn: z.string().max(200).nullable(),
      nameRu: z.string().max(200).nullable(),
      code: z.string().min(1).max(50).optional(),
      // The drawer always resubmits this whole form (never a partial patch
      // of just one field), so -- same reasoning as nameEn/nameRu above --
      // these are `.nullable()` WITHOUT `.optional()`: a blank submitted
      // value must clear the column, not be read as "don't touch it" (that
      // reading is what `.optional()` alone would give a blank field, per
      // Astro's own form-to-object conversion).
      description: z.string().max(1000).nullable(),
      calculationType: z.enum(billingCalculationTypeEnum.enumValues).optional(),
      meterType: z.enum(meterTypeEnum.enumValues).nullable(),
      unit: z.string().min(1).max(20).optional(),
      unitPrice: decimalInput(
        /^\d{1,10}(\.\d{1,4})?$/,
        UNIT_PRICE_MESSAGE
      ).nullable(),
      vatRate: decimalInput(
        /^\d{1,3}(\.\d{1,4})?$/,
        VAT_RATE_MESSAGE
      ).optional(),
      effectiveFrom: z.iso.date().optional(),
      effectiveUntil: z.iso.date().nullable(),
      applicationScope: z.enum(billingRuleScopeEnum.enumValues).optional(),
      dwellingIds: z.array(z.uuid()).max(200).optional(),
      sortOrder: z.coerce.number().int().optional(),
      enabled: z.coerce.boolean().optional(),
    }),
    handler: async ({ organizationId, ruleId, ...input }, { locals }) => {
      return withDb((db) =>
        updateRule(db, organizationId, ruleId, input, locals.auth!.userId)
      );
    },
  }),

  setRuleEnabled: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      ruleId: z.uuid(),
      enabled: z.coerce.boolean(),
    }),
    handler: async ({ organizationId, ruleId, enabled }, { locals }) => {
      return withDb((db) =>
        setRuleEnabled(db, organizationId, ruleId, enabled, locals.auth!.userId)
      );
    },
  }),

  archiveRule: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      ruleId: z.uuid(),
    }),
    handler: async ({ organizationId, ruleId }, { locals }) => {
      return withDb((db) =>
        archiveRule(db, organizationId, ruleId, locals.auth!.userId)
      );
    },
  }),

  restoreRule: orgAction({
    accept: "form",
    input: z.object({ organizationId: z.uuid(), ruleId: z.uuid() }),
    handler: async ({ organizationId, ruleId }, { locals }) => {
      return withDb((db) =>
        restoreRule(db, organizationId, ruleId, locals.auth!.userId)
      );
    },
  }),

  // INV-001
  generate: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
      dwellingId: z.uuid(),
    }),
    handler: async ({ organizationId, periodId, dwellingId }, { locals }) => {
      // Results stay small enough for the redirect-after-post cookie
      // (src/middleware.ts); the pages only read these fields.
      const { id } = await withDb((db) =>
        generateInvoice(
          db,
          organizationId,
          periodId,
          dwellingId,
          locals.auth!.userId
        )
      );
      return { id };
    },
  }),

  // INV-002
  bulkGenerate: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
    }),
    handler: async ({ organizationId, periodId }, { locals }) => {
      const result = await withDb((db) =>
        bulkGenerateInvoices(db, organizationId, periodId, locals.auth!.userId)
      );
      return {
        count: result.generated.length,
        skippedCount: result.skipped.length,
        skipReasons: [...new Set(result.skipped.map((s) => s.reason))],
      };
    },
  }),

  // INV-004
  prepare: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: async ({ organizationId, invoiceId }, { locals }) => {
      const { id } = await withDb((db) =>
        prepareInvoice(db, organizationId, invoiceId, locals.auth!.userId)
      );
      return { id };
    },
  }),

  // spec Section 27: workbench bulk selection.
  bulkPrepare: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceIds: z.array(z.uuid()).min(1).max(200),
    }),
    handler: async ({ organizationId, invoiceIds }, { locals }) => {
      const result = await withDb((db) =>
        bulkPrepareInvoices(db, organizationId, invoiceIds, locals.auth!.userId)
      );
      return {
        count: result.prepared.length,
        skippedCount: result.skipped.length,
        skipReasons: [...new Set(result.skipped.map((s) => s.reason))],
      };
    },
  }),

  // spec Section 19: manual admin status override, requires a reason.
  overrideStatus: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      caseId: z.uuid(),
      status: billingCaseStatus,
      reason: z.string().min(1).max(500),
    }),
    handler: async ({ organizationId, caseId, status, reason }, { locals }) => {
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
    },
  }),
};
