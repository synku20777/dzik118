import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import { billingCases } from "../../db/schema/billing";
import { invoices } from "../../db/schema/invoices";
import { addExact, maxExact, subtractExact } from "../../lib/decimal2";
import { calculateStatementBalance } from "./balance";
import { calculateLateFee } from "./late-fees";
import {
  PAYABLE_CASE_STATUSES,
  getDwellingAccountBalance,
  getEffectiveLateFeePolicy,
  getProtectedOpeningDebt,
} from "./ledger";

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
    // The invoice this statement is for, when it exists already.
    invoiceId?: string;
  }
) {
  const accountBalance = await getDwellingAccountBalance(
    db,
    input.organizationId,
    input.dwellingId,
    input.currency,
    input.issueDate,
    input.invoiceId
  );
  // Migrated opening debt has no known due date, so it is not late-fee
  // principal until paid (ADR 0013).
  const excludedOpeningDebt = await getProtectedOpeningDebt(
    db,
    input.organizationId,
    input.dwellingId,
    input.currency,
    input.issueDate
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
        eq(invoices.currency, input.currency),
        isNull(invoices.paidAt),
        // An invoice a credit covered in full asks for nothing: it is not
        // late, so its due date is not where a late fee starts.
        gt(invoices.amountDue, "0"),
        lt(invoices.dueDate, input.issueDate),
        inArray(billingCases.status, PAYABLE_CASE_STATUSES)
      )
    )
    .orderBy(asc(invoices.dueDate))
    .limit(1);
  // Debt that is not late yet: what each invoice not due at the issue date
  // added itself (its amount due without the earlier debt it carries). It is
  // in the balance, but a late fee is for late debt only. Payments count
  // against the oldest debt first, as each invoice carries the earlier
  // balance; a payment matched to a not-yet-due invoice can so only lower the
  // principal, never raise it.
  const [{ notYetDue }] = await db
    .select({
      notYetDue: sql<string>`coalesce(sum(greatest(${invoices.amountDue} - ${invoices.previousOutstanding}, 0)), 0)::numeric(14, 2)::text`,
    })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(
      and(
        eq(invoices.organizationId, input.organizationId),
        eq(invoices.dwellingId, input.dwellingId),
        eq(invoices.currency, input.currency),
        isNull(invoices.paidAt),
        gte(invoices.dueDate, input.issueDate),
        inArray(billingCases.status, PAYABLE_CASE_STATUSES),
        // Its own entries are already left out of the balance.
        input.invoiceId ? ne(invoices.id, input.invoiceId) : undefined
      )
    );

  const lateFee =
    policy && oldestUnpaid
      ? calculateLateFee({
          enabled: policy.enabled,
          principal: maxExact(
            subtractExact(
              subtractExact(accountBalance, excludedOpeningDebt),
              notYetDue
            ),
            "0.00"
          ),
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
  return {
    accountBalance,
    excludedOpeningDebt,
    policy,
    lateFee,
    balance,
    oldestUnpaid,
  };
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
    excludedOpeningDebt: financials.excludedOpeningDebt,
    firstPenaltyDate: financials.lateFee.firstPenaltyDate,
    overdueDays: financials.lateFee.overdueDays,
    rawAmount: financials.lateFee.rawAmount,
    capAmount: financials.lateFee.capAmount,
  };
}
