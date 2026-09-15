import { describe, expect, it } from "vitest";
import {
  addExact,
  compareExact,
  maxExact,
  minExact,
  multiplyAndRound,
  negateExact,
  percentForDays,
  percentOf,
  subtractExact,
  sumExact,
} from "../../src/lib/decimal2";

describe("decimal2", () => {
  describe("multiplyAndRound (net = ROUND(quantity x unit_price, 2))", () => {
    it("computes an exact product with no rounding needed", () => {
      expect(multiplyAndRound("12.0000", "3.5000", 2)).toBe("42.00");
    });

    it("rounds half up, not to even", () => {
      // 45.5 x 1.25 = 56.875 -> the digit after the 2nd decimal is exactly
      // 5, so round-half-up takes it to 56.88 (round-half-to-even would
      // give 56.88 too here by coincidence; the next case disambiguates).
      expect(multiplyAndRound("45.5000", "1.2500", 2)).toBe("56.88");
    });

    it("rounds an exact .xx5 boundary up, disambiguating from banker's rounding", () => {
      // 1 x 2.345 = 2.345 -> round-half-up gives 2.35; round-half-to-even
      // would give 2.34 (rounding to the nearest even digit).
      expect(multiplyAndRound("1", "2.345", 2)).toBe("2.35");
    });

    it("handles zero quantity", () => {
      expect(multiplyAndRound("0", "10.0000", 2)).toBe("0.00");
    });

    it("handles a FIXED rule (quantity = 1)", () => {
      expect(multiplyAndRound("1", "9.9900", 2)).toBe("9.99");
    });
  });

  describe("percentOf (vat = ROUND(net x vat_rate / 100, 2))", () => {
    it("computes a whole-percent VAT amount", () => {
      expect(percentOf("100.00", "21.0000", 2)).toBe("21.00");
    });

    it("rounds a fractional VAT amount half up", () => {
      // 10.01 x 21% = 2.1021 -> rounds to 2.10.
      expect(percentOf("10.01", "21.0000", 2)).toBe("2.10");
    });

    it("handles a zero VAT rate", () => {
      expect(percentOf("100.00", "0", 2)).toBe("0.00");
    });
  });

  describe("addExact / sumExact (gross = net + vat, invoice totals)", () => {
    it("adds two money amounts exactly", () => {
      expect(addExact("21.00", "100.00")).toBe("121.00");
    });

    it("sums a list of line amounts, including an empty list", () => {
      expect(sumExact(["10.50", "5.25", "0.01"])).toBe("15.76");
      expect(sumExact([])).toBe("0.00");
    });
  });

  describe("negateExact / subtractExact / compareExact / minExact / maxExact (accounts ledger balances)", () => {
    it("negates without ever producing a signed zero", () => {
      expect(negateExact("0.00")).toBe("0.00");
      expect(negateExact("5.00")).toBe("-5.00");
      expect(negateExact("-5.00")).toBe("5.00");
    });

    it("subtracts exactly, including across mismatched scales", () => {
      expect(subtractExact("10.00", "3.50")).toBe("6.50");
      expect(subtractExact("5.00", "5")).toBe("0.00");
      expect(subtractExact("3.00", "10.00")).toBe("-7.00");
    });

    it("compares by sign, not string order", () => {
      expect(compareExact("10.00", "9.00")).toBe(1);
      expect(compareExact("9.00", "10.00")).toBe(-1);
      expect(compareExact("5.00", "5.00")).toBe(0);
      expect(compareExact("-1.00", "0.00")).toBe(-1);
    });

    it("picks the smaller/larger of two amounts", () => {
      expect(minExact("10.00", "-2.00")).toBe("-2.00");
      expect(maxExact("10.00", "-2.00")).toBe("10.00");
      expect(minExact("5.00", "5.00")).toBe("5.00");
    });
  });

  describe("percentForDays (late fee = ROUND(principal x daily% x days / 100, 2))", () => {
    it("accrues a daily percentage over multiple days", () => {
      // 1000.00 principal x 0.05%/day x 10 days = 5.00.
      expect(percentForDays("1000.00", "0.0500", 10, 2)).toBe("5.00");
    });

    it("is zero for zero days", () => {
      expect(percentForDays("1000.00", "0.0500", 0, 2)).toBe("0.00");
    });

    it("rounds half up on the final result", () => {
      // 100.00 x 0.3333%/day x 1 day = 0.3333 -> rounds to 0.33.
      expect(percentForDays("100.00", "0.3333", 1, 2)).toBe("0.33");
    });
  });
});
