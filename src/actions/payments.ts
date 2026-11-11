// Phase J (Payments) - payment match confirm/reject actions (spec Section
// 10, PAY-003). The CSV upload/preview/confirm flow itself is a plain page
// (src/pages/admin/o/[orgId]/payments/import.astro), not an action, for
// the same reason the dwellings CSV import is: raw multipart file upload
// doesn't fit an action's input shape.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireActiveOrganization } from "../domain/authorization/guards";
import {
  recordDwellingPayment,
  reverseDwellingPayment,
} from "../domain/payments/direct";
import { confirmMatch, rejectMatch } from "../domain/payments/matching";
import {
  matchTransactionToInvoice,
  recordManualPayment,
  updateUnmatchedTransaction,
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

  // One form for both targets: an open invoice, or a dwelling account that has
  // no open invoice. `target` is "invoice:<id>" or "dwelling:<id>".
  recordManual: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      target: z.string().regex(/^(invoice|dwelling):[0-9a-fA-F-]{36}$/),
      method: z.enum(["BANK", "CASH"]).default("BANK"),
      amount: decimalInput(/^\d{1,12}(\.\d{1,2})?$/, POSITIVE_AMOUNT_MESSAGE),
      bookingDate: z.iso.date(),
      payerName: z.string().max(140).optional(),
      reference: z.string().trim().max(140).optional(),
      reason: z.string().trim().min(1).max(500),
      // Required: a retry of a cash payment has no other duplicate check.
      submissionId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, target, ...input }, { locals }) => {
        requireActiveOrganization(locals.auth, organizationId);
        const [kind, id] = target.split(":");
        const actor = locals.auth!.userId;
        await withDb(async (db) => {
          if (kind === "invoice") {
            await recordManualPayment(
              db,
              organizationId,
              { ...input, invoiceId: id },
              actor
            );
          } else {
            await recordDwellingPayment(
              db,
              organizationId,
              { ...input, dwellingId: id },
              actor
            );
          }
        });
        return { recorded: true };
      }
    ),
  }),

  reverseDwellingPayment: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      transactionId: z.uuid(),
      reason: z.string().trim().min(1).max(500),
    }),
    handler: safeHandler(
      async ({ organizationId, transactionId, reason }, { locals }) => {
        requireActiveOrganization(locals.auth, organizationId);
        return withDb((db) =>
          reverseDwellingPayment(
            db,
            organizationId,
            transactionId,
            reason,
            locals.auth!.userId
          )
        );
      }
    ),
  }),

  editUnmatched: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      transactionId: z.uuid(),
      amount: decimalInput(/^\d{1,12}(\.\d{1,2})?$/, POSITIVE_AMOUNT_MESSAGE),
      bookingDate: z.iso.date(),
      payerName: z.string().max(140).optional(),
      reference: z.string().trim().max(140).optional(),
      reason: z.string().trim().min(1).max(500),
    }),
    handler: safeHandler(
      async ({ organizationId, transactionId, ...input }, { locals }) => {
        requireActiveOrganization(locals.auth, organizationId);
        return withDb((db) =>
          updateUnmatchedTransaction(
            db,
            organizationId,
            transactionId,
            input,
            locals.auth!.userId
          )
        );
      }
    ),
  }),
};
