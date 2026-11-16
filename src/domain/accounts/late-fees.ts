// Late fees (ADR 0016). Each late invoice is charged on its own amount, its
// own late fee left out, for the days it was unpaid. A day is charged once:
// an invoice charges the fee accrued so far less what earlier invoices
// already charged for the same late invoice.
import {
  compareExact,
  maxExact,
  minExact,
  multiplyAndRound,
  percentForDays,
  percentOf,
  subtractExact,
  sumExact,
} from "../../lib/decimal2";
import { paidInBy, unpaidOwn, type Settlement } from "./settlement";

export interface LateFeePolicyInput {
  enabled: boolean;
  dailyRate: string;
  graceDays: number;
  maxPenaltyPercent: string;
  stopsAtCap: boolean;
}

export interface LateFeeSource {
  invoiceId: string;
  invoiceNumber: string;
  dueDate: string;
}

export interface LateFeeSourceResult {
  invoiceId: string;
  invoiceNumber: string;
  firstPenaltyDate: string;
  // The fee accrued on this invoice up to the issue date, capped.
  accrued: string;
  // The part of it this statement charges.
  charged: string;
}

export interface LateFeeCalculation {
  dailyRate: string;
  maxPenaltyPercent: string;
  stopsAtCap: boolean;
  rawAmount: string;
  appliedAmount: string;
  sources: LateFeeSourceResult[];
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysFrom(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
    86_400_000
  );
}

export function calculateLateFee(input: {
  policy: LateFeePolicyInput | null;
  settlement: Settlement;
  // Invoices due before `asOf`, oldest first.
  sources: LateFeeSource[];
  // The issue date of the statement; the last day that can be charged.
  asOf: string;
  // What other invoices already charged for each source.
  charged: Map<string, string>;
  // Days up to and including this date were charged under the rule before
  // ADR 0016, with no record per invoice.
  chargedThrough?: string;
}): LateFeeCalculation {
  const policy = input.policy;
  const results: LateFeeSourceResult[] = [];
  const raw: string[] = [];
  const active =
    policy?.enabled && compareExact(policy.dailyRate, "0") > 0 ? policy : null;

  for (const source of active ? input.sources : []) {
    let first = addDays(source.dueDate, active!.graceDays + 1);
    if (input.chargedThrough && first <= input.chargedThrough) {
      first = addDays(input.chargedThrough, 1);
    }
    if (first > input.asOf) continue;
    const principal =
      input.settlement.principal.get(source.invoiceId) ?? "0.00";
    const base = maxExact(principal, "0.00");
    // Money pays the invoice's charges before its late fee line, so the fee
    // line is the last part to stay unpaid and never carries a fee itself.
    const feeLine = maxExact(
      subtractExact(
        input.settlement.own.get(source.invoiceId) ?? "0.00",
        principal
      ),
      "0.00"
    );
    // The unpaid part changes only on a day money is paid in.
    const starts = [
      first,
      ...input.settlement.paidIn
        .map((point) => point.date)
        .filter((date) => date > first && date <= input.asOf),
    ];
    const principalDays = sumExact(
      starts.map((start, index) => {
        const end = starts[index + 1] ?? addDays(input.asOf, 1);
        const unpaid = minExact(
          maxExact(
            subtractExact(
              unpaidOwn(
                input.settlement,
                source.invoiceId,
                paidInBy(input.settlement, start)
              ),
              feeLine
            ),
            "0.00"
          ),
          base
        );
        return multiplyAndRound(unpaid, String(daysFrom(start, end)), 2);
      })
    );
    const accruedRaw = percentForDays(principalDays, active!.dailyRate, 1, 2);
    const cap = percentOf(base, active!.maxPenaltyPercent, 2);
    const accrued = active!.stopsAtCap ? minExact(accruedRaw, cap) : accruedRaw;
    if (compareExact(accrued, "0.00") <= 0) continue;
    const already = input.charged.get(source.invoiceId) ?? "0.00";
    raw.push(maxExact(subtractExact(accruedRaw, already), "0.00"));
    results.push({
      invoiceId: source.invoiceId,
      invoiceNumber: source.invoiceNumber,
      firstPenaltyDate: first,
      accrued,
      charged: maxExact(subtractExact(accrued, already), "0.00"),
    });
  }

  return {
    dailyRate: policy?.dailyRate ?? "0.00",
    maxPenaltyPercent: policy?.maxPenaltyPercent ?? "0.00",
    stopsAtCap: policy?.stopsAtCap ?? true,
    rawAmount: sumExact(raw),
    appliedAmount: sumExact(results.map((result) => result.charged)),
    sources: results,
  };
}
