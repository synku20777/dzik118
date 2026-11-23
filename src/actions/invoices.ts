// Phase G (Invoices/delivery) - invoice sending actions (spec Section 10,
// INV-006).
import { z } from "astro/zod";
import { env } from "cloudflare:workers";
import { APP_BASE_URL, INVOICE_TOKEN_SECRET } from "astro:env/server";
import {
  bulkSendInvoices,
  markInvoiceDelivered,
  recordPaperDispatch,
  resendInvoice,
  sendInvoice,
} from "../domain/billing/sending";
import { revokeInvoiceAccessTokens } from "../domain/billing/invoice-tokens";
import { renderPdf } from "../lib/pdf/render";
import { withRequestDb as withDb } from "../lib/db-request";
import { getSupabaseAdmin } from "./_supabase_admin";
import { getEmailService } from "./_email";
import { orgAction } from "./_org-action";

function sendDeps() {
  return {
    renderPdf: (html: string) => renderPdf(env.BROWSER, html),
    supabaseAdmin: getSupabaseAdmin(),
    emailService: getEmailService(),
    tokenSecret: INVOICE_TOKEN_SECRET,
    appBaseUrl: APP_BASE_URL,
  };
}

export const invoices = {
  send: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: async ({ organizationId, invoiceId }, { locals }) => {
      // Only what the pages read: a whole invoice is too large for the
      // redirect-after-post cookie (src/middleware.ts).
      const { sentAt } = await withDb((db) =>
        sendInvoice(
          db,
          organizationId,
          invoiceId,
          sendDeps(),
          locals.auth!.userId
        )
      );
      return { sentAt };
    },
  }),

  resend: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
      // A fresh value rendered into the Resend form on each page load
      // (see [invoiceId].astro). Correlates concurrent submissions of the
      // SAME form back to one logical click; see claimSendCommand.
      commandId: z.string().min(1).max(100),
    }),
    handler: async ({ organizationId, invoiceId, commandId }, { locals }) => {
      const { sentAt } = await withDb((db) =>
        resendInvoice(
          db,
          organizationId,
          invoiceId,
          sendDeps(),
          locals.auth!.userId,
          commandId
        )
      );
      return { sentAt };
    },
  }),

  recordPaperDispatch: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: async ({ organizationId, invoiceId }, { locals }) => {
      const { sentAt } = await withDb((db) =>
        recordPaperDispatch(db, organizationId, invoiceId, locals.auth!.userId)
      );
      return { sentAt };
    },
  }),

  markDelivered: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
      attemptId: z.uuid(),
    }),
    handler: async ({ organizationId, invoiceId, attemptId }, { locals }) => {
      return withDb((db) =>
        markInvoiceDelivered(
          db,
          organizationId,
          invoiceId,
          attemptId,
          locals.auth.userId
        )
      );
    },
  }),

  // spec Section 27: workbench bulk selection.
  bulkSend: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceIds: z.array(z.uuid()).min(1).max(200),
    }),
    handler: async ({ organizationId, invoiceIds }, { locals }) => {
      const result = await withDb((db) =>
        bulkSendInvoices(
          db,
          organizationId,
          invoiceIds,
          sendDeps(),
          locals.auth!.userId
        )
      );
      return {
        count: result.sent.length,
        skippedCount: result.skipped.length,
        skipReasons: [...new Set(result.skipped.map((s) => s.reason))],
      };
    },
  }),

  revokeAccess: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: async ({ organizationId, invoiceId }, { locals }) => {
      return withDb((db) =>
        revokeInvoiceAccessTokens(
          db,
          organizationId,
          invoiceId,
          locals.auth!.userId
        )
      );
    },
  }),
};
