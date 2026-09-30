// Resident portal - payment history of one dwelling (ADR 0009). A resident
// sees the date, the amount, and the invoice. A reversed payment shows as
// "Reversed". The resident never sees the reason, the payer name, the payer
// account, or the bank reference. The query starts from the dwelling, so it
// cannot return a row of another dwelling. Only invoices that the resident can
// see (SENT, PAID, OVERDUE) appear, like the invoice list.
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { paymentAllocations, paymentReversals } from "../../db/schema/accounts";
import { billingCases } from "../../db/schema/billing";
import { invoices } from "../../db/schema/invoices";
import { bankTransactions } from "../../db/schema/payments";

export interface ResidentPaymentRow {
  status: "PAID" | "REVERSED";
  date: string; // YYYY-MM-DD
  amount: string;
  currency: string;
  invoiceId: string;
  invoiceNumber: string;
}

const VISIBLE_CASE_STATUSES = ["SENT", "PAID", "OVERDUE"] as const;

export async function listPaymentsForResident(
  db: Db,
  dwellingId: string
): Promise<ResidentPaymentRow[]> {
  const [paid, reversed] = await Promise.all([
    db
      .select({
        date: bankTransactions.bookingDate,
        amount: paymentAllocations.allocatedAmount,
        currency: invoices.currency,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(paymentAllocations)
      .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
      .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
      .innerJoin(
        bankTransactions,
        eq(bankTransactions.id, paymentAllocations.bankTransactionId)
      )
      .where(
        and(
          eq(paymentAllocations.dwellingId, dwellingId),
          inArray(billingCases.status, [...VISIBLE_CASE_STATUSES]),
          gt(paymentAllocations.allocatedAmount, "0")
        )
      ),
    db
      .select({
        at: paymentReversals.createdAt,
        amount: paymentReversals.reversedAllocationAmount,
        currency: invoices.currency,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(paymentReversals)
      .innerJoin(invoices, eq(invoices.id, paymentReversals.invoiceId))
      .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
      .where(
        and(
          eq(paymentReversals.dwellingId, dwellingId),
          inArray(billingCases.status, [...VISIBLE_CASE_STATUSES]),
          gt(paymentReversals.reversedAllocationAmount, "0")
        )
      ),
  ]);

  const rows: ResidentPaymentRow[] = [
    ...paid.map(({ date, ...rest }) => ({
      status: "PAID" as const,
      date,
      ...rest,
    })),
    ...reversed.map(({ at, ...rest }) => ({
      status: "REVERSED" as const,
      date: at.toISOString().slice(0, 10),
      ...rest,
    })),
  ];
  // Newest first. On one day a reversal comes after the payment it cancels.
  return rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (a.status === "REVERSED" ? -1 : 1) - (b.status === "REVERSED" ? -1 : 1)
  );
}
