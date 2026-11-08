import { describe, expect, it } from "vitest";
import {
  collectionShare,
  formatCollectionShare,
} from "../../src/lib/ui/dashboard-collection";

describe("collection summary", () => {
  it("does not invent a rate for zero or credit totals", () => {
    expect(collectionShare("0.00", "0.00")).toBeNull();
    expect(collectionShare("5.00", "-10.00")).toBeNull();
    expect(formatCollectionShare(null, "en")).toBe("—");
  });
  it("distinguishes tiny, partial and complete payments", () => {
    expect(formatCollectionShare(collectionShare("0.01", "100.00"), "en")).toBe(
      "<1%"
    );
    expect(
      formatCollectionShare(collectionShare("99.99", "100.00"), "en")
    ).toBe("99%");
    expect(
      formatCollectionShare(collectionShare("100.00", "100.00"), "en")
    ).toBe("100%");
    expect(collectionShare("110.00", "100.00")).toBe(1);
  });
  it("does not lose a percentage point to floating-point rounding", () => {
    for (const amount of ["29", "57", "58"]) {
      expect(formatCollectionShare(collectionShare(amount, "100"), "en")).toBe(
        `${amount}%`
      );
    }
  });
});
