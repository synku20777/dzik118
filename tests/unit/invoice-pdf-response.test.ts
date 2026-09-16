import { describe, expect, it } from "vitest";
import {
  invoiceCopyPdfResponse,
  invoicePdfNotReadyResponse,
  invoicePdfResponse,
} from "../../src/lib/storage/invoices";

describe("invoicePdfResponse", () => {
  it("returns 404 without touching storage when no canonical PDF exists yet", async () => {
    // supabaseAdmin is never called on this branch -- `null` stands in for
    // "not needed here" rather than a real client.
    const response = await invoicePdfResponse(null as never, {
      pdfObjectKey: null,
      invoiceNumber: "INV-1",
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("PDF not generated yet");
  });

  it("uses a custom notReadyMessage when provided", async () => {
    const response = await invoicePdfResponse(
      null as never,
      { pdfObjectKey: null, invoiceNumber: "INV-1" },
      { notReadyMessage: "PDF not available yet" }
    );
    expect(await response.text()).toBe("PDF not available yet");
  });
});

describe("invoicePdfNotReadyResponse", () => {
  it("returns a 404 with a default message", async () => {
    const response = invoicePdfNotReadyResponse();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("PDF not generated yet");
  });

  it("accepts a custom message (e.g. the public token route's wording)", async () => {
    const response = invoicePdfNotReadyResponse("PDF not available yet");
    expect(await response.text()).toBe("PDF not available yet");
  });
});

describe("invoiceCopyPdfResponse", () => {
  it("returns the PDF bytes with the correct content type and a locale-suffixed filename", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const response = invoiceCopyPdfResponse(bytes, "INV-202601-00001", "en");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain(
      "INV-202601-00001-en.pdf"
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("gives the Russian copy a distinct filename from the English one, and from the canonical LV file", () => {
    const bytes = new Uint8Array([1]);
    const en = invoiceCopyPdfResponse(bytes, "INV-1", "en");
    const ru = invoiceCopyPdfResponse(bytes, "INV-1", "ru");
    expect(en.headers.get("Content-Disposition")).toContain("INV-1-en.pdf");
    expect(ru.headers.get("Content-Disposition")).toContain("INV-1-ru.pdf");
    // The canonical route (invoicePdfResponse) never adds a suffix -- these
    // copies must never look identical to (or overwrite) that download.
    expect(en.headers.get("Content-Disposition")).not.toContain("INV-1.pdf");
  });

  it("passes through extra headers (e.g. no-cache for the public token route)", () => {
    const response = invoiceCopyPdfResponse(
      new Uint8Array([1]),
      "INV-1",
      "en",
      { "Cache-Control": "private, no-cache, no-store, must-revalidate" }
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-cache, no-store, must-revalidate"
    );
  });

  it("strips CR/LF/quote characters from the invoice number before building the filename", () => {
    const response = invoiceCopyPdfResponse(
      new Uint8Array([1]),
      'INV-1"\r\n',
      "en"
    );
    const disposition = response.headers.get("Content-Disposition")!;
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    // The stray quote is stripped, not escaped -- the filename ends up
    // exactly "INV-1-en.pdf", with no embedded quote breaking the header.
    expect(disposition).toContain('filename="INV-1-en.pdf"');
  });
});
