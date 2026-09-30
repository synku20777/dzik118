import { describe, expect, it } from "vitest";
import { trimDecimal } from "../../src/lib/decimal-trim";

describe("trimDecimal", () => {
  it("drops trailing zeros and a bare dot", () => {
    expect(trimDecimal("1.0000")).toBe("1");
    expect(trimDecimal("1.000")).toBe("1");
    expect(trimDecimal("2.5000")).toBe("2.5");
    expect(trimDecimal("12.3450")).toBe("12.345");
    expect(trimDecimal("0.0000")).toBe("0");
    expect(trimDecimal("100")).toBe("100");
    expect(trimDecimal("-3.500")).toBe("-3.5");
  });

  it("keeps real precision and never rounds", () => {
    expect(trimDecimal("12.3456")).toBe("12.3456");
    expect(trimDecimal("0.0712")).toBe("0.0712");
    expect(trimDecimal("1.0001")).toBe("1.0001");
  });

  it("keeps a minimum number of decimals", () => {
    expect(trimDecimal("15.0000", 2)).toBe("15.00");
    expect(trimDecimal("15.5000", 2)).toBe("15.50");
    expect(trimDecimal("0.0712", 2)).toBe("0.0712");
    expect(trimDecimal("7", 2)).toBe("7.00");
  });

  it("handles empty and odd input", () => {
    expect(trimDecimal(null)).toBe("");
    expect(trimDecimal(undefined)).toBe("");
    expect(trimDecimal("")).toBe("");
    expect(trimDecimal("n/a")).toBe("n/a");
  });
});
