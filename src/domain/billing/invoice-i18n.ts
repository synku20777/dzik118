// Phase G (Invoices/delivery) - system-generated invoice document labels
// (spec Section 30). Deliberately separate from src/lib/ui/i18n.ts: that
// dictionary is a UI chrome preference ("never changes organization or
// invoice data", per its own header comment) read from a cookie/query
// param, whereas this one drives what actually gets printed on a financial
// document -- it must never depend on the admin's own browser session.
//
// Every dictionary here is versioned and frozen (Object.freeze, not just a
// comment -- protects against an accidental runtime mutation, though not
// against a future source edit; that discipline still has to hold in
// review): once INVOICE_LABELS_V1 is shipped, its wording is never edited
// in place -- fixing a typo means adding INVOICE_LABELS_V2 and bumping
// CURRENT_LABEL_SET_VERSION below, which every new invoice's snapshot pins
// at generation time via `labelSetVersion` (invoice-template-schema.ts).
// Without this, editing a label later would silently change how an old
// invoice's on-demand EN/RU copy renders today, even though every other
// piece of that invoice's content is correctly frozen.
export type InvoiceLocale = "lv" | "en" | "ru";
export const INVOICE_LOCALES: readonly InvoiceLocale[] = ["lv", "en", "ru"];
export const CANONICAL_INVOICE_LOCALE: InvoiceLocale = "lv";

// Bumped only when the *set* of system-generated label strings changes --
// see the file header comment. invoice-template-schema.ts imports this to
// stamp every newly generated invoice's snapshot.
export const CURRENT_LABEL_SET_VERSION = 2;

type InvoiceLabelKeyV1 =
  | "invoice"
  | "invoiceNumber"
  | "issued"
  | "due"
  | "sender"
  | "recipient"
  | "dwelling"
  | "description"
  | "quantity"
  | "unitPrice"
  | "net"
  | "vat"
  | "gross"
  | "currentCharges"
  | "previousOutstanding"
  | "creditApplied"
  | "lateFee"
  | "manualAdjustment"
  | "amountDue"
  | "accountCredit"
  | "paymentDetails"
  | "bank"
  | "iban"
  | "bic"
  | "scanToPay";

// V2 adds the issuer identifiers Latvian invoices must show.
export type InvoiceLabelKey =
  InvoiceLabelKeyV1 | "registrationNumber" | "vatNumber";

type InvoiceLabelDictionaryV1 = Record<InvoiceLabelKeyV1, string>;
type InvoiceLabelDictionary = Record<InvoiceLabelKey, string>;

// Never edit this object's values after it ships -- see header comment.
const INVOICE_LABELS_V1: Record<InvoiceLocale, InvoiceLabelDictionaryV1> = {
  lv: {
    invoice: "Rēķins",
    invoiceNumber: "Rēķina numurs",
    issued: "Izrakstīts",
    due: "Apmaksas termiņš",
    sender: "Izdevējs",
    recipient: "Saņēmējs",
    dwelling: "Īpašums",
    description: "Apraksts",
    quantity: "Daudzums",
    unitPrice: "Cena par vienību",
    net: "Neto",
    vat: "PVN",
    gross: "Kopā",
    currentCharges: "Pašreizējā perioda izmaksas",
    previousOutstanding: "Iepriekšējais parāds",
    creditApplied: "Piemērotais kredīts",
    lateFee: "Kavējuma nauda",
    manualAdjustment: "Manuāla korekcija",
    amountDue: "Apmaksai",
    accountCredit: "Konta kredīts",
    paymentDetails: "Maksājuma dati",
    bank: "Banka",
    iban: "IBAN",
    bic: "BIC",
    scanToPay: "Skenējiet, lai apmaksātu",
  },
  en: {
    invoice: "Invoice",
    invoiceNumber: "Invoice number",
    issued: "Issued",
    due: "Due",
    sender: "Sender",
    recipient: "Recipient",
    dwelling: "Dwelling",
    description: "Description",
    quantity: "Quantity",
    unitPrice: "Unit price",
    net: "Net",
    vat: "VAT",
    gross: "Gross",
    currentCharges: "Current charges",
    previousOutstanding: "Previous outstanding",
    creditApplied: "Credit applied",
    lateFee: "Late fee",
    manualAdjustment: "Manual adjustment",
    amountDue: "Amount due",
    accountCredit: "Account credit",
    paymentDetails: "Payment details",
    bank: "Bank",
    iban: "IBAN",
    bic: "BIC",
    scanToPay: "Scan to pay",
  },
  ru: {
    invoice: "Счёт",
    invoiceNumber: "Номер счёта",
    issued: "Выставлен",
    due: "Срок оплаты",
    sender: "Отправитель",
    recipient: "Получатель",
    dwelling: "Объект",
    description: "Описание",
    quantity: "Количество",
    unitPrice: "Цена за единицу",
    net: "Нетто",
    vat: "НДС",
    gross: "Итого",
    currentCharges: "Начисления за период",
    previousOutstanding: "Предыдущая задолженность",
    creditApplied: "Применённый кредит",
    lateFee: "Пеня",
    manualAdjustment: "Ручная корректировка",
    amountDue: "К оплате",
    accountCredit: "Кредит на счету",
    paymentDetails: "Платёжные реквизиты",
    bank: "Банк",
    iban: "IBAN",
    bic: "BIC",
    scanToPay: "Отсканируйте для оплаты",
  },
} satisfies Record<InvoiceLocale, InvoiceLabelDictionaryV1>;
for (const dictionary of Object.values(INVOICE_LABELS_V1)) {
  Object.freeze(dictionary);
}
Object.freeze(INVOICE_LABELS_V1);

const INVOICE_LABELS_V2: Record<InvoiceLocale, InvoiceLabelDictionary> = {
  lv: {
    ...INVOICE_LABELS_V1.lv,
    registrationNumber: "Reģ. Nr.",
    vatNumber: "PVN reģ. Nr.",
  },
  en: {
    ...INVOICE_LABELS_V1.en,
    registrationNumber: "Reg. No.",
    vatNumber: "VAT No.",
  },
  ru: {
    ...INVOICE_LABELS_V1.ru,
    registrationNumber: "Рег. №",
    vatNumber: "Номер плательщика НДС",
  },
};
for (const dictionary of Object.values(INVOICE_LABELS_V2)) {
  Object.freeze(dictionary);
}
Object.freeze(INVOICE_LABELS_V2);

const LABEL_SETS: Record<
  number,
  Record<InvoiceLocale, Partial<InvoiceLabelDictionary>>
> = {
  1: INVOICE_LABELS_V1,
  2: INVOICE_LABELS_V2,
};

// `labelSetVersion` comes from a frozen invoice snapshot -- an unrecognized
// (e.g. corrupted) version falls back to the CURRENT set (looked up by
// CURRENT_LABEL_SET_VERSION, not hardcoded to V1) rather than throwing,
// consistent with every other lenient read path in this domain. Hardcoding
// the fallback to V1 would go quietly wrong the day a V2 dictionary ships.
export function translateInvoiceLabel(
  locale: InvoiceLocale,
  key: InvoiceLabelKey,
  labelSetVersion: number
): string {
  const set =
    LABEL_SETS[labelSetVersion] ?? LABEL_SETS[CURRENT_LABEL_SET_VERSION];
  return set[locale][key] ?? "";
}

// Single fallback point for every translatable value on an invoice (tariff
// labels, admin-configured template text): a missing or blank EN/RU value
// always falls back to the Latvian canonical value, never to blank content.
export function pickLocalizedText(
  locale: InvoiceLocale,
  lv: string,
  en: string | null | undefined,
  ru: string | null | undefined
): string {
  if (locale === "en" && en && en.trim()) return en;
  if (locale === "ru" && ru && ru.trim()) return ru;
  return lv;
}

// Shared by every invoice-viewing surface (admin, resident portal, public
// token page) and their PDF routes -- a `?locale=` query param is the only
// place a document-language choice comes from, and it's always this
// lenient: an absent/unrecognized value is the canonical Latvian document,
// never an error. This is a *document language* choice, unrelated to the
// viewer's own UI chrome language (src/lib/ui/i18n.ts's separate Locale).
export function parseInvoiceLocale(
  raw: string | null | undefined
): InvoiceLocale {
  return raw === "en" || raw === "ru" ? raw : CANONICAL_INVOICE_LOCALE;
}
