import { describe, expect, it } from "vitest";
import {
  decimalInput,
  normalizeDecimalInput,
} from "../../src/lib/decimal-input";

describe("normalizeDecimalInput", () => {
  it("converts a single comma decimal separator to a dot", () => {
    expect(normalizeDecimalInput("12,34")).toBe("12.34");
    expect(normalizeDecimalInput("0,1234")).toBe("0.1234");
  });

  it("leaves dot-decimal input unchanged", () => {
    expect(normalizeDecimalInput("12.34")).toBe("12.34");
    expect(normalizeDecimalInput("12")).toBe("12");
  });

  it("trims whitespace", () => {
    expect(normalizeDecimalInput(" 12,50 ")).toBe("12.50");
  });

  it("leaves ambiguous/malformed values untouched (for the regex to reject)", () => {
    expect(normalizeDecimalInput("12,3,4")).toBe("12,3,4");
    expect(normalizeDecimalInput("12.3.4")).toBe("12.3.4");
    expect(normalizeDecimalInput("abc")).toBe("abc");
    expect(normalizeDecimalInput("12€")).toBe("12€");
  });

  it("passes through non-string input unchanged", () => {
    expect(normalizeDecimalInput(undefined)).toBeUndefined();
    expect(normalizeDecimalInput(null)).toBeNull();
  });
});

describe("decimalInput", () => {
  const unitPrice = decimalInput(
    /^\d{1,10}(\.\d{1,4})?$/,
    "Enter a valid unit price"
  );

  it("accepts both comma and dot decimal input", () => {
    expect(unitPrice.parse("0.35")).toBe("0.35");
    expect(unitPrice.parse("0,35")).toBe("0.35");
    expect(unitPrice.parse("12,1234")).toBe("12.1234");
  });

  it("still enforces the max-decimal-places constraint after normalizing", () => {
    expect(() => unitPrice.parse("12,12345")).toThrow();
    expect(() => unitPrice.parse("12345678901")).toThrow();
  });

  it("rejects non-numeric and ambiguous input with the given message", () => {
    const result = unitPrice.safeParse("abc");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter a valid unit price");
    }
    expect(unitPrice.safeParse("12,3,4").success).toBe(false);
  });

  it("chains with .optional() and .nullable() like a plain string schema", () => {
    const optional = decimalInput(/^\d+$/, "msg").optional();
    expect(optional.parse(undefined)).toBeUndefined();
    expect(optional.parse("12")).toBe("12");

    const nullable = decimalInput(/^\d+$/, "msg").nullable();
    expect(nullable.parse(null)).toBeNull();
    expect(nullable.parse("12")).toBe("12");
  });
});
