// Phase G (Invoices/delivery) - deterministic invoice HTML (spec Section
// 22: "deterministic server-side invoice HTML template", "do not render
// arbitrary user-provided remote URLs", "must not execute untrusted
// script"). This is the ONE template every surface renders from --
// PDF generation, the admin preview, the resident portal, the public
// token-access page, AND the invoice template editor's own live preview
// (src/lib/ui/invoice-template-editor.ts imports this exact function) all
// call this same function. That's how INV-003's "resident/admin see same
// financial content" holds by construction, and how the editor's preview
// can never drift from the real render.
//
// No remote resources (no <img src="https://...">, no external
// stylesheets/fonts, no script) -- everything is inline, so Browser
// Rendering never fetches anything user-influenced while producing the
// canonical PDF. This file has no server-only runtime dependency (only
// `import type` from the schema modules, erased at build time), which is
// exactly what makes it safe to also bundle into the client-side editor.
import { escapeHtml } from "../../lib/html-escape";
import {
  createDefaultInvoiceTemplateConfig,
  invoiceTemplateSnapshotV1Schema,
  SPACING_CSS,
  type InvoiceTemplateBlock,
  type InvoiceTemplateSnapshotV1,
  type SpacingValue,
} from "./invoice-template-schema";

// Narrow structural types (not the full Drizzle row types) -- this file has
// no server-only runtime dependency as a result, which is what makes it
// safe to also bundle into the client-side editor's live preview, and lets
// a plain sample-data object satisfy the same shape a real invoice does
// without faking every DB column.
export interface InvoiceHtmlInvoice {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  vatTotal: string;
  currentCharges: string;
  previousOutstanding: string;
  previousCreditApplied: string;
  lateFeeApplied: string;
  manualAdjustment: string;
  amountDue: string;
  issuerSnapshot: unknown;
  recipientSnapshot: unknown;
  paymentSnapshot: unknown;
  templateSnapshot: unknown;
}

export interface InvoiceHtmlLine {
  id: string;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  sourceSnapshot: unknown;
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

// Escapes first (the XSS boundary), then turns admin-entered newlines into
// <br /> -- same treatment for every free-text template field.
function escapeMultiline(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

function spacingStyle(spacing: SpacingValue | undefined): string {
  if (!spacing) return "";
  return ` style="margin-top: ${SPACING_CSS[spacing]};"`;
}

// A pre-feature invoice's snapshot is `{}` or an old ad-hoc shape (no
// `version`/`config`), and a corrupted/hand-edited jsonb value could claim
// `version: 1` without actually satisfying the schema (unknown block type,
// invalid `align`/`emphasis`, duplicate ids, a missing/hidden line-items
// block, etc.). Either case falls back to the default config + empty text
// fields, which renders through the exact same block loop below and
// produces byte-identical output to what this file always rendered --
// deliberately NOT the organization's *current* template (spec Section 21:
// an old invoice must never change because someone edited the template
// later). Full schema validation here (not a shallow duck-type check) is
// what keeps an untrusted/corrupted snapshot from ever reaching the block
// loop below with an unvalidated `align`/`emphasis`/block shape.
function normalizeTemplateSnapshot(raw: unknown): InvoiceTemplateSnapshotV1 {
  const result = invoiceTemplateSnapshotV1Schema.safeParse(raw);
  if (result.success) return result.data;
  return {
    version: 1,
    headerText: null,
    footerText: null,
    paymentInstructions: null,
    defaultNote: null,
    config: createDefaultInvoiceTemplateConfig(),
  };
}

// billing_rules.code (already snapshotted onto every line's source_snapshot
// at generation time, see generation.ts) is a stable, admin-chosen
// identifier -- unlike invoiceLine.id (regenerated every period) or the
// line's human-readable description (changes on rename), it survives a
// tariff rename and stays the same across periods, so a saved "hide this
// row" override keeps applying to the right row indefinitely.
export function rowPresentationKey(line: InvoiceHtmlLine): string {
  const source = line.sourceSnapshot as { code?: string } | null;
  return source?.code ?? line.id;
}

export function renderInvoiceHtml(
  invoice: InvoiceHtmlInvoice,
  lines: InvoiceHtmlLine[]
): string {
  const issuer = invoice.issuerSnapshot as IssuerSnapshot;
  const recipient = invoice.recipientSnapshot as RecipientSnapshot;
  const payment = invoice.paymentSnapshot as PaymentSnapshot;
  const template = normalizeTemplateSnapshot(invoice.templateSnapshot);

  const lineRows = lines
    .map((line) => {
      const override = template.config.rowOverrides[rowPresentationKey(line)];
      if (override?.visible === false) return "";
      const trStyle = override?.bold ? ` style="font-weight: 700;"` : "";
      // Spacing goes on each <td>, not the <tr>: table-row boxes don't
      // support margin under normal table layout (browsers silently
      // ignore it), so a row's spacingBefore must be padding-top on its
      // cells to have any visible effect at all.
      const cellStyle = override?.spacingBefore
        ? ` style="padding-top: ${SPACING_CSS[override.spacingBefore]};"`
        : "";
      return `
        <tr${trStyle}>
          <td${cellStyle}>${escapeHtml(line.description)}</td>
          <td class="num"${cellStyle}>${escapeHtml(line.quantity)} ${escapeHtml(line.unit)}</td>
          <td class="num"${cellStyle}>${escapeHtml(line.unitPrice ?? "—")}</td>
          <td class="num"${cellStyle}>${escapeHtml(line.netAmount)}</td>
          <td class="num"${cellStyle}>${escapeHtml(line.vatAmount)}</td>
          <td class="num"${cellStyle}>${escapeHtml(line.grossAmount)}</td>
        </tr>`;
    })
    .join("");

  function renderBlock(block: InvoiceTemplateBlock): string {
    if (!block.visible) return "";
    const spacing = spacingStyle(block.presentation?.spacingBefore);
    switch (block.type) {
      case "meta":
        return `
  <div${spacing}>
    <h1>Invoice ${escapeHtml(invoice.invoiceNumber)}</h1>
    <p class="meta">Issued ${escapeHtml(invoice.issueDate)} &middot; Due ${escapeHtml(invoice.dueDate)}</p>
    ${template.headerText ? `<div class="header-text">${escapeMultiline(template.headerText)}</div>` : ""}
  </div>`;
      case "parties":
        return `
  <div class="parties"${spacing}>
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
  </div>`;
      case "line-items":
        return `
  <div${spacing}>
    <table class="invoice-line-items">
      <thead>
        <tr><th>Description</th><th class="num">Quantity</th><th class="num">Unit price</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Gross</th></tr>
      </thead>
      <tbody>${lineRows}</tbody>
      <tfoot>
        <tr><td colspan="3"></td><td class="num">${escapeHtml(invoice.subtotal)}</td><td class="num">${escapeHtml(invoice.vatTotal)}</td><td class="num">${escapeHtml(invoice.currentCharges)} ${escapeHtml(invoice.currency)}</td></tr>
      </tfoot>
    </table>
    <table class="summary">
      <tbody>
        <tr><td>Current charges</td><td class="num">${escapeHtml(invoice.currentCharges)} ${escapeHtml(invoice.currency)}</td></tr>
        ${invoice.previousOutstanding !== "0.00" ? `<tr><td>Previous outstanding</td><td class="num">+${escapeHtml(invoice.previousOutstanding)} ${escapeHtml(invoice.currency)}</td></tr>` : ""}
        ${invoice.previousCreditApplied !== "0.00" ? `<tr><td>Credit applied</td><td class="num">−${escapeHtml(invoice.previousCreditApplied)} ${escapeHtml(invoice.currency)}</td></tr>` : ""}
        ${invoice.lateFeeApplied !== "0.00" ? `<tr><td>Late fee</td><td class="num">+${escapeHtml(invoice.lateFeeApplied)} ${escapeHtml(invoice.currency)}</td></tr>` : ""}
        ${invoice.manualAdjustment !== "0.00" ? `<tr><td>Manual adjustment</td><td class="num">${escapeHtml(invoice.manualAdjustment)} ${escapeHtml(invoice.currency)}</td></tr>` : ""}
      </tbody>
      <tfoot><tr><td>Amount due</td><td class="num">${escapeHtml(invoice.amountDue)} ${escapeHtml(invoice.currency)}</td></tr></tfoot>
    </table>
  </div>`;
      case "payment":
        return `
  <div class="payment"${spacing}>
    ${payment.bankName ? `Bank: ${escapeHtml(payment.bankName)}<br />` : ""}
    ${payment.iban ? `IBAN: ${escapeHtml(payment.iban)}` : ""}
    ${payment.bic ? ` &middot; BIC: ${escapeHtml(payment.bic)}` : ""}
    ${template.paymentInstructions ? `<p>${escapeMultiline(template.paymentInstructions)}</p>` : ""}
  </div>`;
      case "default-note":
        return template.defaultNote
          ? `<div class="note"${spacing}>${escapeMultiline(template.defaultNote)}</div>`
          : "";
      case "footer":
        return template.footerText
          ? `<div class="footer-text"${spacing}>${escapeMultiline(template.footerText)}</div>`
          : "";
      case "text": {
        const align = block.align ?? "left";
        const style = [
          `text-align: ${align};`,
          block.emphasis === "bold" ? "font-weight: 700;" : "",
          block.presentation?.spacingBefore
            ? `margin-top: ${SPACING_CSS[block.presentation.spacingBefore]};`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<div class="custom-text" style="${style}">${escapeMultiline(block.text)}</div>`;
      }
    }
  }

  const body = template.config.document.blocks.map(renderBlock).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #171717; margin: 2rem; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #525252; margin-bottom: 1.5rem; }
  .header-text { margin-bottom: 1rem; }
  .parties { display: flex; justify-content: space-between; margin-bottom: 1.5rem; }
  .parties div { max-width: 45%; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e5e5; text-align: left; }
  .num { text-align: right; }
  tfoot td { border-top: 2px solid #171717; border-bottom: none; font-weight: bold; }
  .summary { width: 52%; margin-left: auto; }
  .payment { margin-top: 1.5rem; color: #525252; }
  .note { margin-top: 0.75rem; color: #525252; }
  .footer-text { margin-top: 2rem; padding-top: 0.75rem; border-top: 1px solid #e5e5e5; color: #525252; }
  .custom-text { margin-top: 0.75rem; }
  thead { display: table-header-group; }
  tr, .parties, .payment, .summary { break-inside: avoid; }
</style>
</head>
<body>${body}
</body>
</html>`;
}
