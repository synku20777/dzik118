// Phase G (Invoices/delivery) - authenticated admin PDF download (spec
// Section 22: "authenticated downloads authorize first").
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getInvoice } from "../../../../../../../../domain/billing/generation";
import { requireOrganizationAccess } from "../../../../../../../../domain/authorization/guards";
import { parseInvoiceLocale } from "../../../../../../../../domain/billing/invoice-i18n";
import { renderInvoiceHtml } from "../../../../../../../../domain/billing/invoice-html";
import { renderPdf } from "../../../../../../../../lib/pdf/render";
import {
  invoicePdfResponse,
  invoiceCopyPdfResponse,
  invoicePdfNotReadyResponse,
} from "../../../../../../../../lib/storage/invoices";
import { toApiErrorResponse } from "../../../../../../../../lib/http/api-error";
import { withRequestDb } from "../../../../../../../../lib/db-request";
import { getSupabaseAdmin } from "../../../../../../../../actions/_supabase_admin";

export const GET: APIRoute = async ({ params, locals, url }) => {
  const organizationId = params.orgId;
  const invoiceId = params.invoiceId;
  if (!organizationId || !invoiceId) {
    return toApiErrorResponse(new Error("missing params"));
  }

  try {
    requireOrganizationAccess(locals.auth, organizationId);
  } catch (err) {
    return toApiErrorResponse(err);
  }

  const locale = parseInvoiceLocale(url.searchParams.get("locale"));

  try {
    if (locale === "lv") {
      const invoice = await withRequestDb(async (db) => {
        const { invoice } = await getInvoice(db, organizationId, invoiceId);
        return invoice;
      });
      return await invoicePdfResponse(getSupabaseAdmin(), invoice);
    }
    // EN/RU: rendered fresh on every request, never uploaded/persisted --
    // see invoiceCopyPdfResponse's header comment.
    const { invoice, lines } = await withRequestDb((db) =>
      getInvoice(db, organizationId, invoiceId)
    );
    if (!invoice.pdfObjectKey) return invoicePdfNotReadyResponse();
    const html = renderInvoiceHtml(invoice, lines, locale);
    const pdfBytes = await renderPdf(env.BROWSER, html);
    return invoiceCopyPdfResponse(pdfBytes, invoice.invoiceNumber, locale);
  } catch (err) {
    return toApiErrorResponse(err);
  }
};
