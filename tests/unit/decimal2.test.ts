import { describe, expect, it } from "vitest";
import {
  addExact,
  multiplyAndRound,
  percentOf,
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
});
