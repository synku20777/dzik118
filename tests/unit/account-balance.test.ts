import { describe, expect, it } from "vitest";
import { calculateStatementBalance } from "../../src/domain/accounts/balance";

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
});
