// Phase G (Invoices/delivery) - authenticated resident PDF download (spec
// Section 22: "authenticated downloads authorize first").
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getInvoiceForResident } from "../../../../../../domain/billing/generation";
import { requireDwellingAccess } from "../../../../../../domain/authorization/guards";
import { parseInvoiceLocale } from "../../../../../../domain/billing/invoice-i18n";
import { renderInvoiceHtml } from "../../../../../../domain/billing/invoice-html";
import { renderPdf } from "../../../../../../lib/pdf/render";
import {
  invoicePdfResponse,
  invoiceCopyPdfResponse,
  invoicePdfNotReadyResponse,
} from "../../../../../../lib/storage/invoices";
import { toApiErrorResponse } from "../../../../../../lib/http/api-error";
import { withRequestDb } from "../../../../../../lib/db-request";
import { getSupabaseAdmin } from "../../../../../../actions/_supabase_admin";

export const GET: APIRoute = async ({ params, locals, url }) => {
  const invoiceId = params.invoiceId;
  const dwellingId = url.searchParams.get("dwellingId");
  if (!invoiceId || !dwellingId) {
    return toApiErrorResponse(new Error("missing params"));
  }

  try {
    requireDwellingAccess(locals.auth, dwellingId);
  } catch (err) {
    return toApiErrorResponse(err);
  }

  const locale = parseInvoiceLocale(url.searchParams.get("locale"));

  try {
    if (locale === "lv") {
      const invoice = await withRequestDb(async (db) => {
        const { invoice } = await getInvoiceForResident(
          db,
          invoiceId,
          dwellingId
        );
        return invoice;
      });
      return await invoicePdfResponse(getSupabaseAdmin(), invoice);
    }
    // EN/RU: rendered fresh on every request, never uploaded/persisted --
    // see invoiceCopyPdfResponse's header comment.
    const { invoice, lines } = await withRequestDb((db) =>
      getInvoiceForResident(db, invoiceId, dwellingId)
    );
    if (!invoice.pdfObjectKey) return invoicePdfNotReadyResponse();
    const html = renderInvoiceHtml(invoice, lines, locale);
    const pdfBytes = await renderPdf(env.BROWSER, html);
    return invoiceCopyPdfResponse(pdfBytes, invoice.invoiceNumber, locale);
  } catch (err) {
    return toApiErrorResponse(err);
  }
};
