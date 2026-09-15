import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import {
  adjustLateFee,
  createDwellingAccountAdjustment,
  setInvoiceManualAdjustment,
} from "../domain/accounts/adjustments";
import { createLateFeePolicy } from "../domain/accounts/settings";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import { withRequestDb } from "../lib/db-request";
import { safeHandler } from "./_errors";

const money = z.string().regex(/^-?\d+(\.\d{1,2})?$/);

export const accounts = {
  saveLateFeePolicy: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      effectiveFrom: z.iso.date(),
      // An unchecked HTML checkbox is omitted from FormData entirely (not
      // sent as "false"), so these must be optional with an explicit
      // false fallback below -- matching every other checkbox-backed
      // boolean field in this codebase (e.g. organizations.update's
      // autoGenerateEnabled/autoSendEnabled).
      enabled: z.boolean().optional(),
      dailyRate: z.string().regex(/^\d+(\.\d{1,6})?$/),
      graceDays: z.coerce.number().int().min(0).max(365),
      maxPenaltyPercent: z.string().regex(/^\d+(\.\d{1,4})?$/),
      stopsAtCap: z.boolean().optional(),
    }),
    handler: safeHandler(async ({ organizationId, ...input }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withRequestDb((db) =>
        createLateFeePolicy(db, {
          organizationId,
          ...input,
          enabled: input.enabled ?? false,
          stopsAtCap: input.stopsAtCap ?? false,
          actorUserId: locals.auth!.userId,
        })
      );
    }),
  }),
  adjustLateFee: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
      newAppliedAmount: money,
      reason: z.enum([
        "BANK_PROCESSING_DELAY",
        "BILLING_DISPUTE",
        "METER_ISSUE",
        "AGREEMENT_WITH_RESIDENT",
        "ADMIN_WAIVER",
        "OTHER",
      ]),
      note: z.string().max(1000).optional(),
    }),
    handler: safeHandler(async ({ organizationId, ...input }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withRequestDb((db) =>
        adjustLateFee(db, {
          organizationId,
          ...input,
          actorUserId: locals.auth!.userId,
        })
      );
    }),
  }),
  setInvoiceManualAdjustment: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
      amount: money,
      reason: z.string().min(1).max(200),
      note: z.string().max(1000).optional(),
    }),
    handler: safeHandler(async ({ organizationId, ...input }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withRequestDb((db) =>
        setInvoiceManualAdjustment(db, {
          organizationId,
          ...input,
          actorUserId: locals.auth!.userId,
        })
      );
    }),
  }),
  createAdjustment: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      currency: z.string().length(3),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      direction: z.enum(["CHARGE", "CREDIT"]),
      effectiveDate: z.iso.date(),
      reason: z.string().min(1).max(200),
      note: z.string().max(1000).optional(),
    }),
    handler: safeHandler(async ({ organizationId, ...input }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withRequestDb((db) =>
        createDwellingAccountAdjustment(db, {
          organizationId,
          ...input,
          actorUserId: locals.auth!.userId,
        })
      );
    }),
  }),
};
