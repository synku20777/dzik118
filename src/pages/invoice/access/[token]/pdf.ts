// Phase G (Invoices/delivery) - tokenized canonical PDF download (spec
// Section 22/24: "authenticated downloads authorize first", "email token
// access resolves only its specific invoice").
import type { APIRoute } from "astro";
import { INVOICE_TOKEN_SECRET } from "astro:env/server";
import { resolveInvoiceAccessToken } from "../../../../domain/billing/invoice-tokens";
import { getInvoice } from "../../../../domain/billing/generation";
import { invoicePdfResponse } from "../../../../lib/storage/invoices";
import { withRequestDb } from "../../../../lib/db-request";
import { getSupabaseAdmin } from "../../../../actions/_supabase_admin";
import {
  invalidInvoiceLinkResponse,
  checkPublicInvoiceTokenRequest,
} from "../../../../lib/http/public-invoice-token";

export const GET: APIRoute = async ({ params, request }) => {
  const tokenOrResponse = await checkPublicInvoiceTokenRequest(
    params.token,
    request
  );
  if (tokenOrResponse instanceof Response) return tokenOrResponse;
  const rawToken = tokenOrResponse;

  try {
    const invoice = await withRequestDb(async (db) => {
      const { organizationId, invoiceId } = await resolveInvoiceAccessToken(
        db,
        rawToken,
        INVOICE_TOKEN_SECRET
      );
      const { invoice } = await getInvoice(db, organizationId, invoiceId);
      return invoice;
    });
    return await invoicePdfResponse(getSupabaseAdmin(), invoice, {
      notReadyMessage: "PDF not available yet",
      extraHeaders: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return invalidInvoiceLinkResponse();
  }
};
