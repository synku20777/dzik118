// Phase J (Payments) - payment match confirm/reject actions (spec Section
// 10, PAY-003). The CSV upload/preview/confirm flow itself is a plain page
// (src/pages/admin/o/[orgId]/payments/import.astro), not an action, for
// the same reason the dwellings CSV import is: raw multipart file upload
// doesn't fit an action's input shape.
import { z } from "astro/zod";
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
import { withRequestDb as withDb } from "../lib/db-request";
import { orgAction } from "./_org-action";

const POSITIVE_AMOUNT_MESSAGE =
  "Enter a valid amount, for example 12.50. Use up to 2 decimal places.";

export const payments = {
  confirmMatch: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      matchId: z.uuid(),
    }),
    handler: async ({ organizationId, matchId }, { locals }) => {
      return withDb((db) =>
        confirmMatch(db, organizationId, matchId, locals.auth!.userId)
      );
    },
  }),

  rejectMatch: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      matchId: z.uuid(),
    }),
    handler: async ({ organizationId, matchId }, { locals }) => {
      return withDb((db) =>
        rejectMatch(db, organizationId, matchId, locals.auth!.userId)
      );
    },
  }),

  reverseMatch: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      matchId: z.uuid(),
      reason: z.string().trim().min(1).max(500),
    }),
    handler: async ({ organizationId, matchId, reason }, { locals }) => {
      return withDb((db) =>
        reversePayment(db, organizationId, matchId, reason, locals.auth!.userId)
      );
    },
  }),

  matchTransaction: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      transactionId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: async (
      { organizationId, transactionId, invoiceId },
      { locals }
    ) => {
      return withDb((db) =>
        matchTransactionToInvoice(
          db,
          organizationId,
          transactionId,
          invoiceId,
          locals.auth!.userId
        )
      );
    },
  }),

  // One form for both targets: an open invoice, or a dwelling account that has
  // no open invoice. `target` is "invoice:<id>" or "dwelling:<id>".
  recordManual: orgAction({
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
    handler: async ({ organizationId, target, ...input }, { locals }) => {
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
    },
  }),

  reverseDwellingPayment: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      transactionId: z.uuid(),
      reason: z.string().trim().min(1).max(500),
    }),
    handler: async ({ organizationId, transactionId, reason }, { locals }) => {
      return withDb((db) =>
        reverseDwellingPayment(
          db,
          organizationId,
          transactionId,
          reason,
          locals.auth!.userId
        )
      );
    },
  }),

  editUnmatched: orgAction({
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
    handler: async (
      { organizationId, transactionId, ...input },
      { locals }
    ) => {
      return withDb((db) =>
        updateUnmatchedTransaction(
          db,
          organizationId,
          transactionId,
          input,
          locals.auth!.userId
        )
      );
    },
  }),
};
