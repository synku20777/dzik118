import { describe, expect, it } from "vitest";
import { renderInvoiceHtml } from "../../src/domain/billing/invoice-html";
import {
  createDefaultInvoiceTemplateConfig,
  type InvoiceTemplateConfigV2,
} from "../../src/domain/billing/invoice-template-schema";

function makeInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    invoiceNumber: "INV-202601-00001",
    issueDate: "2026-01-28",
    dueDate: "2026-02-14",
    currency: "EUR",
    subtotal: "10.00",
    vatTotal: "2.10",
    total: "12.10",
    issuerSnapshot: { name: "Demo Org", addressLine1: "1 Main St" },
    recipientSnapshot: { dwellingNumber: "5", billingName: "Jane Doe" },
    paymentSnapshot: { bankName: "Test Bank", iban: "LV00TEST" },
    templateSnapshot: {},
    ...overrides,
  } as never;
}

function makeLine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "line-1",
    description: "Service fee",
    quantity: "1",
    unit: "month",
    unitPrice: "10.00",
    netAmount: "10.00",
    vatAmount: "2.10",
    grossAmount: "12.10",
    sourceSnapshot: null,
    ...overrides,
  } as never;
}

function withConfig(
  patch: Partial<InvoiceTemplateConfigV2>
): InvoiceTemplateConfigV2 {
  return { ...createDefaultInvoiceTemplateConfig(), ...patch };
}

function snapshot(
  config: InvoiceTemplateConfigV2,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    version: 2,
    headerText: null,
    footerText: null,
    paymentInstructions: null,
    defaultNote: null,
    config,
    ...overrides,
  };
}

describe("renderInvoiceHtml", () => {
  it("includes the invoice number, line items, and totals", () => {
    const html = renderInvoiceHtml(makeInvoice(), [
      {
        description: "Service fee",
        quantity: "1",
        unit: "month",
        unitPrice: "10.00",
        netAmount: "10.00",
        vatAmount: "2.10",
        grossAmount: "12.10",
      } as never,
    ]);
    expect(html).toContain("INV-202601-00001");
    expect(html).toContain("Service fee");
    expect(html).toContain("12.10");
  });

  it("shows the issuer registration and VAT numbers, labelled per document language, only from label set 2", () => {
    const issuerSnapshot = {
      name: "Demo Org",
      addressLine1: "1 Main St",
      registrationNumber: "40003<1>",
      vatNumber: "LV40003",
    };
    const v2 = makeInvoice({
      issuerSnapshot,
      templateSnapshot: snapshot(createDefaultInvoiceTemplateConfig(), {
        labelSetVersion: 2,
      }),
    });
    const html = renderInvoiceHtml(v2, []);
    expect(html).toContain("Reģ. Nr. 40003&lt;1&gt;");
    expect(html).toContain("PVN reģ. Nr. LV40003");
    expect(renderInvoiceHtml(v2, [], "en")).toContain("VAT No. LV40003");
    // A frozen snapshot with no stamp at all is label set 1: never shown.
    expect(
      renderInvoiceHtml(makeInvoice({ issuerSnapshot }), [])
    ).not.toContain("40003");
    const v1 = renderInvoiceHtml(
      makeInvoice({
        issuerSnapshot,
        templateSnapshot: snapshot(createDefaultInvoiceTemplateConfig(), {
          labelSetVersion: 1,
        }),
      }),
      []
    );
    expect(v1).not.toContain("40003");
  });

  it("escapes HTML in every snapshot field to prevent injection into the rendered document", () => {
    const html = renderInvoiceHtml(
      makeInvoice({
        recipientSnapshot: {
          dwellingNumber: "5",
          billingName: "<script>alert(1)</script>",
        },
      }),
      [
        {
          description: '"><img src=x onerror=alert(1)>',
          quantity: "1",
          unit: "month",
          unitPrice: "10.00",
          netAmount: "10.00",
          vatAmount: "2.10",
          grossAmount: "12.10",
        } as never,
      ]
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;&gt;");
  });

  it("escapes single quotes to prevent attribute breakout", () => {
    const html = renderInvoiceHtml(
      makeInvoice({
        recipientSnapshot: {
          dwellingNumber: "5",
          billingName: "O'Connor' onmouseover='alert(1)",
        },
      }),
      []
    );
    expect(html).not.toContain("' onmouseover=");
    expect(html).toContain("O&#39;Connor&#39;");
  });

  it("never emits a remote resource reference (no external img/link/script tags)", () => {
    const html = renderInvoiceHtml(makeInvoice(), []);
    expect(html).not.toMatch(/<(img|link|script)\b[^>]*\shttps?:\/\//i);
  });
});

describe("renderInvoiceHtml - block-based template config", () => {
  it("renders an invoice with no snapshot through the legacy default layout, not a passed-in config", () => {
    const html = renderInvoiceHtml(makeInvoice({ templateSnapshot: null }), [
      makeLine(),
    ]);
    expect(html).toContain("Service fee");
    expect(html).toContain('class="invoice-line-items"');
  });

  it("falls back to the legacy layout for an unparseable/pre-feature snapshot", () => {
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: { someOldShape: true } }),
      [makeLine()]
    );
    expect(html).toContain("Service fee");
  });

  it("falls back to the legacy layout for a snapshot that claims version 1 but fails full schema validation, instead of trusting it", () => {
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(null as never) }),
      [makeLine()]
    );
    expect(html).toContain("Service fee");
  });

  it("falls back to the legacy layout for a snapshot whose header text exceeds the write-path length cap", () => {
    const html = renderInvoiceHtml(
      makeInvoice({
        templateSnapshot: snapshot(createDefaultInvoiceTemplateConfig(), {
          headerText: "x".repeat(501),
        }),
      }),
      [makeLine()]
    );
    expect(html).toContain("Service fee");
    expect(html).not.toContain("x".repeat(501));
  });

  it("never lets a corrupted snapshot's custom-block align value break out of the style attribute", () => {
    const html = renderInvoiceHtml(
      makeInvoice({
        templateSnapshot: snapshot({
          version: 1,
          document: {
            blocks: [
              {
                id: "custom-1",
                type: "text",
                visible: true,
                text: "x",
                align: 'left" onmouseover="alert(1)',
              },
            ],
          },
          rowOverrides: {},
        } as never),
      }),
      [makeLine()]
    );
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("Service fee");
  });

  it("renders blocks in the configured order", () => {
    const config = withConfig({
      document: {
        blocks: [
          { id: "invoice-footer", type: "footer", visible: true },
          { id: "invoice-meta", type: "meta", visible: true },
          { id: "invoice-parties", type: "parties", visible: true },
          { id: "invoice-line-items", type: "line-items", visible: true },
          { id: "invoice-payment", type: "payment", visible: true },
          { id: "invoice-default-note", type: "default-note", visible: true },
        ],
      },
    });
    const html = renderInvoiceHtml(
      makeInvoice({
        templateSnapshot: snapshot(config, { footerText: "Thanks!" }),
      }),
      []
    );
    // Label text is locale-dependent (LV by default: "Rēķins", not
    // "Invoice") -- assert on the invoice number itself, which isn't. It
    // appears twice (the <title> tag, then the meta block's <h1>); the
    // meta block's position (the later occurrence) is what "renders in
    // configured order" is actually testing.
    expect(html.indexOf("Thanks!")).toBeLessThan(
      html.lastIndexOf("INV-202601-00001")
    );
  });

  it("emits nothing for a hidden optional block", () => {
    // `footer` is genuinely optional (unlike meta/parties/line-items/
    // payment, which are mandatory and cannot be hidden -- see the
    // "mandatory blocks" describe block below).
    const config = withConfig({
      document: {
        blocks: createDefaultInvoiceTemplateConfig().document.blocks.map((b) =>
          b.type === "footer" ? { ...b, visible: false } : b
        ),
      },
    });
    const html = renderInvoiceHtml(
      makeInvoice({
        templateSnapshot: snapshot(config, {
          footerText: "See you next month",
        }),
      }),
      [makeLine()]
    );
    expect(html).not.toContain("See you next month");
  });

  it("renders a custom text block, escaped, with line breaks preserved", () => {
    const config = withConfig({
      document: {
        blocks: [
          ...createDefaultInvoiceTemplateConfig().document.blocks,
          {
            id: "custom-1",
            type: "text",
            visible: true,
            text: "Line one\nLine <two>",
            emphasis: "bold",
            align: "center",
          },
        ],
      },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      []
    );
    expect(html).toContain("Line one<br />Line &lt;two&gt;");
    expect(html).toContain("font-weight: 700;");
    expect(html).toContain("text-align: center;");
  });

  it("bolds and spaces a row via rowOverrides keyed by the stable code, not the line id", () => {
    const config = withConfig({
      rowOverrides: { water: { bold: true, spacingBefore: 2 } },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [
        makeLine({ id: "line-1", sourceSnapshot: { code: "water" } }),
        makeLine({
          id: "line-2",
          description: "Maintenance",
          sourceSnapshot: { code: "maintenance" },
        }),
      ]
    );
    expect(html).toContain('style="font-weight: 700;"');
    expect(html).toContain("Maintenance");
    // The override only bolds/spaces the "water" row -- it never removes
    // any row. Both lines' descriptions are still present.
    expect(html).toContain("Service fee");
  });

  it("falls back to the line id as the row key when sourceSnapshot has no code", () => {
    const config = withConfig({
      rowOverrides: { "line-42": { bold: true } },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [makeLine({ id: "line-42", sourceSnapshot: null })]
    );
    expect(html).toContain("Service fee");
    expect(html).toContain('style="font-weight: 700;"');
  });

  it("silently ignores a rowOverride for a row key that isn't present on any line", () => {
    const config = withConfig({
      rowOverrides: { "no-such-row": { bold: true } },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [makeLine({ sourceSnapshot: { code: "water" } })]
    );
    expect(html).toContain("Service fee");
    expect(html).not.toContain('style="font-weight: 700;"');
  });
});

describe("renderInvoiceHtml - a financially charged row can never disappear", () => {
  it("still renders a row whose stored override carries an obsolete `visible: false` flag", () => {
    // `visible` was removed from the row-override schema (spec requirement
    // B): a stored config from before that change, or a hand-edited one,
    // must never hide a row that contributes to the invoice total.
    const config = withConfig({
      rowOverrides: { water: { visible: false } as never },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [makeLine({ sourceSnapshot: { code: "water" } })]
    );
    expect(html).toContain("Service fee");
  });

  it("still renders every row even when a frozen historical snapshot's config used the old V1 shape with hidden rows", () => {
    const v1Config = {
      version: 1,
      document: createDefaultInvoiceTemplateConfig().document,
      rowOverrides: { water: { visible: false, bold: true } },
    };
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(v1Config as never) }),
      [makeLine({ sourceSnapshot: { code: "water" } })]
    );
    expect(html).toContain("Service fee");
    expect(html).toContain('style="font-weight: 700;"');
  });
});

describe("renderInvoiceHtml - mandatory blocks cannot be hidden", () => {
  it("still renders the payment section even if a stored config marks it hidden", () => {
    const config = withConfig({
      document: {
        blocks: createDefaultInvoiceTemplateConfig().document.blocks.map((b) =>
          b.type === "payment" ? { ...b, visible: false } : b
        ),
      },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      []
    );
    expect(html).toContain('class="payment"');
  });

  it("still renders the charges table even if a stored config omits the line-items block entirely", () => {
    const config = withConfig({
      document: {
        blocks: createDefaultInvoiceTemplateConfig().document.blocks.filter(
          (b) => b.type !== "line-items"
        ),
      },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [makeLine()]
    );
    expect(html).toContain('class="invoice-line-items"');
    expect(html).toContain("Service fee");
  });
});

describe("renderInvoiceHtml - locale", () => {
  it("defaults to Latvian when no locale is given, matching every existing caller's behavior", () => {
    const html = renderInvoiceHtml(makeInvoice(), [makeLine()]);
    expect(html).toContain('<html lang="lv">');
    expect(html).toContain("Rēķins");
    expect(html).toContain("Apmaksai");
  });

  it("renders English labels when locale is en", () => {
    const html = renderInvoiceHtml(makeInvoice(), [makeLine()], "en");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Invoice");
    expect(html).toContain("Amount due");
  });

  it("renders Russian labels when locale is ru", () => {
    const html = renderInvoiceHtml(makeInvoice(), [makeLine()], "ru");
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain("Счёт");
  });

  it("uses a tariff's translated label when present, falling back to the Latvian canonical name otherwise", () => {
    const lines = [
      makeLine({
        description: "Ūdens",
        sourceSnapshot: { code: "water", nameEn: "Water", nameRu: "Вода" },
      }),
      makeLine({
        id: "line-2",
        description: "Atkritumi",
        sourceSnapshot: { code: "waste" }, // no translation yet
      }),
    ];
    const en = renderInvoiceHtml(makeInvoice(), lines, "en");
    expect(en).toContain("Water");
    expect(en).not.toContain("Ūdens");
    // Missing EN translation falls back to the Latvian canonical name, not
    // blank content.
    expect(en).toContain("Atkritumi");

    const ru = renderInvoiceHtml(makeInvoice(), lines, "ru");
    expect(ru).toContain("Вода");
    expect(ru).toContain("Atkritumi");
  });

  it("uses translated template text when present, falling back to Latvian otherwise", () => {
    const config = withConfig({
      textTranslations: {
        headerText: { en: "Welcome", ru: "Добро пожаловать" },
      },
    });
    const snap = snapshot(config, { headerText: "Sveicināti" });
    const lv = renderInvoiceHtml(makeInvoice({ templateSnapshot: snap }), []);
    const en = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snap }),
      [],
      "en"
    );
    const ru = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snap }),
      [],
      "ru"
    );
    expect(lv).toContain("Sveicināti");
    expect(en).toContain("Welcome");
    expect(ru).toContain("Добро пожаловать");
  });

  it("falls back to Latvian template text when a translation is missing", () => {
    const config = withConfig({ textTranslations: {} });
    const snap = snapshot(config, { headerText: "Tikai latviski" });
    const en = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snap }),
      [],
      "en"
    );
    expect(en).toContain("Tikai latviski");
  });

  it("still shows a translation even when the Latvian value is blank (a real translation must never be hidden)", () => {
    const config = withConfig({
      textTranslations: { headerText: { en: "Welcome" } },
    });
    const snap = snapshot(config, { headerText: null });
    const en = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snap }),
      [],
      "en"
    );
    expect(en).toContain("Welcome");
  });

  it("uses a custom text block's translation, falling back to its Latvian text", () => {
    const config = withConfig({
      document: {
        blocks: [
          ...createDefaultInvoiceTemplateConfig().document.blocks,
          {
            id: "custom-1",
            type: "text",
            visible: true,
            text: "Paldies",
            textEn: "Thank you",
          },
        ],
      },
    });
    const snap = snapshot(config);
    const en = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snap }),
      [],
      "en"
    );
    expect(en).toContain("Thank you");
    const ru = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snap }),
      [],
      "ru"
    );
    // No Russian translation was set -- falls back to the Latvian text.
    expect(ru).toContain("Paldies");
  });

  it("never changes any financial figure, line count, or invoice number across locales", () => {
    const invoice = makeInvoice({
      subtotal: "123.45",
      vatTotal: "25.92",
      currentCharges: "149.37",
      amountDue: "149.37",
    });
    const lines = [
      makeLine({ sourceSnapshot: { code: "water", nameEn: "Water" } }),
      makeLine({ id: "line-2", description: "Second charge" }),
    ];
    const lv = renderInvoiceHtml(invoice, lines);
    const en = renderInvoiceHtml(invoice, lines, "en");
    const ru = renderInvoiceHtml(invoice, lines, "ru");
    for (const html of [lv, en, ru]) {
      expect(html).toContain("INV-202601-00001");
      expect(html).toContain("123.45");
      expect(html).toContain("25.92");
      expect(html).toContain("149.37");
      expect((html.match(/<tr/g) ?? []).length).toBe(
        (lv.match(/<tr/g) ?? []).length
      );
    }
  });
});

describe("SEPA QR in the payment block", () => {
  const validPaymentInvoice = () =>
    makeInvoice({
      invoiceNumber: "INV-202601-00099",
      currency: "EUR",
      amountDue: "88.10",
      issuerSnapshot: { name: "Demo Org", addressLine1: "1 Main St" },
      paymentSnapshot: {
        bankName: "Test Bank",
        iban: "DE89370400440532013000",
        bic: "DEUTDEFF",
      },
    });

  // Matches the actual rendered element, not the (always-present, static)
  // ".payment-qr" CSS rule in the document's inline <style> block.
  const QR_ELEMENT = 'class="payment-qr"';

  it("embeds a QR code alongside the human-readable payment text when the payment data is valid", () => {
    const html = renderInvoiceHtml(validPaymentInvoice(), []);
    expect(html).toContain(QR_ELEMENT);
    expect(html).toContain("<svg");
    expect(html).toContain("IBAN");
    expect(html).toContain("DE89370400440532013000");
  });

  it("omits the QR (but keeps the printed IBAN/BIC) when the org has no BIC on file", () => {
    const invoice = validPaymentInvoice();
    (invoice as { paymentSnapshot: Record<string, unknown> }).paymentSnapshot =
      { bankName: "Test Bank", iban: "DE89370400440532013000", bic: null };
    const html = renderInvoiceHtml(invoice, []);
    expect(html).not.toContain(QR_ELEMENT);
    expect(html).toContain("DE89370400440532013000");
  });

  it("omits the QR for a non-EUR invoice without throwing", () => {
    const invoice = validPaymentInvoice();
    (invoice as { currency: string }).currency = "USD";
    expect(() => renderInvoiceHtml(invoice, [])).not.toThrow();
    expect(renderInvoiceHtml(invoice, [])).not.toContain(QR_ELEMENT);
  });

  it("omits the QR for a zero-due invoice without throwing", () => {
    const invoice = validPaymentInvoice();
    (invoice as { amountDue: string }).amountDue = "0.00";
    expect(() => renderInvoiceHtml(invoice, [])).not.toThrow();
    expect(renderInvoiceHtml(invoice, [])).not.toContain(QR_ELEMENT);
  });

  it("omits the QR for a malformed historical IBAN without throwing", () => {
    const invoice = validPaymentInvoice();
    (invoice as { paymentSnapshot: Record<string, unknown> }).paymentSnapshot =
      { bankName: "Test Bank", iban: "not-an-iban", bic: "DEUTDEFF" };
    expect(() => renderInvoiceHtml(invoice, [])).not.toThrow();
    expect(renderInvoiceHtml(invoice, [])).not.toContain(QR_ELEMENT);
  });

  it("renders an accessible caption and label next to the QR", () => {
    const html = renderInvoiceHtml(validPaymentInvoice(), []);
    expect(html).toContain("qr-caption");
    expect(html).toContain('role="img"');
  });

  it("keeps the QR presence identical across locales (same underlying payment snapshot)", () => {
    const invoice = validPaymentInvoice();
    const lv = renderInvoiceHtml(invoice, []);
    const en = renderInvoiceHtml(invoice, [], "en");
    const ru = renderInvoiceHtml(invoice, [], "ru");
    for (const html of [lv, en, ru]) {
      expect(html).toContain(QR_ELEMENT);
    }
  });
});
