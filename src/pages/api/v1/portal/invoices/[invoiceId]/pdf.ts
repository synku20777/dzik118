// Phase G (Invoices/delivery) - authenticated resident PDF download (spec
// Section 22: "authenticated downloads authorize first").
import type { APIRoute } from "astro";
import { getInvoiceForResident } from "../../../../../../domain/billing/generation";
import { requireDwellingAccess } from "../../../../../../domain/authorization/guards";
import { downloadInvoicePdf } from "../../../../../../lib/storage/invoices";
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

  try {
    const invoice = await withRequestDb(async (db) => {
      const { invoice } = await getInvoiceForResident(
        db,
        invoiceId,
        dwellingId
      );
      return invoice;
    });
    if (!invoice.pdfObjectKey) {
      return new Response("PDF not generated yet", { status: 404 });
    }
    const pdf = await downloadInvoicePdf(
      getSupabaseAdmin(),
      invoice.pdfObjectKey
    );
    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
};
