// Phase G (Invoices/delivery) - tokenized invoice access (spec Section 24,
// INV-003/005). Public: no session/portal access is granted by this route
// (spec: "no portal/session elevation"), it only ever resolves the one
// invoice the token names. Same template as the PDF and the resident
// portal view, so "resident/admin see same financial content" (INV-003)
// holds by construction.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { INVOICE_TOKEN_SECRET } from "astro:env/server";
import { resolveInvoiceAccessToken } from "../../../domain/billing/invoice-tokens";
import { getInvoice } from "../../../domain/billing/generation";
import { renderInvoiceHtml } from "../../../domain/billing/invoice-html";
import { withRequestDb } from "../../../lib/db-request";

export const GET: APIRoute = async ({ params, clientAddress }) => {
  const rawToken = params.token;
  if (!rawToken) {
    return new Response("Not found", { status: 404 });
  }

  // Spec Section 33: "auth/public token rate limiting" -- this route is
  // unauthenticated by design, so it needs its own throttle independent
  // of the admin/resident session-based ones.
  const { success } = await env.INVOICE_TOKEN_RATE_LIMITER.limit({
    key: clientAddress,
  });
  if (!success) {
    return new Response("Too many requests", { status: 429 });
  }

  try {
    const { invoice, lines } = await withRequestDb(async (db) => {
      const { organizationId, invoiceId } = await resolveInvoiceAccessToken(
        db,
        rawToken,
        INVOICE_TOKEN_SECRET
      );
      return getInvoice(db, organizationId, invoiceId);
    });

    const html = renderInvoiceHtml(invoice, lines).replace(
      "</body>",
      `<p><a href="/invoice/access/${encodeURIComponent(rawToken)}/pdf">Download PDF</a></p></body>`
    );
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Never cached anywhere between the resident's browser and here --
        // this response is keyed on a bearer-token-shaped URL segment.
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    // Uniform response for "no such token", "revoked", "expired" -- spec
    // Section 24 gives a public caller no way to distinguish these.
    return new Response("This link is invalid or has expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
};
