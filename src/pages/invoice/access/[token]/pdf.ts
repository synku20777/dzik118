// Phase G (Invoices/delivery) - tokenized canonical PDF download (spec
// Section 22/24: "authenticated downloads authorize first", "email token
// access resolves only its specific invoice").
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { INVOICE_TOKEN_SECRET } from "astro:env/server";
import { resolveInvoiceAccessToken } from "../../../../domain/billing/invoice-tokens";
import { getInvoice } from "../../../../domain/billing/generation";
import { parseInvoiceLocale } from "../../../../domain/billing/invoice-i18n";
import { renderInvoiceHtml } from "../../../../domain/billing/invoice-html";
import { renderPdf } from "../../../../lib/pdf/render";
import {
  invoicePdfResponse,
  invoiceCopyPdfResponse,
  invoicePdfNotReadyResponse,
} from "../../../../lib/storage/invoices";
import { withRequestDb } from "../../../../lib/db-request";
import { getSupabaseAdmin } from "../../../../actions/_supabase_admin";
import {
  invalidInvoiceLinkResponse,
  checkPublicInvoiceTokenRequest,
} from "../../../../lib/http/public-invoice-token";

const NO_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
};

export const GET: APIRoute = async ({ params, request, url }) => {
  const tokenOrResponse = await checkPublicInvoiceTokenRequest(
    params.token,
    request
  );
  if (tokenOrResponse instanceof Response) return tokenOrResponse;
  const rawToken = tokenOrResponse;
  const locale = parseInvoiceLocale(url.searchParams.get("locale"));

  try {
    if (locale === "lv") {
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
        extraHeaders: NO_CACHE_HEADERS,
      });
    }
    // EN/RU: rendered fresh on every request, never uploaded/persisted --
    // see invoiceCopyPdfResponse's header comment.
    const { invoice, lines } = await withRequestDb(async (db) => {
      const { organizationId, invoiceId } = await resolveInvoiceAccessToken(
        db,
        rawToken,
        INVOICE_TOKEN_SECRET
      );
      return getInvoice(db, organizationId, invoiceId);
    });
    if (!invoice.pdfObjectKey) {
      return invoicePdfNotReadyResponse("PDF not available yet");
    }
    const html = renderInvoiceHtml(invoice, lines, locale);
    const pdfBytes = await renderPdf(env.BROWSER, html);
    return invoiceCopyPdfResponse(
      pdfBytes,
      invoice.invoiceNumber,
      locale,
      NO_CACHE_HEADERS
    );
  } catch {
    return invalidInvoiceLinkResponse();
  }
};
