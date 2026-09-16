import { describe, expect, it } from "vitest";
import {
  buildPreviewLines,
  buildPreviewTotals,
  previewPeriodDateRange,
  resolvePreviewPeriod,
} from "../../src/domain/billing/invoice-template-preview";

function makeRule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rule-1",
    code: "fee",
    name: "Service fee",
    unit: "month",
    unitPrice: "10.00",
    vatRate: "21.0000",
    ...overrides,
  } as never;
}

describe("buildPreviewLines", () => {
  it("builds one illustrative line per effective rule, keyed by the rule's stable code", () => {
    const lines = buildPreviewLines([makeRule()]);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe("Service fee");
    expect(lines[0].sourceSnapshot).toEqual({ code: "fee" });
  });

  it("carries a rule's translated labels into sourceSnapshot, so the editor's own locale switch can localize the preview", () => {
    const [line] = buildPreviewLines([
      makeRule({ nameEn: "Service fee (EN)", nameRu: "Плата за обслуживание" }),
    ]);
    expect(line.sourceSnapshot).toEqual({
      code: "fee",
      nameEn: "Service fee (EN)",
      nameRu: "Плата за обслуживание",
    });
  });

  it("computes net/vat/gross with the same rounding primitives generation.ts uses, not a duplicated formula", () => {
    const [line] = buildPreviewLines([
      makeRule({ unitPrice: "12.3456", vatRate: "21.0000" }),
    ]);
    // quantity is always the "1" placeholder -- net = 1 x unitPrice rounded.
    expect(line.netAmount).toBe("12.35");
    expect(line.vatAmount).toBe("2.59");
    expect(line.grossAmount).toBe("14.94");
  });

  it("treats a null unitPrice (e.g. a MANUAL_AMOUNT rule) as zero rather than crashing", () => {
    const [line] = buildPreviewLines([makeRule({ unitPrice: null })]);
    expect(line.netAmount).toBe("0.00");
    expect(line.vatAmount).toBe("0.00");
    expect(line.grossAmount).toBe("0.00");
  });

  it("returns an empty array for an organization with no effective rules", () => {
    expect(buildPreviewLines([])).toEqual([]);
  });

  it("produces a distinct row per rule, in the order the rules were given", () => {
    const lines = buildPreviewLines([
      makeRule({ id: "r1", code: "water", name: "Water" }),
      makeRule({ id: "r2", code: "waste", name: "Waste" }),
    ]);
    expect(lines.map((l) => l.description)).toEqual(["Water", "Waste"]);
  });
});

describe("buildPreviewTotals", () => {
  it("sums net/vat and derives current charges from the preview lines", () => {
    const lines = buildPreviewLines([
      makeRule({ id: "r1", code: "a", unitPrice: "10.00", vatRate: "21.0000" }),
      makeRule({ id: "r2", code: "b", unitPrice: "5.00", vatRate: "21.0000" }),
    ]);
    const totals = buildPreviewTotals(lines);
    expect(totals.subtotal).toBe("15.00");
    expect(totals.vatTotal).toBe("3.15");
    expect(totals.currentCharges).toBe("18.15");
  });

  it("returns zero totals for no lines", () => {
    expect(buildPreviewTotals([])).toEqual({
      subtotal: "0.00",
      vatTotal: "0.00",
      currentCharges: "0.00",
    });
  });
});

function makePeriod(
  id: string,
  startsOn = "2026-01-01",
  endsOn = "2026-01-31"
) {
  return { id, startsOn, endsOn };
}

describe("resolvePreviewPeriod", () => {
  it("prefers an explicitly requested period over the current open one", () => {
    const requested = makePeriod("requested");
    const open = makePeriod("open");
    const result = resolvePreviewPeriod({
      periods: [open, requested],
      requestedPeriodId: "requested",
      currentOpenPeriod: open,
    });
    expect(result).toBe(requested);
  });

  it("ignores a requested id that isn't one of the organization's periods", () => {
    const open = makePeriod("open");
    const result = resolvePreviewPeriod({
      periods: [open],
      requestedPeriodId: "does-not-exist",
      currentOpenPeriod: open,
    });
    expect(result).toBe(open);
  });

  it("falls back to the current open period when nothing is requested", () => {
    const open = makePeriod("open");
    const other = makePeriod("other");
    const result = resolvePreviewPeriod({
      periods: [other, open],
      requestedPeriodId: null,
      currentOpenPeriod: open,
    });
    expect(result).toBe(open);
  });

  it("falls back to the most recent period (by startsOn) when none is open, regardless of array order", () => {
    const mostRecent = makePeriod("most-recent", "2026-03-01", "2026-03-31");
    const older = makePeriod("older", "2026-01-01", "2026-01-31");
    // Deliberately unsorted (older listed first): the function must not
    // depend on the caller having already sorted the array.
    const result = resolvePreviewPeriod({
      periods: [older, mostRecent],
      requestedPeriodId: null,
      currentOpenPeriod: null,
    });
    expect(result).toBe(mostRecent);
  });

  it("returns null when the organization has no periods at all", () => {
    const result = resolvePreviewPeriod({
      periods: [],
      requestedPeriodId: null,
      currentOpenPeriod: null,
    });
    expect(result).toBeNull();
  });
});

describe("previewPeriodDateRange", () => {
  it("uses the period's own date range when a period is given", () => {
    const period = makePeriod("p1", "2026-03-01", "2026-03-31");
    expect(previewPeriodDateRange(period)).toEqual({
      startsOn: "2026-03-01",
      endsOn: "2026-03-31",
    });
  });

  it("falls back to a same-day range for today when there is no period", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(previewPeriodDateRange(null)).toEqual({
      startsOn: today,
      endsOn: today,
    });
  });
});
