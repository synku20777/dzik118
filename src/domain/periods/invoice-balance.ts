import {
  compareExact,
  maxExact,
  minExact,
  subtractExact,
} from "../../lib/decimal2";

/** Single source of truth for invoice paid/outstanding amounts. A Paid
 *  invoice (paidAt set) shows nothing still due, also when the money was
 *  matched to another invoice (ADR 0016); otherwise its ledger allocations
 *  count. Caps paid at non-negative amountDue so
 *  `paid + outstanding === max(amountDue, 0)`. */
export function computeInvoicePaidAndOutstanding(
  invoice: { amountDue: string; paidAt: Date | null },
  allocatedByInvoice: ReadonlyMap<string, string>,
  invoiceId: string
): { paid: string; outstanding: string } {
  const due = maxExact(invoice.amountDue, "0.00");
  const rawPaid = invoice.paidAt
    ? due
    : maxExact(allocatedByInvoice.get(invoiceId) ?? "0.00", "0.00");
  const paid = minExact(rawPaid, due);
  const outstanding = maxExact(subtractExact(due, paid), "0.00");
  return { paid, outstanding };
}

/** Whole calendar days past `dueDate` measured against the organization's local date. */
export function computeDaysLate(dueDate: string, todayLocal: string): number {
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  const todayMs = Date.parse(`${todayLocal}T00:00:00Z`);
  if (!Number.isFinite(dueMs) || !Number.isFinite(todayMs)) return 0;
  return Math.max(0, Math.round((todayMs - dueMs) / 86_400_000));
}

/** Effective portion of a CONFIRMED payment match applied to its invoice.
 *  Pre-v2 migrated matches have `proposedAllocationAmount === "0.00"`, so
 *  fall back to `min(transactionAmount, amountDue)` rather than claiming 0. */
export function effectiveConfirmedAllocation(match: {
  proposedAllocationAmount: string;
  transactionAmount: string;
  amountDue: string;
}): string {
  const recorded = maxExact(match.proposedAllocationAmount, "0.00");
  if (compareExact(recorded, "0.00") > 0) return recorded;
  return minExact(
    maxExact(match.transactionAmount, "0.00"),
    maxExact(match.amountDue, "0.00")
  );
}
