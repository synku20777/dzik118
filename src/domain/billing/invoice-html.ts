// Phase G (Invoices/delivery) - deterministic invoice HTML (spec Section
// 22: "deterministic server-side invoice HTML template", "do not render
// arbitrary user-provided remote URLs", "must not execute untrusted
// script"). This is the ONE template every surface renders from --
// PDF generation, the admin preview, the resident portal, and the public
// token-access page all call this same function, which is exactly how
// INV-003's "resident/admin see same financial content" holds by
// construction rather than by keeping two templates in sync by hand.
//
// No remote resources (no <img src="https://...">, no external
// stylesheets/fonts, no script) -- everything is inline, so Browser
// Rendering never fetches anything user-influenced while producing the
// canonical PDF.
import type { invoiceLines, invoices } from "../../db/schema/invoices";

type Invoice = typeof invoices.$inferSelect;
type InvoiceLine = typeof invoiceLines.$inferSelect;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface IssuerSnapshot {
  name?: string;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string;
  email?: string | null;
  phone?: string | null;
}

interface RecipientSnapshot {
  dwellingNumber?: string;
  displayName?: string | null;
  occupantName?: string | null;
  billingName?: string | null;
  billingEmail?: string | null;
  billingAddress?: string | null;
}

interface PaymentSnapshot {
  bankName?: string | null;
  iban?: string | null;
  bic?: string | null;
  currency?: string;
}

export function renderInvoiceHtml(
  invoice: Invoice,
  lines: InvoiceLine[]
): string {
  const issuer = invoice.issuerSnapshot as IssuerSnapshot;
  const recipient = invoice.recipientSnapshot as RecipientSnapshot;
  const payment = invoice.paymentSnapshot as PaymentSnapshot;

  const lineRows = lines
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(line.description)}</td>
          <td class="num">${escapeHtml(line.quantity)} ${escapeHtml(line.unit)}</td>
          <td class="num">${escapeHtml(line.unitPrice ?? "—")}</td>
          <td class="num">${escapeHtml(line.netAmount)}</td>
          <td class="num">${escapeHtml(line.vatAmount)}</td>
          <td class="num">${escapeHtml(line.grossAmount)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #171717; margin: 2rem; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #525252; margin-bottom: 1.5rem; }
  .parties { display: flex; justify-content: space-between; margin-bottom: 1.5rem; }
  .parties div { max-width: 45%; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e5e5; text-align: left; }
  .num { text-align: right; }
  tfoot td { border-top: 2px solid #171717; border-bottom: none; font-weight: bold; }
  .payment { margin-top: 1.5rem; color: #525252; }
</style>
</head>
<body>
  <h1>Invoice ${escapeHtml(invoice.invoiceNumber)}</h1>
  <p class="meta">Issued ${escapeHtml(invoice.issueDate)} &middot; Due ${escapeHtml(invoice.dueDate)}</p>
  <div class="parties">
    <div>
      <strong>${escapeHtml(issuer.name)}</strong><br />
      ${escapeHtml(issuer.addressLine1)}<br />
      ${issuer.addressLine2 ? `${escapeHtml(issuer.addressLine2)}<br />` : ""}
      ${[issuer.postalCode, issuer.city].filter(Boolean).map(escapeHtml).join(" ")}
    </div>
    <div>
      <strong>${escapeHtml(recipient.billingName ?? recipient.occupantName ?? "")}</strong><br />
      Dwelling ${escapeHtml(recipient.dwellingNumber)}<br />
      ${recipient.billingAddress ? escapeHtml(recipient.billingAddress) : ""}
    </div>
  </div>
  <table>
    <thead>
      <tr><th>Description</th><th class="num">Quantity</th><th class="num">Unit price</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Gross</th></tr>
    </thead>
    <tbody>${lineRows}</tbody>
    <tfoot>
      <tr><td colspan="3"></td><td class="num">${escapeHtml(invoice.subtotal)}</td><td class="num">${escapeHtml(invoice.vatTotal)}</td><td class="num">${escapeHtml(invoice.total)} ${escapeHtml(invoice.currency)}</td></tr>
    </tfoot>
  </table>
  <div class="payment">
    ${payment.bankName ? `Bank: ${escapeHtml(payment.bankName)}<br />` : ""}
    ${payment.iban ? `IBAN: ${escapeHtml(payment.iban)}` : ""}
    ${payment.bic ? ` &middot; BIC: ${escapeHtml(payment.bic)}` : ""}
  </div>
</body>
</html>`;
}
