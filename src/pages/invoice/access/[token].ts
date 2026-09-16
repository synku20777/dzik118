// Phase G (Invoices/delivery) - tokenized invoice access (spec Section 24,
// INV-003/005). Public: no session/portal access is granted by this route
// (spec: "no portal/session elevation"), it only ever resolves the one
// invoice the token names. Same template as the PDF and the resident
// portal view, so "resident/admin see same financial content" (INV-003)
// holds by construction.
import type { APIRoute } from "astro";
import { INVOICE_TOKEN_SECRET } from "astro:env/server";
import { resolveInvoiceAccessToken } from "../../../domain/billing/invoice-tokens";
import { getInvoice } from "../../../domain/billing/generation";
import { renderInvoiceHtml } from "../../../domain/billing/invoice-html";
import { parseInvoiceLocale } from "../../../domain/billing/invoice-i18n";
import { withRequestDb } from "../../../lib/db-request";
import {
  invalidInvoiceLinkResponse,
  checkPublicInvoiceTokenRequest,
} from "../../../lib/http/public-invoice-token";

export const GET: APIRoute = async ({ params, request, url }) => {
  const tokenOrResponse = await checkPublicInvoiceTokenRequest(
    params.token,
    request
  );
  if (tokenOrResponse instanceof Response) return tokenOrResponse;
  const rawToken = tokenOrResponse;
  const locale = parseInvoiceLocale(url.searchParams.get("locale"));

  try {
    const { invoice, lines } = await withRequestDb(async (db) => {
      const { organizationId, invoiceId } = await resolveInvoiceAccessToken(
        db,
        rawToken,
        INVOICE_TOKEN_SECRET
      );
      return getInvoice(db, organizationId, invoiceId);
    });

    const encodedToken = encodeURIComponent(rawToken);
    // Plain GET links, not a form/script -- this page has no Astro layout
    // or client-side JS, so a locale switch is just a link to the same
    // page with a different query param, same pattern as the invoice
    // template editor's period selector. Endonyms, not translated text:
    // this is a document-language choice, unrelated to the viewer's own
    // browser/UI language. `aria-current` (not just <strong>) marks the
    // active language for assistive tech, and the explanatory sentence
    // makes clear EN/RU are copies of this same invoice, not separate
    // ones -- the same guarantee the authenticated admin/resident pages
    // already state explicitly.
    const localeLinks = (["lv", "en", "ru"] as const)
      .map((l) => {
        const label = { lv: "Latviešu", en: "English", ru: "Русский" }[l];
        return l === locale
          ? `<strong aria-current="true">${label}</strong>`
          : `<a href="/invoice/access/${encodedToken}?locale=${l}">${label}</a>`;
      })
      .join(" &middot; ");
    const html = renderInvoiceHtml(invoice, lines, locale).replace(
      "</body>",
      `<nav aria-label="Document language">` +
        `<p>Latvian is the canonical invoice document. English and Russian are optional translated copies of the same invoice — not separate invoices.</p>` +
        `<p>${localeLinks}</p>` +
        `</nav>` +
        `<p><a href="/invoice/access/${encodedToken}/pdf${locale === "lv" ? "" : `?locale=${locale}`}">Download PDF</a></p></body>`
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
    return invalidInvoiceLinkResponse();
  }
};
