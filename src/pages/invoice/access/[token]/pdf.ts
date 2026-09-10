// Phase G (Invoices/delivery) - tokenized canonical PDF download (spec
// Section 22/24: "authenticated downloads authorize first", "email token
// access resolves only its specific invoice").
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { INVOICE_TOKEN_SECRET } from "astro:env/server";
import { resolveInvoiceAccessToken } from "../../../../domain/billing/invoice-tokens";
import { getInvoice } from "../../../../domain/billing/generation";
import { downloadInvoicePdf } from "../../../../lib/storage/invoices";
import { withRequestDb } from "../../../../lib/db-request";
import { getSupabaseAdmin } from "../../../../actions/_supabase_admin";

export const GET: APIRoute = async ({ params, clientAddress }) => {
  const rawToken = params.token;
  if (!rawToken) {
    return new Response("Not found", { status: 404 });
  }

  // Spec Section 33: "auth/public token rate limiting".
  const { success } = await env.INVOICE_TOKEN_RATE_LIMITER.limit({
    key: clientAddress,
  });
  if (!success) {
    return new Response("Too many requests", { status: 429 });
  }

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
    if (!invoice.pdfObjectKey) {
      return new Response("PDF not available yet", { status: 404 });
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
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return new Response("This link is invalid or has expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
};
