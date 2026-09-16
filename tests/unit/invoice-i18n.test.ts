import { describe, expect, it } from "vitest";
import {
  INVOICE_LOCALES,
  parseInvoiceLocale,
  pickLocalizedText,
  translateInvoiceLabel,
} from "../../src/domain/billing/invoice-i18n";

describe("translateInvoiceLabel", () => {
  it("returns the correct label for every locale under label set version 1", () => {
    expect(translateInvoiceLabel("lv", "invoice", 1)).toBe("Rēķins");
    expect(translateInvoiceLabel("en", "invoice", 1)).toBe("Invoice");
    expect(translateInvoiceLabel("ru", "invoice", 1)).toBe("Счёт");
  });

  it("falls back to the current label set for an unrecognized version", () => {
    expect(translateInvoiceLabel("en", "amountDue", 999)).toBe("Amount due");
  });

  it("has complete coverage for every locale", () => {
    for (const locale of INVOICE_LOCALES) {
      expect(translateInvoiceLabel(locale, "iban", 1)).toBeTruthy();
    }
  });
});

describe("pickLocalizedText", () => {
  it("returns the Latvian value for the lv locale regardless of translations", () => {
    expect(pickLocalizedText("lv", "Ūdens", "Water", "Вода")).toBe("Ūdens");
  });

  it("returns the translated value when present", () => {
    expect(pickLocalizedText("en", "Ūdens", "Water", "Вода")).toBe("Water");
    expect(pickLocalizedText("ru", "Ūdens", "Water", "Вода")).toBe("Вода");
  });

  it("falls back to Latvian when the translation is missing", () => {
    expect(pickLocalizedText("en", "Ūdens", undefined, undefined)).toBe(
      "Ūdens"
    );
    expect(pickLocalizedText("ru", "Ūdens", null, null)).toBe("Ūdens");
  });

  it("falls back to Latvian when the translation is blank/whitespace", () => {
    expect(pickLocalizedText("en", "Ūdens", "", undefined)).toBe("Ūdens");
    expect(pickLocalizedText("en", "Ūdens", "   ", undefined)).toBe("Ūdens");
  });
});

describe("parseInvoiceLocale", () => {
  it("accepts en and ru", () => {
    expect(parseInvoiceLocale("en")).toBe("en");
    expect(parseInvoiceLocale("ru")).toBe("ru");
  });

  it("falls back to the canonical Latvian locale for anything else", () => {
    expect(parseInvoiceLocale("lv")).toBe("lv");
    expect(parseInvoiceLocale(null)).toBe("lv");
    expect(parseInvoiceLocale(undefined)).toBe("lv");
    expect(parseInvoiceLocale("")).toBe("lv");
    expect(parseInvoiceLocale("fr")).toBe("lv");
    expect(parseInvoiceLocale("EN")).toBe("lv"); // case-sensitive, not normalized
  });
});
