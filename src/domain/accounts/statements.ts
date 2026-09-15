import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import { billingCases } from "../../db/schema/billing";
import { invoices } from "../../db/schema/invoices";
import { addExact, maxExact } from "../../lib/decimal2";
import { calculateStatementBalance } from "./balance";
import { calculateLateFee } from "./late-fees";
import { getDwellingAccountBalance, getEffectiveLateFeePolicy } from "./ledger";

export async function resolveStatementFinancials(
  db: DbOrTx,
  input: {
    organizationId: string;
    dwellingId: string;
    currency: string;
    issueDate: string;
    currentCharges: string;
    manualAdjustment: string;
    lateFeeAdjustment?: string;
  }
) {
  const accountBalance = await getDwellingAccountBalance(
    db,
    input.organizationId,
    input.dwellingId,
    input.currency
  );
  const policy = await getEffectiveLateFeePolicy(
    db,
    input.organizationId,
    input.issueDate
  );
  const [oldestUnpaid] = await db
    .select({
      dueDate: invoices.dueDate,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(
      and(
        eq(invoices.organizationId, input.organizationId),
        eq(invoices.dwellingId, input.dwellingId),
        isNull(invoices.paidAt),
        lt(invoices.dueDate, input.issueDate),
        inArray(billingCases.status, ["PREPARED", "SENT", "OVERDUE"])
      )
    )
    .orderBy(asc(invoices.dueDate))
    .limit(1);

  const lateFee =
    policy && oldestUnpaid
      ? calculateLateFee({
          enabled: policy.enabled,
          principal: maxExact(accountBalance, "0.00"),
          dailyRate: policy.dailyRate,
          dueDate: oldestUnpaid.dueDate,
          asOfDate: input.issueDate,
          graceDays: policy.graceDays,
          maxPenaltyPercent: policy.maxPenaltyPercent,
          stopsAtCap: policy.stopsAtCap,
        })
      : calculateLateFee({
          enabled: false,
          principal: "0.00",
          dailyRate: "0.00",
          dueDate: input.issueDate,
          asOfDate: input.issueDate,
          graceDays: 0,
          maxPenaltyPercent: "0.00",
          stopsAtCap: true,
        });
  const lateFeeApplied =
    lateFee.rawAmount === "0.00" ? "0.00" : lateFee.appliedAmount;
  const adjustment = input.lateFeeAdjustment ?? "0.00";
  const appliedWithAdjustment = maxExact(
    addExact(lateFeeApplied, adjustment),
    "0.00"
  );
  const balance = calculateStatementBalance({
    currentCharges: input.currentCharges,
    accountBalance,
    lateFee: appliedWithAdjustment,
    manualAdjustment: input.manualAdjustment,
  });
  return { accountBalance, policy, lateFee, balance, oldestUnpaid };
}

export type StatementFinancials = Awaited<
  ReturnType<typeof resolveStatementFinancials>
>;

// Single source of truth for the two invoice snapshot columns -- every
// caller that persists balanceSnapshot/penaltySnapshot (generateInvoice,
// prepareInvoice, adjustLateFee) must use these so the two admin-facing
// snapshot columns always have the same shape, however the numbers were
// last recomputed.
export function buildBalanceSnapshot(financials: StatementFinancials) {
  return {
    accountBalance: financials.accountBalance,
    previousOutstanding: financials.balance.previousOutstanding,
    previousCreditApplied: financials.balance.previousCreditApplied,
    remainingCredit: financials.balance.remainingCredit,
    sourceInvoice: financials.oldestUnpaid?.invoiceNumber ?? null,
  };
}

export function buildPenaltySnapshot(financials: StatementFinancials) {
  return {
    policyId: financials.policy?.id ?? null,
    enabled: financials.policy?.enabled ?? false,
    dailyRate: financials.lateFee.dailyRate,
    graceDays: financials.policy?.graceDays ?? 0,
    maxPenaltyPercent: financials.lateFee.maxPenaltyPercent,
    stopsAtCap: financials.lateFee.stopsAtCap,
    eligiblePrincipal: financials.lateFee.eligiblePrincipal,
    firstPenaltyDate: financials.lateFee.firstPenaltyDate,
    overdueDays: financials.lateFee.overdueDays,
    rawAmount: financials.lateFee.rawAmount,
    capAmount: financials.lateFee.capAmount,
  };
}
