// Phase G (Invoices/delivery) - invoice sending actions (spec Section 10,
// INV-006).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { env } from "cloudflare:workers";
import { APP_BASE_URL, INVOICE_TOKEN_SECRET } from "astro:env/server";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import {
  bulkSendInvoices,
  recordPaperDispatch,
  resendInvoice,
  sendInvoice,
} from "../domain/billing/sending";
import { revokeInvoiceAccessTokens } from "../domain/billing/invoice-tokens";
import { renderPdf } from "../lib/pdf/render";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";
import { getSupabaseAdmin } from "./_supabase_admin";
import { getEmailService } from "./_email";

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
  send: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, invoiceId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        sendInvoice(
          db,
          organizationId,
          invoiceId,
          sendDeps(),
          locals.auth!.userId
        )
      );
    }),
  }),

  resend: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
      // A fresh value rendered into the Resend form on each page load
      // (see [invoiceId].astro). Correlates concurrent submissions of the
      // SAME form back to one logical click; see claimSendCommand.
      commandId: z.string().min(1).max(100),
    }),
    handler: safeHandler(
      async ({ organizationId, invoiceId, commandId }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          resendInvoice(
            db,
            organizationId,
            invoiceId,
            sendDeps(),
            locals.auth!.userId,
            commandId
          )
        );
      }
    ),
  }),

  recordPaperDispatch: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, invoiceId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        recordPaperDispatch(db, organizationId, invoiceId, locals.auth!.userId)
      );
    }),
  }),

  // spec Section 27: workbench bulk selection.
  bulkSend: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceIds: z.array(z.uuid()).min(1),
    }),
    handler: safeHandler(async ({ organizationId, invoiceIds }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        bulkSendInvoices(
          db,
          organizationId,
          invoiceIds,
          sendDeps(),
          locals.auth!.userId
        )
      );
    }),
  }),

  revokeAccess: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      invoiceId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, invoiceId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        revokeInvoiceAccessTokens(
          db,
          organizationId,
          invoiceId,
          locals.auth!.userId
        )
      );
    }),
  }),
};
