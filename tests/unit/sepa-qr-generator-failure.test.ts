import { describe, expect, it, vi } from "vitest";

// Isolated in its own file so mocking qrcode-generator doesn't affect the
// real-QR-generation tests in sepa-qr.test.ts. Simulates the QR library
// itself throwing (not just an invalid payload) to prove tryBuildSepaQrSvg's
// "never throws" guarantee also covers addData/make/createSvgTag, not just
// buildSepaQrPayload's own validation.
vi.mock("qrcode-generator", () => ({
  default: Object.assign(
    () => ({
      addData: () => {
        throw new Error("qrcode-generator internal failure");
      },
      make: () => {},
      getModuleCount: () => 21,
      createSvgTag: () => "<svg></svg>",
    }),
    {}
  ),
}));

describe("tryBuildSepaQrSvg - qrcode-generator internal failures", () => {
  it("never throws and returns null when the QR library itself throws during generation", async () => {
    const { tryBuildSepaQrSvg } =
      await import("../../src/domain/billing/sepa-qr");
    let result: string | null = "not-yet-called";
    expect(() => {
      result = tryBuildSepaQrSvg({
        beneficiaryName: "Test Org",
        iban: "DE89370400440532013000",
        bic: "DEUTDEFF",
        currency: "EUR",
        amountDue: "10.00",
        invoiceNumber: "INV-1",
      });
    }).not.toThrow();
    expect(result).toBeNull();
  });
});
