// Phase J (Payments) - payment match lifecycle (spec Section 25,
// PAY-002/003). Callers must call requireOrganizationAccess() before
// calling any of these (spec Section 14).
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { paymentAllocations } from "../../db/schema/accounts";
import { billingCases } from "../../db/schema/billing";
import { invoices } from "../../db/schema/invoices";
import {
  bankTransactions,
  paymentMatchStatusEnum,
  paymentMatches,
} from "../../db/schema/payments";
import { recordAuditEvent } from "../../lib/logging/audit";
import {
  compareExact,
  maxExact,
  minExact,
  subtractExact,
} from "../../lib/decimal2";
import { ConflictError, NotFoundError } from "../errors";
import {
  getInvoiceAllocatedAmount,
  postAccountEntry,
} from "../accounts/ledger";

export { ConflictError, NotFoundError };

// Reference matching is whitespace/case-insensitive (a bank's free-text
// reference field routinely differs from the invoice number only in
// spacing or letter case), but otherwise exact -- spec Section 25's
// "normalized reference contains exact invoice number".
function normalizeForMatch(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

export interface ProposeExactMatchesResult {
  proposed: number;
}

// Reference identifies a single issued invoice. Exact amount remains the
// strongest proposal; partial and overpayment proposals stay explicit until
// an ADMIN confirms their financial consequence.
export async function proposeExactMatches(
  db: DbOrTx,
  organizationId: string,
  bankImportId: string,
  actorUserId: string
): Promise<ProposeExactMatchesResult> {
  const transactions = await db
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        eq(bankTransactions.bankImportId, bankImportId)
      )
    );

  let proposed = 0;
  for (const txn of transactions) {
    // PAY-002: "no reference -> unmatched".
    if (!txn.reference) continue;

    const existingMatches = await db
      .select({ id: paymentMatches.id, status: paymentMatches.status })
      .from(paymentMatches)
      .where(eq(paymentMatches.bankTransactionId, txn.id));
    // Any existing match (proposed, confirmed, or rejected) means this
    // transaction has already been through the matching workflow once;
    // don't propose a second one on top of it.
    if (existingMatches.length > 0) continue;

    const candidates = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        amountDue: invoices.amountDue,
      })
      .from(invoices)
      .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.currency, txn.currency),
          isNull(invoices.paidAt),
          inArray(billingCases.status, ["PREPARED", "SENT", "OVERDUE"])
        )
      );

    const normalizedReference = normalizeForMatch(txn.reference);
    const matching = candidates.filter((invoice) =>
      normalizedReference.includes(normalizeForMatch(invoice.invoiceNumber))
    );
    if (matching.length !== 1) continue;

    const allocated = await getInvoiceAllocatedAmount(
      db,
      organizationId,
      matching[0].id
    );
    const remaining = subtractExact(matching[0].amountDue, allocated);
    if (compareExact(remaining, "0.00") <= 0) continue;
    const resultType =
      compareExact(txn.amount, remaining) === 0
        ? "EXACT"
        : compareExact(txn.amount, remaining) < 0
          ? "PARTIAL"
          : "OVERPAYMENT";
    const proposedAllocationAmount = minExact(txn.amount, remaining);

    // Insert + audit as one unit -- an audit write failing after a bare
    // insert would leave a proposal with no audit trail, and a rerun's
    // existingMatches check above would then skip it forever.
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(paymentMatches)
        .values({
          organizationId,
          bankTransactionId: txn.id,
          invoiceId: matching[0].id,
          matchType: resultType === "EXACT" ? "AUTO_EXACT" : "AUTO_PROBABLE",
          resultType,
          proposedAllocationAmount,
          status: "PROPOSED",
          confidence: resultType === "EXACT" ? "1.0000" : "0.9000",
        })
        .returning();
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "PAYMENT_MATCH_PROPOSED",
        entityType: "payment_match",
        entityId: inserted.id,
        afterData: inserted,
      });
      return inserted;
    });
    proposed++;
  }

  return { proposed };
}

// Confirmation posts the bank transaction once, records the portion assigned
// to this invoice, and marks PAID only when this statement is fully settled.
export async function confirmMatch(
  db: Db,
  organizationId: string,
  matchId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [match] = await tx
      .select()
      .from(paymentMatches)
      .where(
        and(
          eq(paymentMatches.id, matchId),
          eq(paymentMatches.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!match) throw new NotFoundError("Payment match not found");
    if (match.status === "CONFIRMED") return match;
    if (match.status === "REJECTED") {
      throw new ConflictError(
        "This match was rejected and cannot be confirmed"
      );
    }

    const [transaction] = await tx
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, match.bankTransactionId),
          eq(bankTransactions.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!transaction) throw new NotFoundError("Bank transaction not found");

    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, match.invoiceId),
          eq(invoices.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.paidAt) throw new ConflictError("This invoice is already paid");
    const allocatedBefore = await getInvoiceAllocatedAmount(
      tx,
      organizationId,
      invoice.id
    );
    const remaining = subtractExact(invoice.amountDue, allocatedBefore);
    if (compareExact(remaining, "0.00") <= 0) {
      throw new ConflictError("This invoice is already fully allocated");
    }
    const allocatedAmount = minExact(transaction.amount, remaining);
    const resultType =
      compareExact(transaction.amount, remaining) === 0
        ? "EXACT"
        : compareExact(transaction.amount, remaining) < 0
          ? "PARTIAL"
          : "OVERPAYMENT";

    await postAccountEntry(tx, {
      organizationId,
      dwellingId: invoice.dwellingId,
      effectiveDate: transaction.bookingDate,
      type: "PAYMENT",
      debit: "0.00",
      credit: transaction.amount,
      currency: transaction.currency,
      invoiceId: invoice.id,
      bankTransactionId: transaction.id,
      description: `Bank payment ${transaction.reference ?? transaction.id}`,
      metadata: { allocatedAmount, resultType },
      idempotencyKey: `bank-transaction:${transaction.id}:payment`,
    });
    await tx.insert(paymentAllocations).values({
      organizationId,
      dwellingId: invoice.dwellingId,
      bankTransactionId: transaction.id,
      invoiceId: invoice.id,
      allocatedAmount,
      method: resultType,
      actorUserId,
      idempotencyKey: `payment-match:${matchId}:allocation`,
    });

    const [confirmed] = await tx
      .update(paymentMatches)
      .set({
        status: "CONFIRMED",
        resultType,
        proposedAllocationAmount: allocatedAmount,
        confirmedByUserId: actorUserId,
        confirmedAt: new Date(),
      })
      .where(eq(paymentMatches.id, matchId))
      .returning();
    const fullySettled = compareExact(allocatedAmount, remaining) === 0;
    if (fullySettled) {
      await tx
        .update(invoices)
        .set({ paidAt: new Date(), updatedAt: new Date() })
        .where(eq(invoices.id, invoice.id));
      await tx
        .update(billingCases)
        .set({ status: "PAID", statusUpdatedAt: new Date() })
        .where(eq(billingCases.id, invoice.billingCaseId));
    }
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action:
        resultType === "PARTIAL"
          ? "PAYMENT_PARTIALLY_ALLOCATED"
          : resultType === "OVERPAYMENT"
            ? "PAYMENT_OVERPAYMENT_ALLOCATED"
            : "PAYMENT_MATCH_CONFIRMED",
      entityType: "payment_match",
      entityId: matchId,
      afterData: { ...confirmed, allocatedAmount, remaining, fullySettled },
    });
    if (resultType === "OVERPAYMENT") {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "ACCOUNT_CREDIT_CREATED",
        entityType: "account_entry",
        entityId: null,
        afterData: {
          bankTransactionId: transaction.id,
          credit: subtractExact(transaction.amount, allocatedAmount),
        },
      });
    }

    return { ...confirmed, allocatedAmount, remaining, fullySettled };
  });
}

// Idempotent the same way confirmMatch is: rejecting an already-rejected
// match is a no-op. A CONFIRMED match (money already marked paid) cannot
// be rejected here -- unwinding a confirmed payment is a separate,
// unspecified operation, not an accidental side effect of this action.
export async function rejectMatch(
  db: Db,
  organizationId: string,
  matchId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [match] = await tx
      .select()
      .from(paymentMatches)
      .where(
        and(
          eq(paymentMatches.id, matchId),
          eq(paymentMatches.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!match) throw new NotFoundError("Payment match not found");
    if (match.status === "REJECTED") return match;
    if (match.status === "CONFIRMED") {
      throw new ConflictError(
        "This match has already been confirmed and cannot be rejected"
      );
    }

    const [rejected] = await tx
      .update(paymentMatches)
      .set({ status: "REJECTED" })
      .where(eq(paymentMatches.id, matchId))
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "PAYMENT_MATCH_REJECTED",
      entityType: "payment_match",
      entityId: matchId,
      afterData: rejected,
    });

    return rejected;
  });
}

export async function listPaymentMatches(
  db: Db,
  organizationId: string,
  status?: (typeof paymentMatchStatusEnum.enumValues)[number]
) {
  const matches = await db
    .select({
      id: paymentMatches.id,
      status: paymentMatches.status,
      matchType: paymentMatches.matchType,
      resultType: paymentMatches.resultType,
      proposedAllocationAmount: paymentMatches.proposedAllocationAmount,
      confirmedAt: paymentMatches.confirmedAt,
      createdAt: paymentMatches.createdAt,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      dwellingId: invoices.dwellingId,
      currentCharges: invoices.currentCharges,
      amountDue: invoices.amountDue,
      transactionId: bankTransactions.id,
      transactionAmount: bankTransactions.amount,
      transactionCurrency: bankTransactions.currency,
      transactionReference: bankTransactions.reference,
      transactionBookingDate: bankTransactions.bookingDate,
      transactionPayerName: bankTransactions.payerName,
    })
    .from(paymentMatches)
    .innerJoin(invoices, eq(invoices.id, paymentMatches.invoiceId))
    .innerJoin(
      bankTransactions,
      eq(bankTransactions.id, paymentMatches.bankTransactionId)
    )
    .where(
      status
        ? and(
            eq(paymentMatches.organizationId, organizationId),
            eq(paymentMatches.status, status)
          )
        : eq(paymentMatches.organizationId, organizationId)
    )
    .orderBy(desc(paymentMatches.createdAt));
  return matches.map((match) => ({
    ...match,
    remainingAfterAllocation: maxExact(
      subtractExact(match.amountDue, match.proposedAllocationAmount),
      "0.00"
    ),
    creditCreated: maxExact(
      subtractExact(match.transactionAmount, match.proposedAllocationAmount),
      "0.00"
    ),
  }));
}

export async function listUnmatchedTransactions(
  db: Db,
  organizationId: string
) {
  return db
    .select({
      id: bankTransactions.id,
      bookingDate: bankTransactions.bookingDate,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      payerName: bankTransactions.payerName,
      reference: bankTransactions.reference,
      bankImportId: bankTransactions.bankImportId,
    })
    .from(bankTransactions)
    .leftJoin(
      paymentMatches,
      eq(paymentMatches.bankTransactionId, bankTransactions.id)
    )
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        isNull(paymentMatches.id)
      )
    )
    .orderBy(desc(bankTransactions.bookingDate));
}
