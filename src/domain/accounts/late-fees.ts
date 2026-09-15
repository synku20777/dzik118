import {
  compareExact,
  minExact,
  percentForDays,
  percentOf,
} from "../../lib/decimal2";

export interface LateFeeInput {
  enabled: boolean;
  principal: string;
  dailyRate: string;
  dueDate: string;
  asOfDate: string;
  graceDays: number;
  maxPenaltyPercent: string;
  stopsAtCap: boolean;
}

export interface LateFeeCalculation {
  eligiblePrincipal: string;
  firstPenaltyDate: string | null;
  overdueDays: number;
  dailyRate: string;
  rawAmount: string;
  capAmount: string;
  appliedAmount: string;
  maxPenaltyPercent: string;
  stopsAtCap: boolean;
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function calculateLateFee(input: LateFeeInput): LateFeeCalculation {
  const due = utcDate(input.dueDate);
  const first = new Date(due);
  first.setUTCDate(first.getUTCDate() + input.graceDays + 1);
  const asOf = utcDate(input.asOfDate);
  const overdueDays = Math.max(
    0,
    Math.floor((asOf.getTime() - first.getTime()) / 86_400_000) + 1
  );
  const inactive =
    !input.enabled ||
    overdueDays === 0 ||
    compareExact(input.principal, "0") <= 0 ||
    compareExact(input.dailyRate, "0") <= 0;
  const rawAmount = inactive
    ? "0.00"
    : percentForDays(input.principal, input.dailyRate, overdueDays, 2);
  const capAmount = percentOf(input.principal, input.maxPenaltyPercent, 2);
  const appliedAmount = input.stopsAtCap
    ? minExact(rawAmount, capAmount)
    : rawAmount;

  return {
    eligiblePrincipal: input.principal,
    firstPenaltyDate: overdueDays > 0 ? dateString(first) : null,
    overdueDays,
    dailyRate: input.dailyRate,
    rawAmount,
    capAmount,
    appliedAmount,
    maxPenaltyPercent: input.maxPenaltyPercent,
    stopsAtCap: input.stopsAtCap,
  };
}
