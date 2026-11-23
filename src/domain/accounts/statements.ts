import { inArray } from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import { invoices } from "../../db/schema/invoices";
import { addExact, compareExact, maxExact } from "../../lib/decimal2";
import { calculateStatementBalance } from "./balance";
import { calculateLateFee } from "./late-fees";
import {
  PAYABLE_CASE_STATUSES,
  getDwellingAccountBalance,
  getEffectiveLateFeePolicy,
} from "./ledger";
import { loadSettlement } from "./settlement";

// Invoices that are a real debt, prepared and not pulled back to Draft.
const ISSUED_CASE_STATUSES = [...PAYABLE_CASE_STATUSES, "PAID"];

type PenaltySources = { invoiceId: string; accrued: string }[];

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
  const policy = await getEffectiveLateFeePolicy(
    db,
    input.organizationId,
    input.issueDate
  );

  // Payments up to the issue date only: a later one does not shorten the
  // days this statement charges.
  const { invoices: rows, settlement } = await loadSettlement(
    db,
    input.organizationId,
    input.dwellingId,
    input.currency,
    input.issueDate
  );
  const issued = rows.filter(
    (row) =>
      row.id !== input.invoiceId &&
      ISSUED_CASE_STATUSES.includes(row.caseStatus)
  );
  // What other invoices already charged for each late invoice, from the
  // penalty snapshot each one stored when it was prepared.
  const snapshots = issued.length
    ? await db
        .select({
          issueDate: invoices.issueDate,
          lateFeeCalculated: invoices.lateFeeCalculated,
          penaltySnapshot: invoices.penaltySnapshot,
        })
        .from(invoices)
        .where(
          inArray(
            invoices.id,
            issued.map((row) => row.id)
          )
        )
    : [];
  const charged = new Map<string, string>();
  let chargedThrough: string | undefined;
  for (const row of snapshots) {
    const sources = (row.penaltySnapshot as { sources?: PenaltySources })
      .sources;
    if (Array.isArray(sources)) {
      for (const source of sources) {
        charged.set(
          source.invoiceId,
          maxExact(charged.get(source.invoiceId) ?? "0.00", source.accrued)
        );
      }
    } else if (
      compareExact(row.lateFeeCalculated, "0.00") > 0 &&
      (!chargedThrough || row.issueDate > chargedThrough)
    ) {
      // shortcut: a fee from before ADR 0016 has no record per invoice, so
      // every day up to its issue date counts as charged; drop this once no
      // such invoice is still unpaid.
      chargedThrough = row.issueDate;
    }
  }
  const byId = new Map(issued.map((row) => [row.id, row]));
  const lateFee = calculateLateFee({
    policy,
    settlement,
    sources: settlement.order
      .map((id) => byId.get(id))
      .filter((row) => row !== undefined && row.dueDate < input.issueDate)
      .map((row) => ({
        invoiceId: row!.id,
        invoiceNumber: row!.invoiceNumber,
        dueDate: row!.dueDate,
      })),
    asOf: input.issueDate,
    charged,
    chargedThrough,
  });

  const adjustment = input.lateFeeAdjustment ?? "0.00";
  const appliedWithAdjustment = maxExact(
    addExact(lateFee.appliedAmount, adjustment),
    "0.00"
  );
  const balance = calculateStatementBalance({
    currentCharges: input.currentCharges,
    accountBalance,
    lateFee: appliedWithAdjustment,
    manualAdjustment: input.manualAdjustment,
  });
  return { accountBalance, policy, lateFee, balance };
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
    sourceInvoice: financials.lateFee.sources[0]?.invoiceNumber ?? null,
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
    rawAmount: financials.lateFee.rawAmount,
    // One row per late invoice; later statements read `accrued` so a day
    // is charged only once.
    sources: financials.lateFee.sources,
  };
}
