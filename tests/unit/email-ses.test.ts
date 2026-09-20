import { afterEach, describe, expect, it, vi } from "vitest";
import { createSesEmailService, type SesConfig } from "../../src/lib/email/ses";
import type { SendInvoiceEmailInput } from "../../src/lib/email/service";

describe("SES email service", () => {
  const config: SesConfig = {
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    region: "eu-central-1",
    fromAddress: "invoices@example.com",
  };

  const sampleInput: SendInvoiceEmailInput = {
    to: "resident@example.com",
    organizationName: "Test Org",
    periodLabel: "2026-01",
    invoiceNumber: "INV-202601-00001",
    total: "12.34",
    currency: "EUR",
    dueDate: "2026-02-14",
    viewInvoiceUrl: "https://billing.example.test/invoices/1",
    portalUrl: "https://billing.example.test/portal",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies non-2xx HTTP response from SES as DEFINITIVE failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Bad Request" }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const sesService = createSesEmailService(config);
    const result = await sesService.sendInvoice(sampleInput);

    expect(result).toEqual({
      success: false,
      provider: "ses",
      errorCode: "SES_HTTP_400",
      failureClassification: "DEFINITIVE",
    });
  });

  it("classifies thrown network exception during fetch as AMBIGUOUS failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed: connection reset"))
    );

    const sesService = createSesEmailService(config);
    const result = await sesService.sendInvoice(sampleInput);

    expect(result).toEqual({
      success: false,
      provider: "ses",
      errorCode: "SES_REQUEST_FAILED",
      failureClassification: "AMBIGUOUS",
    });
  });

  it("returns success: true without failureClassification on 200 response with MessageId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ MessageId: "0100018596a798b4-abcd1234-ses" }),
          {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );

    const sesService = createSesEmailService(config);
    const result = await sesService.sendInvoice(sampleInput);

    expect(result).toEqual({
      success: true,
      provider: "ses",
      providerMessageId: "0100018596a798b4-abcd1234-ses",
    });
    expect(result.failureClassification).toBeUndefined();
  });
});
