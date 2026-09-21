// Phase G (Invoices/delivery) - authenticated admin PDF download (spec
// Section 22: "authenticated downloads authorize first").
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getInvoice } from "../../../../../../../../domain/billing/generation";
import { ensureCanonicalPdf } from "../../../../../../../../domain/billing/sending";
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

const CANONICAL_PDF_ELIGIBLE_STATUSES = ["PREPARED", "SENT", "PAID", "OVERDUE"];

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
    const { invoice, lines, caseStatus } = await withRequestDb(async (db) => {
      const data = await getInvoice(db, organizationId, invoiceId);
      if (
        data.caseStatus &&
        CANONICAL_PDF_ELIGIBLE_STATUSES.includes(data.caseStatus) &&
        !data.invoice.pdfObjectKey
      ) {
        const canonical = await ensureCanonicalPdf(
          db,
          organizationId,
          invoiceId,
          {
            renderPdf: (html) => renderPdf(env.BROWSER, html),
            supabaseAdmin: getSupabaseAdmin(),
          }
        );
        data.invoice.pdfObjectKey = canonical.pdfObjectKey;
        data.invoice.pdfSha256 = canonical.pdfSha256;
      }
      return data;
    });

    if (caseStatus === "DRAFT" || !invoice.pdfObjectKey) {
      return invoicePdfNotReadyResponse();
    }

    if (locale === "lv") {
      return await invoicePdfResponse(getSupabaseAdmin(), invoice);
    }

    // EN/RU: rendered fresh on every request, never uploaded/persisted --
    // see invoiceCopyPdfResponse's header comment.
    const html = renderInvoiceHtml(invoice, lines, locale);
    const pdfBytes = await renderPdf(env.BROWSER, html);
    return invoiceCopyPdfResponse(pdfBytes, invoice.invoiceNumber, locale);
  } catch (err) {
    return toApiErrorResponse(err);
  }
};
