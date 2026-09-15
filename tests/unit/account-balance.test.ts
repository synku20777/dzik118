import { describe, expect, it } from "vitest";
import { calculateStatementBalance } from "../../src/domain/accounts/balance";
import { calculateLateFee } from "../../src/domain/accounts/late-fees";

describe("account statement arithmetic", () => {
  it("carries debt, applies credit, and never makes amount due negative", () => {
    expect(
      calculateStatementBalance({
        currentCharges: "60.00",
        accountBalance: "22.43",
        lateFee: "0.00",
        manualAdjustment: "0.00",
      })
    ).toMatchObject({ previousOutstanding: "22.43", amountDue: "82.43" });
    expect(
      calculateStatementBalance({
        currentCharges: "60.00",
        accountBalance: "-27.57",
        lateFee: "0.00",
        manualAdjustment: "0.00",
      })
    ).toMatchObject({ previousCreditApplied: "27.57", amountDue: "32.43" });
  });

  it("calculates capped daily penalties once and retains the calculation", () => {
    expect(
      calculateLateFee({
        enabled: true,
        principal: "100.00",
        dailyRate: "0.15",
        dueDate: "2026-10-01",
        asOfDate: "2026-11-01",
        graceDays: 0,
        maxPenaltyPercent: "2",
        stopsAtCap: true,
      })
    ).toMatchObject({
      overdueDays: 31,
      rawAmount: "4.65",
      capAmount: "2.00",
      appliedAmount: "2.00",
    });
  });
});
