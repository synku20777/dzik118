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
  pickLocalizedText,
  translateInvoiceLabel,
  type InvoiceLocale,
} from "./invoice-i18n";
import { tryBuildSepaQrSvg } from "./sepa-qr";
import {
  normalizeInvoiceTemplateSnapshot,
  SPACING_CSS,
  type InvoiceTemplateBlock,
  type SpacingValue,
} from "./invoice-template-schema";

export type { InvoiceLocale };

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

// The full billing_rules row is already snapshotted onto every line's
// sourceSnapshot at generation time (generation.ts), which -- now that
// billing_rules carries nameEn/nameRu -- means a rule's translated labels
// are already frozen there too, for free: no separate snapshot plumbing
// needed for tariff-label historical immutability.
interface RuleSourceSnapshot {
  code?: string;
  nameEn?: string | null;
  nameRu?: string | null;
}

// Escapes first (the XSS boundary), then turns admin-entered newlines into
// <br /> -- same treatment for every free-text template field.
function escapeMultiline(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

// LV (line.description, the canonical value stored at generation time) is
// always the fallback -- a missing/blank translation never renders blank
// content, per pickLocalizedText's own contract.
function localizedLineDescription(
  line: InvoiceHtmlLine,
  locale: InvoiceLocale
): string {
  const source = line.sourceSnapshot as RuleSourceSnapshot | null;
  return pickLocalizedText(
    locale,
    line.description,
    source?.nameEn,
    source?.nameRu
  );
}

function localizedTemplateText(
  value: string | null,
  translations: { en?: string; ru?: string } | undefined,
  locale: InvoiceLocale
): string | null {
  // Bails out only when there is truly nothing to show in this locale --
  // NOT just because the Latvian value is blank. An admin who set an
  // English header but left the Latvian one empty must still see that
  // English header when rendering in English; checking `!value` alone
  // (before AG-3's review fix) would have hidden it even though a real
  // translation existed.
  const translationForLocale =
    locale === "en"
      ? translations?.en
      : locale === "ru"
        ? translations?.ru
        : undefined;
  if (!value && !translationForLocale?.trim()) return null;
  return pickLocalizedText(
    locale,
    value ?? "",
    translations?.en,
    translations?.ru
  );
}

function spacingStyle(spacing: SpacingValue | undefined): string {
  if (!spacing) return "";
  return ` style="margin-top: ${SPACING_CSS[spacing]};"`;
}

// billing_rules.code (already snapshotted onto every line's source_snapshot
// at generation time, see generation.ts) is a stable, admin-chosen
// identifier -- unlike invoiceLine.id (regenerated every period) or the
// line's human-readable description (changes on rename), it survives a
// tariff rename and stays the same across periods, so a saved bold/spacing
// override keeps applying to the right row indefinitely.
export function rowPresentationKey(line: InvoiceHtmlLine): string {
  const source = line.sourceSnapshot as { code?: string } | null;
  return source?.code ?? line.id;
}

export function renderInvoiceHtml(
  invoice: InvoiceHtmlInvoice,
  lines: InvoiceHtmlLine[],
  locale: InvoiceLocale = "lv"
): string {
  const issuer = invoice.issuerSnapshot as IssuerSnapshot;
  const recipient = invoice.recipientSnapshot as RecipientSnapshot;
  const payment = invoice.paymentSnapshot as PaymentSnapshot;
  const template = normalizeInvoiceTemplateSnapshot(invoice.templateSnapshot);
  const label = (key: Parameters<typeof translateInvoiceLabel>[1]) =>
    translateInvoiceLabel(locale, key, template.labelSetVersion);
  // Labels for these exist from label set 2 on; older invoices never show them.
  const issuerIds =
    template.labelSetVersion >= 2
      ? [
          issuer.registrationNumber &&
            `${label("registrationNumber")} ${escapeHtml(issuer.registrationNumber)}`,
          issuer.vatNumber &&
            `${label("vatNumber")} ${escapeHtml(issuer.vatNumber)}`,
        ]
          .filter(Boolean)
          .map((line) => `${line}<br />`)
          .join("\n      ")
      : "";
  const headerText = localizedTemplateText(
    template.headerText,
    template.config.textTranslations?.headerText,
    locale
  );
  const footerText = localizedTemplateText(
    template.footerText,
    template.config.textTranslations?.footerText,
    locale
  );
  const paymentInstructions = localizedTemplateText(
    template.paymentInstructions,
    template.config.textTranslations?.paymentInstructions,
    locale
  );
  const defaultNote = localizedTemplateText(
    template.defaultNote,
    template.config.textTranslations?.defaultNote,
    locale
  );
  // Derived from the exact same fields the payment block already prints
  // below (issuer name, IBAN, BIC) plus the invoice's own snapshotted
  // amount due and invoice number -- never a second, independently
  // editable "QR data" source. tryBuildSepaQrSvg never throws: a
  // non-EUR/zero-due/missing-BIC/malformed-IBAN invoice (including old
  // historical data) simply renders without a QR.
  const qrSvg = tryBuildSepaQrSvg({
    beneficiaryName: issuer.name ?? "",
    iban: payment.iban ?? "",
    bic: payment.bic ?? null,
    currency: invoice.currency,
    amountDue: invoice.amountDue,
    invoiceNumber: invoice.invoiceNumber,
  });

  // No `visible` check here (V1 had one): a row that contributes to the
  // invoice total is never hideable, in the schema and here alike -- see
  // invoice-template-schema.ts's header comment for why. Only the tariff
  // LABEL changes per locale (localizedLineDescription); every financial
  // figure below is rendered identically regardless of locale.
  const lineRows = lines
    .map((line) => {
      const override = template.config.rowOverrides[rowPresentationKey(line)];
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
          <td${cellStyle}>${escapeHtml(localizedLineDescription(line, locale))}</td>
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
    <h1>${label("invoice")} ${escapeHtml(invoice.invoiceNumber)}</h1>
    <p class="meta">${label("issued")} ${escapeHtml(invoice.issueDate)} &middot; ${label("due")} ${escapeHtml(invoice.dueDate)}</p>
    ${headerText ? `<div class="header-text">${escapeMultiline(headerText)}</div>` : ""}
  </div>`;
      case "parties":
        return `
  <div class="parties"${spacing}>
    <div>
      <strong>${escapeHtml(issuer.name)}</strong><br />
      ${issuerIds}
      ${escapeHtml(issuer.addressLine1)}<br />
      ${issuer.addressLine2 ? `${escapeHtml(issuer.addressLine2)}<br />` : ""}
      ${[issuer.postalCode, issuer.city].filter(Boolean).map(escapeHtml).join(" ")}
    </div>
    <div>
      <strong>${escapeHtml(recipient.billingName ?? recipient.occupantName ?? "")}</strong><br />
      ${label("dwelling")} ${escapeHtml(recipient.dwellingNumber)}<br />
      ${recipient.billingAddress ? escapeHtml(recipient.billingAddress) : ""}
    </div>
  </div>`;
      case "line-items":
        return `
  <div${spacing}>
    <table class="invoice-line-items">
      <thead>
        <tr><th>${label("description")}</th><th class="num">${label("quantity")}</th><th class="num">${label("unitPrice")}</th><th class="num">${label("net")}</th><th class="num">${label("vat")}</th><th class="num">${label("gross")}</th></tr>
      </thead>
      <tbody>${lineRows}</tbody>
      <tfoot>
        <tr><td colspan="3"></td><td class="num">${escapeHtml(invoice.subtotal)}</td><td class="num">${escapeHtml(invoice.vatTotal)}</td><td class="num">${escapeHtml(invoice.currentCharges)} ${escapeHtml(invoice.currency)}</td></tr>
      </tfoot>
    </table>
    <table class="summary">
      <tbody>
        <tr><td>${label("currentCharges")}</td><td class="num">${escapeHtml(invoice.currentCharges)} ${escapeHtml(invoice.currency)}</td></tr>
        ${invoice.previousOutstanding !== "0.00" ? `<tr><td>${label("previousOutstanding")}</td><td class="num">+${escapeHtml(invoice.previousOutstanding)} ${escapeHtml(invoice.currency)}</td></tr>` : ""}
        ${invoice.previousCreditApplied !== "0.00" ? `<tr><td>${label("creditApplied")}</td><td class="num">−${escapeHtml(invoice.previousCreditApplied)} ${escapeHtml(invoice.currency)}</td></tr>` : ""}
        ${invoice.lateFeeApplied !== "0.00" ? `<tr><td>${label("lateFee")}</td><td class="num">+${escapeHtml(invoice.lateFeeApplied)} ${escapeHtml(invoice.currency)}</td></tr>` : ""}
        ${invoice.manualAdjustment !== "0.00" ? `<tr><td>${label("manualAdjustment")}</td><td class="num">${escapeHtml(invoice.manualAdjustment)} ${escapeHtml(invoice.currency)}</td></tr>` : ""}
      </tbody>
      <tfoot><tr><td>${label("amountDue")}</td><td class="num">${escapeHtml(invoice.amountDue)} ${escapeHtml(invoice.currency)}</td></tr></tfoot>
    </table>
  </div>`;
      case "payment":
        return `
  <div class="payment"${spacing}>
    <div class="payment-text">
      ${payment.bankName ? `${label("bank")}: ${escapeHtml(payment.bankName)}<br />` : ""}
      ${payment.iban ? `${label("iban")}: ${escapeHtml(payment.iban)}` : ""}
      ${payment.bic ? ` &middot; ${label("bic")}: ${escapeHtml(payment.bic)}` : ""}
      ${paymentInstructions ? `<p>${escapeMultiline(paymentInstructions)}</p>` : ""}
    </div>
    ${
      qrSvg
        ? `<div class="payment-qr">
      ${qrSvg.replace("<svg ", `<svg role="img" aria-label="${escapeHtml(label("scanToPay"))}" `)}
      <p class="qr-caption">${label("scanToPay")}</p>
    </div>`
        : ""
    }
  </div>`;
      case "default-note":
        return defaultNote
          ? `<div class="note"${spacing}>${escapeMultiline(defaultNote)}</div>`
          : "";
      case "footer":
        return footerText
          ? `<div class="footer-text"${spacing}>${escapeMultiline(footerText)}</div>`
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
        const text = pickLocalizedText(
          locale,
          block.text,
          block.textEn,
          block.textRu
        );
        return `<div class="custom-text" style="${style}">${escapeMultiline(text)}</div>`;
      }
    }
  }

  const body = template.config.document.blocks.map(renderBlock).join("");

  return `<!doctype html>
<html lang="${locale}">
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
  .payment { margin-top: 1.5rem; color: #525252; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1.5rem; }
  .payment-text { flex: 1 1 12rem; min-width: 0; }
  .payment-qr { flex: 0 0 auto; text-align: center; }
  .payment-qr svg { display: block; }
  .qr-caption { margin: 4px 0 0; font-size: 10px; color: #737373; }
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
