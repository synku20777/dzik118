import { describe, expect, it } from "vitest";
import {
  detectDecimalSeparator,
  foldText,
  parseDate,
  parseDecimal,
  parseDelivery,
} from "../../src/domain/migration/values";

const ok = (value: string) => ({ ok: true, value });

describe("parseDecimal", () => {
  it("reads Latvian and English number styles", () => {
    expect(parseDecimal("1 234,50")).toEqual(ok("1234.50"));
    expect(parseDecimal("1 234,50")).toEqual(ok("1234.50"));
    expect(parseDecimal("1.234,50")).toEqual(ok("1234.50"));
    expect(parseDecimal("1,234.50")).toEqual(ok("1234.50"));
    expect(parseDecimal("45,5")).toEqual(ok("45.5"));
    expect(parseDecimal("45.5")).toEqual(ok("45.5"));
    expect(parseDecimal("1.234.567")).toEqual(ok("1234567"));
    expect(parseDecimal("0,50")).toEqual(ok("0.50"));
  });

  it("reads signs, brackets, currency marks", () => {
    expect(parseDecimal("-12,5")).toEqual(ok("-12.5"));
    expect(parseDecimal("−12,5")).toEqual(ok("-12.5"));
    expect(parseDecimal("12,50-")).toEqual(ok("-12.50"));
    expect(parseDecimal("(12.50)")).toEqual(ok("-12.50"));
    expect(parseDecimal("€ 12,50")).toEqual(ok("12.50"));
    expect(parseDecimal("12.50 EUR")).toEqual(ok("12.50"));
    expect(parseDecimal("-0")).toEqual(ok("0"));
  });

  it("refuses a lone separator with three digits unless the column says which it is", () => {
    expect(parseDecimal("1,234")).toEqual({
      ok: false,
      reason: "ambiguous number",
    });
    expect(parseDecimal("1,234", ",")).toEqual(ok("1.234"));
    expect(parseDecimal("1,234", ".")).toEqual(ok("1234"));
  });

  it("refuses text", () => {
    expect(parseDecimal("abc").ok).toBe(false);
    expect(parseDecimal("").ok).toBe(false);
    expect(parseDecimal("12a").ok).toBe(false);
  });

  it("refuses thousands marks that are not in groups of three", () => {
    expect(parseDecimal("1,2,3").ok).toBe(false);
    expect(parseDecimal("12.34.567").ok).toBe(false);
    expect(parseDecimal("1.2345,50").ok).toBe(false);
    expect(parseDecimal("12,345,678")).toEqual(ok("12345678"));
  });
});

describe("detectDecimalSeparator", () => {
  it("uses the other values of the column", () => {
    expect(detectDecimalSeparator(["45,5", "1,234", "60"])).toBe(",");
    expect(detectDecimalSeparator(["45.5", "1.234"])).toBe(".");
    expect(detectDecimalSeparator(["1,234", "2,345"])).toBeNull();
    expect(detectDecimalSeparator(["1.234,50", "10,5"])).toBe(",");
  });

  it("falls back to the file's delimiter when every value has three decimals", () => {
    const readings = ["123,456", "234,567"];
    expect(detectDecimalSeparator(readings)).toBeNull();
    expect(detectDecimalSeparator(readings, ";")).toBe(",");
    expect(detectDecimalSeparator(["123.456"], ",")).toBe(".");
    expect(detectDecimalSeparator(readings, "\t")).toBeNull();
    // The values win over the delimiter.
    expect(detectDecimalSeparator(["12.5", "1.234"], ";")).toBe(".");
  });
});

describe("parseDate", () => {
  it("reads day-first dates and ISO", () => {
    expect(parseDate("31.10.2026")).toEqual(ok("2026-10-31"));
    expect(parseDate("1.2.2026")).toEqual(ok("2026-02-01"));
    expect(parseDate("01/02/2026")).toEqual(ok("2026-02-01"));
    expect(parseDate("2026-10-31")).toEqual(ok("2026-10-31"));
    expect(parseDate("31.10.2026 14:30")).toEqual(ok("2026-10-31"));
  });

  it("refuses impossible and two-digit-year dates", () => {
    expect(parseDate("31.02.2026").ok).toBe(false);
    expect(parseDate("31.10.26").ok).toBe(false);
    expect(parseDate("tomorrow").ok).toBe(false);
  });
});

describe("parseDelivery", () => {
  it("does not guess a bare Russian 'почта'", () => {
    expect(parseDelivery("почта").ok).toBe(false);
  });

  it("reads delivery words", () => {
    const email = { invoiceByEmail: true, invoiceByPaper: false };
    const paper = { invoiceByEmail: false, invoiceByPaper: true };
    const both = { invoiceByEmail: true, invoiceByPaper: true };
    expect(parseDelivery("e-pasts")).toEqual({ ok: true, value: email });
    expect(parseDelivery("Email")).toEqual({ ok: true, value: email });
    expect(parseDelivery("эл. почта")).toEqual({ ok: true, value: email });
    expect(parseDelivery("pasts")).toEqual({ ok: true, value: paper });
    expect(parseDelivery("Papīrs")).toEqual({ ok: true, value: paper });
    expect(parseDelivery("бумажный")).toEqual({ ok: true, value: paper });
    expect(parseDelivery("почтой")).toEqual({ ok: true, value: paper });
    expect(parseDelivery("e-pasts un papīrs")).toEqual({
      ok: true,
      value: both,
    });
    expect(parseDelivery("abi")).toEqual({ ok: true, value: both });
    expect(parseDelivery("email + paper")).toEqual({ ok: true, value: both });
    expect(parseDelivery("carrier pigeon").ok).toBe(false);
  });
});

describe("foldText", () => {
  it("folds case and diacritics, keeps Cyrillic", () => {
    expect(foldText("Dzīvokļa Nr.")).toBe("dzivokla nr");
    expect(foldText("Площадь, м²")).toBe("площадь м2");
  });
});
