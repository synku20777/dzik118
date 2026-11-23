import { describe, expect, it } from "vitest";
import { createDefaultInvoiceTemplateConfig } from "../../src/domain/billing/invoice-template-schema";
import {
  missingTranslationCount,
  textBlockName,
} from "../../src/lib/ui/invoice-template-translations";

// The mandatory sections only: the default layout also has a note and a
// footer, which a test adds back when it needs them.
const texts = () => {
  const config = createDefaultInvoiceTemplateConfig();
  config.document.blocks = config.document.blocks.filter(
    (b) => b.type !== "default-note" && b.type !== "footer"
  );
  return {
    headerText: "Rēķins",
    footerText: "Paldies",
    paymentInstructions: "Maksājiet laikā",
    defaultNote: "Piezīme",
    config,
  };
};

describe("missingTranslationCount", () => {
  it("counts every translatable field of the default layout", () => {
    const t = {
      ...texts(),
      config: createDefaultInvoiceTemplateConfig(),
    };
    // header, payment instructions, note and footer
    expect(missingTranslationCount(t, "en")).toBe(4);
  });

  it("counts fields with Latvian text and no translation, per language", () => {
    const t = texts();
    t.config.textTranslations = {
      headerText: { en: "Invoice" },
      paymentInstructions: { ru: "Платите вовремя" },
    };
    // The default template has no note or footer section, so only the header
    // and the payment instructions can be missing.
    expect(missingTranslationCount(t, "en")).toBe(1);
    expect(missingTranslationCount(t, "ru")).toBe(1);
  });

  it("ignores fields with no Latvian text and whitespace-only translations count as missing", () => {
    const t = texts();
    t.headerText = "  ";
    t.paymentInstructions = "Maksājiet";
    t.config.textTranslations = { paymentInstructions: { en: "   " } };
    expect(missingTranslationCount(t, "en")).toBe(1);
    t.config.textTranslations = { paymentInstructions: { en: "Pay" } };
    expect(missingTranslationCount(t, "en")).toBe(0);
  });

  it("counts a note or footer only while its section is on the invoice", () => {
    const t = texts();
    t.config.document.blocks.push(
      { id: "note", type: "default-note", visible: true },
      { id: "foot", type: "footer", visible: false }
    );
    // header + payment + the visible note; the hidden footer is not counted
    expect(missingTranslationCount(t, "ru")).toBe(3);
  });

  it("counts visible custom text blocks by their own translation fields", () => {
    const t = texts();
    t.config.document.blocks.push(
      { id: "a", type: "text", visible: true, text: "Sveiki", textEn: "Hi" },
      { id: "b", type: "text", visible: true, text: "Čau" },
      { id: "c", type: "text", visible: false, text: "Slēpts" },
      { id: "d", type: "text", visible: true, text: "" }
    );
    // en: header + payment + block b; ru: header + payment + blocks a and b
    expect(missingTranslationCount(t, "en")).toBe(3);
    expect(missingTranslationCount(t, "ru")).toBe(4);
  });
});

describe("textBlockName", () => {
  it("uses the first line, shortened, or the fallback while empty", () => {
    expect(textBlockName("", "Custom text")).toBe("Custom text");
    expect(textBlockName("  \n ", "Custom text")).toBe("Custom text");
    expect(textBlockName("Paldies!\nOtrā rindiņa", "x")).toBe("Paldies!");
    expect(textBlockName("a".repeat(40), "x")).toBe(`${"a".repeat(31)}…`);
    expect(textBlockName("a".repeat(32), "x")).toBe("a".repeat(32));
  });
});
