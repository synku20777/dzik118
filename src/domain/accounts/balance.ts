import {
  addExact,
  compareExact,
  maxExact,
  minExact,
  negateExact,
  subtractExact,
  sumExact,
} from "../../lib/decimal2";

export interface StatementBalanceInput {
  currentCharges: string;
  accountBalance: string;
  lateFee: string;
  manualAdjustment: string;
}

export interface StatementBalance {
  currentCharges: string;
  previousOutstanding: string;
  previousCreditApplied: string;
  lateFee: string;
  manualAdjustment: string;
  amountDue: string;
  remainingCredit: string;
}

export function calculateStatementBalance(
  input: StatementBalanceInput
): StatementBalance {
  if (
    compareExact(input.currentCharges, "0") < 0 ||
    compareExact(input.lateFee, "0") < 0
  ) {
    throw new RangeError("Charges and late fees cannot be negative");
  }

  const previousOutstanding = maxExact(input.accountBalance, "0.00");
  const availableCredit = maxExact(negateExact(input.accountBalance), "0.00");
  const beforeCredit = sumExact([
    input.currentCharges,
    previousOutstanding,
    input.lateFee,
    input.manualAdjustment,
  ]);
  const positiveBeforeCredit = maxExact(beforeCredit, "0.00");
  const previousCreditApplied = minExact(availableCredit, positiveBeforeCredit);
  const amountDue = maxExact(
    subtractExact(positiveBeforeCredit, previousCreditApplied),
    "0.00"
  );
  const adjustmentCredit = maxExact(negateExact(beforeCredit), "0.00");
  const remainingCredit = addExact(
    subtractExact(availableCredit, previousCreditApplied),
    adjustmentCredit
  );

  return {
    currentCharges: input.currentCharges,
    previousOutstanding,
    previousCreditApplied,
    lateFee: input.lateFee,
    manualAdjustment: input.manualAdjustment,
    amountDue,
    remainingCredit,
  };
}
