// Phase G (Invoices/delivery) - authenticated admin PDF download (spec
// Section 22: "authenticated downloads authorize first").
import type { APIRoute } from "astro";
import { getInvoice } from "../../../../../../../../domain/billing/generation";
import { requireOrganizationAccess } from "../../../../../../../../domain/authorization/guards";
import { invoicePdfResponse } from "../../../../../../../../lib/storage/invoices";
import { toApiErrorResponse } from "../../../../../../../../lib/http/api-error";
import { withRequestDb } from "../../../../../../../../lib/db-request";
import { getSupabaseAdmin } from "../../../../../../../../actions/_supabase_admin";

export const GET: APIRoute = async ({ params, locals }) => {
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

  try {
    const invoice = await withRequestDb(async (db) => {
      const { invoice } = await getInvoice(db, organizationId, invoiceId);
      return invoice;
    });
    return await invoicePdfResponse(getSupabaseAdmin(), invoice);
  } catch (err) {
    return toApiErrorResponse(err);
  }
};
