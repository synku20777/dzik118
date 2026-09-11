import { describe, expect, it } from "vitest";
import { renderInvoiceHtml } from "../../src/domain/billing/invoice-html";

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
