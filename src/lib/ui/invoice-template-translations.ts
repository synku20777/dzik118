// Pure helpers for the invoice template editor's language tabs and section
// list (invoice-template-editor.ts), kept here so they can be unit tested
// without a DOM.
import type { InvoiceTemplateConfigV2 } from "../../domain/billing/invoice-template-schema";

export type TranslationLocale = "en" | "ru";

interface TemplateTexts {
  headerText: string;
  footerText: string;
  paymentInstructions: string;
  defaultNote: string;
  config: InvoiceTemplateConfigV2;
}

const filled = (value: string | null | undefined) => !!value?.trim();

// Fields that have Latvian text but no translation in `locale` yet. A field
// whose section is not on the invoice (a hidden or absent note/footer) is not
// counted, and neither is a field with no Latvian text: there is nothing to
// translate. An empty translation is allowed (Latvian is used), so this is
// information for the language tab, never an error.
export function missingTranslationCount(
  texts: TemplateTexts,
  locale: TranslationLocale
): number {
  const translations = texts.config.textTranslations ?? {};
  const onInvoice = (type: string) =>
    texts.config.document.blocks.some((b) => b.type === type && b.visible);
  let missing = 0;
  const check = (lv: string, translated: string | undefined) => {
    if (filled(lv) && !filled(translated)) missing++;
  };
  check(texts.headerText, translations.headerText?.[locale]);
  check(texts.paymentInstructions, translations.paymentInstructions?.[locale]);
  if (onInvoice("default-note")) {
    check(texts.defaultNote, translations.defaultNote?.[locale]);
  }
  if (onInvoice("footer")) {
    check(texts.footerText, translations.footerText?.[locale]);
  }
  for (const block of texts.config.document.blocks) {
    if (block.type !== "text" || !block.visible) continue;
    check(block.text, locale === "en" ? block.textEn : block.textRu);
  }
  return missing;
}

// The name a custom text block shows in the section list: its first line,
// shortened, or the generic name while it is empty.
export function textBlockName(text: string, fallback: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? "";
  if (!firstLine) return fallback;
  return firstLine.length > 32 ? `${firstLine.slice(0, 31)}…` : firstLine;
}
