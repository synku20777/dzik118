import { describe, expect, it } from "vitest";
import qrcode from "qrcode-generator";
import {
  buildSepaQrPayload,
  tryBuildSepaQrSvg,
  type SepaQrInput,
} from "../../src/domain/billing/sepa-qr";
import { ValidationError } from "../../src/domain/errors";

// DE89 3704 0044 0532 0130 00 -- the canonical ISO/Wikipedia example IBAN,
// a real mod-97-valid checksum (not fabricated for this test).
const VALID_IBAN = "DE89370400440532013000";
const VALID_BIC = "DEUTDEFF";

function baseInput(overrides: Partial<SepaQrInput> = {}): SepaQrInput {
  return {
    beneficiaryName: "Dzīvokļu Apsaimniekošana SIA",
    iban: VALID_IBAN,
    bic: VALID_BIC,
    currency: "EUR",
    amountDue: "123.45",
    invoiceNumber: "INV-202601-00042",
    ...overrides,
  };
}

describe("buildSepaQrPayload", () => {
  it("produces the 12-field EPC069-12 structure in order", () => {
    const payload = buildSepaQrPayload(baseInput());
    const fields = payload.split("\n");
    expect(fields[0]).toBe("BCD");
    expect(fields[1]).toBe("002");
    expect(fields[2]).toBe("1");
    expect(fields[3]).toBe("SCT");
    expect(fields[4]).toBe(VALID_BIC);
    expect(fields[5]).toBe("Dzīvokļu Apsaimniekošana SIA");
    expect(fields[6]).toBe(VALID_IBAN);
    expect(fields[7]).toBe("EUR123.45");
  });

  it("puts the invoice number into the unstructured remittance field, canonically prefixed", () => {
    const payload = buildSepaQrPayload(baseInput());
    const fields = payload.split("\n");
    // The trailing "beneficiary-to-originator info" field (always blank)
    // is trimmed away, so remittance -- the last field this app ever
    // populates -- ends up last in the payload.
    expect(payload).toContain("Rēķins INV-202601-00042");
    expect(fields[fields.length - 1]).toBe("Rēķins INV-202601-00042");
  });

  it("never truncates the invoice number, even when a long one blows the remittance limit", () => {
    const longNumber = "INV-" + "9".repeat(140);
    expect(() =>
      buildSepaQrPayload(baseInput({ invoiceNumber: longNumber }))
    ).toThrow(ValidationError);
  });

  it("handles Unicode Latvian characters in the beneficiary name and remittance", () => {
    const payload = buildSepaQrPayload(
      baseInput({ beneficiaryName: "Sabiedrība „Ābeļziedi" })
    );
    expect(payload).toContain("Sabiedrība „Ābeļziedi");
    expect(payload).toContain("Rēķins");
  });

  it("produces the same payload for the same input (deterministic)", () => {
    const a = buildSepaQrPayload(baseInput());
    const b = buildSepaQrPayload(baseInput());
    expect(a).toBe(b);
  });

  it("stays within the 331-byte UTF-8 payload limit for realistic inputs", () => {
    const payload = buildSepaQrPayload(baseInput());
    expect(new TextEncoder().encode(payload).length).toBeLessThanOrEqual(331);
  });

  it("rejects a non-EUR currency", () => {
    expect(() => buildSepaQrPayload(baseInput({ currency: "USD" }))).toThrow(
      ValidationError
    );
  });

  it("rejects a missing BIC", () => {
    expect(() => buildSepaQrPayload(baseInput({ bic: null }))).toThrow(
      ValidationError
    );
  });

  it("rejects a malformed BIC", () => {
    // The first 6 characters (bank + country code) must be letters --
    // an all-numeric string fails that regardless of length.
    expect(() => buildSepaQrPayload(baseInput({ bic: "12345678" }))).toThrow(
      ValidationError
    );
  });

  it("accepts an 11-character BIC", () => {
    expect(() =>
      buildSepaQrPayload(baseInput({ bic: "DEUTDEFF500" }))
    ).not.toThrow();
  });

  it("rejects an IBAN with a broken checksum", () => {
    const brokenIban = "DE89370400440532013001"; // last digit flipped
    expect(() => buildSepaQrPayload(baseInput({ iban: brokenIban }))).toThrow(
      ValidationError
    );
  });

  it("rejects an IBAN with the wrong length for its country", () => {
    expect(() =>
      buildSepaQrPayload(baseInput({ iban: "DE8937040044053201300" }))
    ).toThrow(ValidationError);
  });

  it("rejects a non-IBAN-shaped value even if it happens to pass the mod-97 checksum", () => {
    // "0001" is 4 alphanumeric characters with a mod-97 remainder of 1 --
    // it must still be rejected because it doesn't start with a 2-letter
    // country code + 2-digit checksum, i.e. it isn't IBAN-shaped at all.
    expect(() => buildSepaQrPayload(baseInput({ iban: "0001" }))).toThrow(
      ValidationError
    );
  });

  it("rejects an IBAN from an unlisted/unrecognized country even if checksum-valid", () => {
    // "ZZ00O" is structurally IBAN-shaped and its mod-97 remainder is 1,
    // but "ZZ" is not a real, listed IBAN country -- an unlisted country
    // must be rejected outright, not skip the length check and pass on
    // checksum alone.
    expect(() => buildSepaQrPayload(baseInput({ iban: "ZZ00O" }))).toThrow(
      ValidationError
    );
  });

  it("rejects a zero amount due", () => {
    expect(() => buildSepaQrPayload(baseInput({ amountDue: "0.00" }))).toThrow(
      ValidationError
    );
  });

  it("rejects an amount with more than 9 integer digits", () => {
    expect(() =>
      buildSepaQrPayload(baseInput({ amountDue: "1234567890.12" }))
    ).toThrow(ValidationError);
  });

  it("accepts the maximum representable amount", () => {
    expect(() =>
      buildSepaQrPayload(baseInput({ amountDue: "999999999.99" }))
    ).not.toThrow();
  });

  it("rejects a beneficiary name containing control characters", () => {
    expect(() =>
      buildSepaQrPayload(baseInput({ beneficiaryName: "Test\nOrg" }))
    ).toThrow(ValidationError);
  });

  it("rejects control characters beyond CR/LF/NUL (tab, vertical tab, C1 range)", () => {
    expect(() =>
      buildSepaQrPayload(baseInput({ beneficiaryName: "Test\tOrg" }))
    ).toThrow(ValidationError);
    expect(() =>
      buildSepaQrPayload(baseInput({ beneficiaryName: "Test\x0bOrg" }))
    ).toThrow(ValidationError);
    expect(() =>
      buildSepaQrPayload(baseInput({ beneficiaryName: "Test\x85Org" }))
    ).toThrow(ValidationError);
  });

  it("rejects an empty beneficiary name", () => {
    expect(() =>
      buildSepaQrPayload(baseInput({ beneficiaryName: "   " }))
    ).toThrow(ValidationError);
  });

  it("accepts a 70-character beneficiary name at the exact EPC limit", () => {
    const name70 = "A".repeat(70);
    expect(
      buildSepaQrPayload(baseInput({ beneficiaryName: name70 }))
    ).toContain(name70);
  });

  it("rejects (never truncates) a beneficiary name over 70 characters", () => {
    const name71 = "A".repeat(71);
    expect(() =>
      buildSepaQrPayload(baseInput({ beneficiaryName: name71 }))
    ).toThrow(ValidationError);
  });

  it("stays within the 331-byte payload limit even with a maximal, all-diacritic beneficiary name", () => {
    const worstCaseName = "ē".repeat(70); // 2 UTF-8 bytes per character
    const payload = buildSepaQrPayload(
      baseInput({ beneficiaryName: worstCaseName })
    );
    expect(new TextEncoder().encode(payload).length).toBeLessThanOrEqual(331);
  });
});

describe("QR byte encoding", () => {
  it("configures the qrcode-generator library to encode UTF-8, not raw UTF-16 low bytes", () => {
    // Importing sepa-qr.ts applies this override as a module-load side
    // effect (it's the only place that can touch the library's global
    // config) -- verify it actually took effect, since the library's own
    // default would silently corrupt every Latvian diacritic in the QR's
    // bit stream despite the payload declaring UTF-8 (EPC069-12 field 3).
    const bytes = qrcode.stringToBytes("ē");
    expect(bytes).toEqual(Array.from(new TextEncoder().encode("ē")));
    // The library's original behavior (charCode & 0xff) would have
    // produced a single truncated byte here instead of two real UTF-8
    // bytes -- assert the fix, not just "some array came back".
    expect(bytes.length).toBe(2);
  });
});

describe("tryBuildSepaQrSvg", () => {
  it("returns a printable inline SVG for valid input", () => {
    const svg = tryBuildSepaQrSvg(baseInput());
    expect(svg).not.toBeNull();
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="30mm"');
    expect(svg).toContain('height="30mm"');
  });

  it("emits exactly one width and one height attribute on the root <svg> tag (no library-generated pixel dimensions left over)", () => {
    const svg = tryBuildSepaQrSvg(baseInput())!;
    // Only the opening <svg ...> tag itself -- the QR's own background
    // <rect width="100%" height="100%" .../> legitimately has its own,
    // unrelated width/height and isn't what this test is about.
    const openingTag = svg.slice(0, svg.indexOf(">") + 1);
    expect((openingTag.match(/\bwidth="/g) ?? []).length).toBe(1);
    expect((openingTag.match(/\bheight="/g) ?? []).length).toBe(1);
  });

  it("never throws and returns null for a zero-due invoice", () => {
    expect(tryBuildSepaQrSvg(baseInput({ amountDue: "0.00" }))).toBeNull();
  });

  it("never throws and returns null for a non-EUR invoice", () => {
    expect(tryBuildSepaQrSvg(baseInput({ currency: "USD" }))).toBeNull();
  });

  it("never throws and returns null when the BIC is missing", () => {
    expect(tryBuildSepaQrSvg(baseInput({ bic: null }))).toBeNull();
  });

  it("never throws and returns null for a malformed historical IBAN", () => {
    expect(tryBuildSepaQrSvg(baseInput({ iban: "not-an-iban" }))).toBeNull();
  });

  it("produces the same SVG for the same input (deterministic)", () => {
    const a = tryBuildSepaQrSvg(baseInput());
    const b = tryBuildSepaQrSvg(baseInput());
    expect(a).toBe(b);
  });
});
