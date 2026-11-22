// ADR 0016: money covers invoices oldest first by their own amount, and a
// late fee is charged on each late invoice's own amount, each day once.
import { describe, expect, it } from "vitest";
import { calculateLateFee } from "../../src/domain/accounts/late-fees";
import {
  paidInBy,
  settle,
  unpaidOwn,
  type SettlementEntry,
} from "../../src/domain/accounts/settlement";

const jan = {
  id: "jan",
  dueDate: "2026-01-20",
  issueDate: "2026-01-05",
  invoiceNumber: "1",
};
const feb = {
  id: "feb",
  dueDate: "2026-03-01",
  issueDate: "2026-02-15",
  invoiceNumber: "2",
};
const charge = (
  invoiceId: string,
  debit: string,
  date: string,
  type = "INVOICE_CHARGE"
): SettlementEntry => ({
  type,
  invoiceId,
  debit,
  credit: "0.00",
  effectiveDate: date,
});
const payment = (
  credit: string,
  date: string,
  invoiceId: string | null = null
): SettlementEntry => ({
  type: "PAYMENT",
  invoiceId,
  debit: "0.00",
  credit,
  effectiveDate: date,
});

function unpaid(entries: SettlementEntry[], id: string, date?: string) {
  const s = settle([feb, jan], entries);
  return unpaidOwn(s, id, paidInBy(s, date));
}

describe("settlement", () => {
  const charges = [
    charge("jan", "100.00", "2026-01-05"),
    charge("feb", "100.00", "2026-02-15"),
  ];

  it("a payment named for the newer invoice covers the older one first", () => {
    const entries = [...charges, payment("100.00", "2026-02-20", "feb")];
    expect(unpaid(entries, "jan")).toBe("0.00");
    expect(unpaid(entries, "feb")).toBe("100.00");
  });

  it("paying the newer invoice's total, which carries the older debt, covers both", () => {
    const entries = [...charges, payment("200.00", "2026-02-20", "feb")];
    expect(unpaid(entries, "jan")).toBe("0.00");
    expect(unpaid(entries, "feb")).toBe("0.00");
  });

  it("debt with no invoice is paid first, and a reversal uncovers the newest", () => {
    const entries = [
      {
        ...charge("jan", "50.00", "2026-01-01", "OPENING_BALANCE"),
        invoiceId: null,
      },
      ...charges,
      payment("250.00", "2026-02-20"),
      {
        type: "PAYMENT_REVERSAL",
        invoiceId: null,
        debit: "60.00",
        credit: "0.00",
        effectiveDate: "2026-02-21",
      },
    ];
    expect(unpaid(entries, "jan")).toBe("0.00");
    expect(unpaid(entries, "feb")).toBe("60.00");
    expect(unpaid(entries, "feb", "2026-02-20")).toBe("0.00");
  });

  it("a later charge with no invoice does not reopen an older paid invoice", () => {
    const entries = [
      ...charges,
      payment("100.00", "2026-01-15"),
      {
        ...charge("jan", "10.00", "2026-02-01", "MANUAL_ADJUSTMENT"),
        invoiceId: null,
      },
    ];
    expect(unpaid(entries, "jan")).toBe("0.00");
    // Due before February's own amount, so it is paid before it.
    expect(unpaid(entries, "feb")).toBe("100.00");
  });
});

describe("late fee", () => {
  const policy = {
    enabled: true,
    dailyRate: "0.050000",
    graceDays: 0,
    maxPenaltyPercent: "10",
    stopsAtCap: true,
  };
  const sources = [
    { invoiceId: "jan", invoiceNumber: "1", dueDate: jan.dueDate },
    { invoiceId: "feb", invoiceNumber: "2", dueDate: feb.dueDate },
  ];

  it("charges each day once, on the late invoice's own amount, and not on an earlier fee", () => {
    // February: Jan unpaid Jan 21 - Feb 15, 26 days x 100 x 0.05%.
    const onFeb = calculateLateFee({
      policy,
      settlement: settle([jan], [charge("jan", "100.00", "2026-01-05")]),
      sources: sources.slice(0, 1),
      asOf: "2026-02-15",
      charged: new Map(),
    });
    expect(onFeb.appliedAmount).toBe("1.30");

    // March: Jan paid on Mar 1 (39 days in all, 1.30 already charged);
    // Feb's own 100 late Mar 2 - Mar 15, its 1.30 late fee line left out.
    const entries = [
      charge("jan", "100.00", "2026-01-05"),
      charge("feb", "100.00", "2026-02-15"),
      charge("feb", "1.30", "2026-02-15", "LATE_FEE"),
      payment("100.00", "2026-03-01"),
    ];
    const onMar = calculateLateFee({
      policy,
      settlement: settle([jan, feb], entries),
      sources,
      asOf: "2026-03-15",
      charged: new Map([["jan", "1.30"]]),
    });
    expect(
      onMar.sources.map((s) => [s.invoiceId, s.accrued, s.charged])
    ).toEqual([
      ["jan", "1.95", "0.65"],
      ["feb", "0.70", "0.70"],
    ]);
    expect(onMar.appliedAmount).toBe("1.35");
  });

  it("charges no fee when only the invoice's own late fee line is unpaid", () => {
    // February: 100 charges and a 1.30 fee line; 100 paid before its due date.
    const entries = [
      charge("feb", "100.00", "2026-02-15"),
      charge("feb", "1.30", "2026-02-15", "LATE_FEE"),
      payment("100.00", "2026-02-20"),
    ];
    const fee = calculateLateFee({
      policy,
      settlement: settle([feb], entries),
      sources: sources.slice(1),
      asOf: "2026-03-31",
      charged: new Map(),
    });
    expect(fee.appliedAmount).toBe("0.00");
  });

  it("stops at the cap per invoice and charges nothing with the policy off", () => {
    const settlement = settle([jan], [charge("jan", "100.00", "2026-01-05")]);
    const input = {
      settlement,
      sources: sources.slice(0, 1),
      asOf: "2026-12-31",
      charged: new Map([["jan", "4.00"]]),
    };
    expect(calculateLateFee({ ...input, policy }).appliedAmount).toBe("6.00");
    expect(
      calculateLateFee({ ...input, policy: { ...policy, enabled: false } })
        .appliedAmount
    ).toBe("0.00");
  });

  it("does not charge again the days an invoice from before this rule charged", () => {
    const fee = calculateLateFee({
      policy,
      settlement: settle([jan], [charge("jan", "100.00", "2026-01-05")]),
      sources: sources.slice(0, 1),
      asOf: "2026-02-15",
      charged: new Map(),
      chargedThrough: "2026-02-05",
    });
    // Feb 6 - Feb 15 only.
    expect(fee.appliedAmount).toBe("0.50");
  });
});
