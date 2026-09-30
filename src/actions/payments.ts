// Phase J (Payments) - payment match confirm/reject actions (spec Section
// 10, PAY-003). The CSV upload/preview/confirm flow itself is a plain page
// (src/pages/admin/o/[orgId]/payments/import.astro), not an action, for
// the same reason the dwellings CSV import is: raw multipart file upload
// doesn't fit an action's input shape.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireActiveOrganization } from "../domain/authorization/guards";
import { confirmMatch, rejectMatch } from "../domain/payments/matching";
import {
  matchTransactionToInvoice,
  recordManualPayment,
} from "../domain/payments/manual";
import { reversePayment } from "../domain/payments/reversal";
import { decimalInput } from "../lib/decimal-input";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

const POSITIVE_AMOUNT_MESSAGE =
  "Enter a valid amount, for example 12.50. Use up to 2 decimal places.";

export const payments = {
  confirmMatch: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      matchId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, matchId }, { locals }) => {
      requireActiveOrganization(locals.auth, organizationId);
      return withDb((db) =>
        confirmMatch(db, organizationId, matchId, locals.auth!.userId)
      );
    }),
  }),

  rejectMatch: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      matchId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, matchId }, { locals }) => {
      requireActiveOrganization(locals.auth, organizationId);
      return withDb((db) =>
        rejectMatch(db, organizationId, matchId, locals.auth!.userId)
      );
    }),
  }),

  reverseMatch: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      matchId: z.uuid(),
      reason: z.string().trim().min(1).max(500),
    }),
    handler: safeHandler(
      async ({ organizationId, matchId, reason }, { locals }) => {
        requireActiveOrganization(locals.auth, organizationId);
        return withDb((db) =>
          reversePayment(
            db,
            organizationId,
            matchId,
            reason,
            locals.auth!.userId
          )
        );
      }
    ),
  }),

  matchTransaction: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      transactionId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, transactionId, invoiceId }, { locals }) => {
        requireActiveOrganization(locals.auth, organizationId);
        return withDb((db) =>
          matchTransactionToInvoice(
            db,
            organizationId,
            transactionId,
            invoiceId,
            locals.auth!.userId
          )
        );
      }
    ),
  }),

  recordManual: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
      amount: decimalInput(/^\d+(\.\d{1,2})?$/, POSITIVE_AMOUNT_MESSAGE),
      bookingDate: z.iso.date(),
      payerName: z.string().max(140).optional(),
      reference: z.string().trim().min(1).max(140),
      reason: z.string().trim().min(1).max(500),
    }),
    handler: safeHandler(async ({ organizationId, ...input }, { locals }) => {
      requireActiveOrganization(locals.auth, organizationId);
      return withDb((db) =>
        recordManualPayment(db, organizationId, input, locals.auth!.userId)
      );
    }),
  }),
};
