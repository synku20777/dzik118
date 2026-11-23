import { describe, expect, it } from "vitest";
import {
  computeDaysLate,
  computeInvoicePaidAndOutstanding,
  effectiveConfirmedAllocation,
} from "../../src/domain/periods/invoice-balance";
import {
  collectionShare,
  formatCollectionShare,
  getReadingsProgressState,
  resolvePeriodFilter,
  summarizePeriodPayments,
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

describe("readings progress state", () => {
  it("distinguishes empty periods from completed and in-progress periods", () => {
    expect(getReadingsProgressState(0, 0)).toEqual({
      kind: "empty",
      remaining: 0,
    });
    expect(getReadingsProgressState(2, 5)).toEqual({
      kind: "remaining",
      remaining: 3,
    });
    expect(getReadingsProgressState(5, 5)).toEqual({
      kind: "complete",
      remaining: 0,
    });
  });
});

describe("invoice paid and outstanding reconciliation", () => {
  it("keeps paid + outstanding equal to amountDue across partial, direct paidAt, and reversed rows", () => {
    const allocations = new Map<string, string>([
      ["inv-partial", "40.00"],
      ["inv-reversed", "0.00"],
    ]);

    expect(
      computeInvoicePaidAndOutstanding(
        { amountDue: "100.00", paidAt: null },
        allocations,
        "inv-partial"
      )
    ).toEqual({ paid: "40.00", outstanding: "60.00" });

    expect(
      computeInvoicePaidAndOutstanding(
        { amountDue: "100.00", paidAt: new Date("2026-06-20") },
        allocations,
        "inv-legacy-paid"
      )
    ).toEqual({ paid: "100.00", outstanding: "0.00" });

    // Even if paidAt remained set alongside a ledger row reversed to 0.00,
    // paid and outstanding stay mutually consistent.
    expect(
      computeInvoicePaidAndOutstanding(
        { amountDue: "100.00", paidAt: new Date("2026-06-20") },
        allocations,
        "inv-reversed"
      )
    ).toEqual({ paid: "0.00", outstanding: "100.00" });

    // An invoice regenerated for a lower amount after partial allocation still
    // preserves `paid + outstanding === max(amountDue, 0)`.
    allocations.set("inv-overallocated", "60.00");
    expect(
      computeInvoicePaidAndOutstanding(
        { amountDue: "50.00", paidAt: null },
        allocations,
        "inv-overallocated"
      )
    ).toEqual({ paid: "50.00", outstanding: "0.00" });

    expect(
      computeInvoicePaidAndOutstanding(
        { amountDue: "-10.00", paidAt: null },
        allocations,
        "inv-credit"
      )
    ).toEqual({ paid: "0.00", outstanding: "0.00" });
  });
});

describe("days late and migrated allocation helpers", () => {
  it("computes overdue days against the organization local date", () => {
    expect(computeDaysLate("2026-06-30", "2026-07-01")).toBe(1);
    expect(computeDaysLate("2026-06-30", "2026-06-30")).toBe(0);
    expect(computeDaysLate("2026-07-05", "2026-07-01")).toBe(0);
  });

  it("handles pre-v2 migrated matches and preserves explicit ledger allocations", () => {
    expect(
      effectiveConfirmedAllocation({
        proposedAllocationAmount: "0.00",
        transactionAmount: "100.00",
        amountDue: "100.00",
      })
    ).toBe("100.00");
    expect(
      effectiveConfirmedAllocation({
        proposedAllocationAmount: "0.00",
        transactionAmount: "150.00",
        amountDue: "100.00",
      })
    ).toBe("100.00");
    expect(
      effectiveConfirmedAllocation({
        proposedAllocationAmount: "40.00",
        transactionAmount: "100.00",
        amountDue: "100.00",
      })
    ).toBe("40.00");
  });
});

describe("period payment summary", () => {
  it("reconciles period applied totals separately from overpayment cash received", () => {
    expect(
      summarizePeriodPayments(
        [
          {
            status: "CONFIRMED",
            amount: "120.00",
            allocatedAmount: "100.00",
            currency: "EUR",
            invoiceCurrency: "EUR",
          },
          {
            status: "REVERSED",
            amount: "50.00",
            currency: "EUR",
            invoiceCurrency: "EUR",
          },
        ],
        "EUR"
      )
    ).toEqual({
      mixedCurrency: false,
      orgCurrencyConfirmedCount: 1,
      otherCurrencyRowCount: 0,
      receivedTotal: "120.00",
      appliedTotal: "100.00",
      hasOverpaymentDifference: true,
    });

    expect(
      summarizePeriodPayments(
        [
          {
            status: "CONFIRMED",
            amount: "100.00",
            allocatedAmount: "100.00",
            currency: "EUR",
            invoiceCurrency: "EUR",
          },
          {
            status: "CONFIRMED",
            amount: "50.00",
            allocatedAmount: "50.00",
            currency: "USD",
            invoiceCurrency: "USD",
          },
        ],
        "EUR"
      )
    ).toEqual({
      mixedCurrency: true,
      orgCurrencyConfirmedCount: 1,
      otherCurrencyRowCount: 1,
      receivedTotal: "100.00",
      appliedTotal: "100.00",
      hasOverpaymentDifference: false,
    });

    expect(
      summarizePeriodPayments(
        [
          {
            status: "CONFIRMED",
            amount: "60.00",
            allocatedAmount: "60.00",
            currency: "EUR",
            invoiceCurrency: "EUR",
            invoiceId: "inv-regenerated",
            invoiceAmountDue: "50.00",
          },
        ],
        "EUR"
      )
    ).toEqual({
      mixedCurrency: false,
      orgCurrencyConfirmedCount: 1,
      otherCurrencyRowCount: 0,
      receivedTotal: "60.00",
      appliedTotal: "50.00",
      hasOverpaymentDifference: true,
    });

    expect(
      summarizePeriodPayments(
        [
          {
            status: "CONFIRMED",
            amount: "100.00",
            allocatedAmount: "100.00",
            currency: "EUR",
            invoiceCurrency: "EUR",
            invoiceId: "inv-multi-migrated",
            invoiceAmountDue: "100.00",
          },
          {
            status: "CONFIRMED",
            amount: "100.00",
            allocatedAmount: "100.00",
            currency: "EUR",
            invoiceCurrency: "EUR",
            invoiceId: "inv-multi-migrated",
            invoiceAmountDue: "100.00",
          },
        ],
        "EUR"
      )
    ).toEqual({
      mixedCurrency: false,
      orgCurrencyConfirmedCount: 2,
      otherCurrencyRowCount: 0,
      receivedTotal: "200.00",
      appliedTotal: "100.00",
      hasOverpaymentDifference: true,
    });
  });
});

describe("period filter resolution", () => {
  const orgPeriods = [{ id: "period-1" }, { id: "period-2" }];

  it("treats empty params as all periods and resolves known IDs", () => {
    expect(resolvePeriodFilter(orgPeriods, null)).toEqual({
      kind: "all",
      period: undefined,
    });
    expect(resolvePeriodFilter(orgPeriods, "   ")).toEqual({
      kind: "all",
      period: undefined,
    });
    expect(resolvePeriodFilter(orgPeriods, "period-2")).toEqual({
      kind: "selected",
      period: { id: "period-2" },
    });
  });

  it("keeps unknown or foreign period IDs isolated instead of widening to all", () => {
    expect(resolvePeriodFilter(orgPeriods, "foreign-or-stale-id")).toEqual({
      kind: "unknown",
      period: undefined,
    });
  });
});
