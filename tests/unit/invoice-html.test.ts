import { describe, expect, it } from "vitest";
import { renderInvoiceHtml } from "../../src/domain/billing/invoice-html";
import {
  createDefaultInvoiceTemplateConfig,
  type InvoiceTemplateConfigV1,
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
  patch: Partial<InvoiceTemplateConfigV1>
): InvoiceTemplateConfigV1 {
  return { ...createDefaultInvoiceTemplateConfig(), ...patch };
}

function snapshot(
  config: InvoiceTemplateConfigV1,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    version: 1,
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
    expect(html.indexOf("Thanks!")).toBeLessThan(
      html.indexOf(">Invoice INV-202601-00001<")
    );
  });

  it("emits nothing for a hidden block", () => {
    const config = withConfig({
      document: {
        blocks: [
          { id: "invoice-meta", type: "meta", visible: true },
          { id: "invoice-parties", type: "parties", visible: false },
          { id: "invoice-line-items", type: "line-items", visible: true },
          { id: "invoice-payment", type: "payment", visible: true },
          { id: "invoice-default-note", type: "default-note", visible: true },
          { id: "invoice-footer", type: "footer", visible: true },
        ],
      },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [makeLine()]
    );
    expect(html).not.toContain('class="parties"');
    expect(html).not.toContain("Jane Doe");
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

  it("hides a row via rowOverrides keyed by the stable code, not the line id", () => {
    const config = withConfig({ rowOverrides: { water: { visible: false } } });
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
    expect(html).not.toContain("Service fee");
    expect(html).toContain("Maintenance");
  });

  it("bolds and spaces a row via rowOverrides", () => {
    const config = withConfig({
      rowOverrides: { water: { bold: true, spacingBefore: 2 } },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [makeLine({ sourceSnapshot: { code: "water" } })]
    );
    expect(html).toContain('style="font-weight: 700;"');
    expect(html).toContain('style="padding-top: 0.75rem;"');
  });

  it("silently ignores a rowOverride for a row key that isn't present on any line", () => {
    const config = withConfig({
      rowOverrides: { "no-such-row": { visible: false } },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [makeLine({ sourceSnapshot: { code: "water" } })]
    );
    expect(html).toContain("Service fee");
  });

  it("falls back to the line id as the row key when sourceSnapshot has no code", () => {
    const config = withConfig({
      rowOverrides: { "line-42": { visible: false } },
    });
    const html = renderInvoiceHtml(
      makeInvoice({ templateSnapshot: snapshot(config) }),
      [makeLine({ id: "line-42", sourceSnapshot: null })]
    );
    expect(html).not.toContain("Service fee");
  });
});
