import { describe, expect, it } from "vitest";
import { compareDecimal3, subtractDecimal3 } from "../../src/lib/decimal3";

describe("decimal3", () => {
  it("subtracts exactly, avoiding float rounding", () => {
    expect(subtractDecimal3("100.100", "99.050")).toBe("1.050");
    expect(subtractDecimal3("1000.000", "999.999")).toBe("0.001");
  });

  it("handles values with fewer than 3 decimal places", () => {
    expect(subtractDecimal3("10.5", "10")).toBe("0.500");
  });

  it("compares exactly", () => {
    expect(compareDecimal3("10.001", "10.000")).toBe(1);
    expect(compareDecimal3("10.000", "10.001")).toBe(-1);
    expect(compareDecimal3("10.000", "10.000")).toBe(0);
  });
});
