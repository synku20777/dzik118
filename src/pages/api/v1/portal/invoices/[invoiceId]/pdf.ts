// Phase G (Invoices/delivery) - authenticated resident PDF download (spec
// Section 22: "authenticated downloads authorize first").
import type { APIRoute } from "astro";
import { getInvoiceForResident } from "../../../../../../domain/billing/generation";
import { requireDwellingAccess } from "../../../../../../domain/authorization/guards";
import { invoicePdfResponse } from "../../../../../../lib/storage/invoices";
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
    return await invoicePdfResponse(getSupabaseAdmin(), invoice);
  } catch (err) {
    return toApiErrorResponse(err);
  }
};
