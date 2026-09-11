// Phase J (Payments) - payment match lifecycle (spec Section 25,
// PAY-002/003). Callers must call requireOrganizationAccess() before
// calling any of these (spec Section 14).
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { billingCases } from "../../db/schema/billing";
import { invoices } from "../../db/schema/invoices";
import {
  bankTransactions,
  paymentMatchStatusEnum,
  paymentMatches,
} from "../../db/schema/payments";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError, NotFoundError } from "../errors";

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

// Spec Section 25 exact-match rule: currency equals invoice currency;
// amount equals invoice total exactly; normalized reference contains the
// exact invoice number; invoice is not paid; transaction has no confirmed
// payment match. Ambiguous cases (zero or more than one candidate
// invoice) are left unmatched rather than guessed at -- this only ever
// proposes, never auto-confirms (spec: "admin confirms proposal").
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

  // Invoices already claimed by a live (non-rejected) match, in this
  // import or any earlier one -- an invoice can be proposed for at most
  // one transaction at a time, otherwise two transactions could each be
  // confirmed against the same invoice.
  const claimedRows = await db
    .select({ invoiceId: paymentMatches.invoiceId })
    .from(paymentMatches)
    .where(
      and(
        eq(paymentMatches.organizationId, organizationId),
        inArray(paymentMatches.status, ["PROPOSED", "CONFIRMED"])
      )
    );
  const claimedInvoiceIds = new Set(claimedRows.map((r) => r.invoiceId));

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
      .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.currency, txn.currency),
          eq(invoices.total, txn.amount),
          isNull(invoices.paidAt)
        )
      );

    const normalizedReference = normalizeForMatch(txn.reference);
    const matching = candidates.filter(
      (invoice) =>
        !claimedInvoiceIds.has(invoice.id) &&
        normalizedReference.includes(normalizeForMatch(invoice.invoiceNumber))
    );
    if (matching.length !== 1) continue;

    // Insert + audit as one unit -- an audit write failing after a bare
    // insert would leave a proposal with no audit trail, and a rerun's
    // existingMatches check above would then skip it forever.
    const match = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(paymentMatches)
        .values({
          organizationId,
          bankTransactionId: txn.id,
          invoiceId: matching[0].id,
          matchType: "AUTO_EXACT",
          status: "PROPOSED",
          confidence: "1.0000",
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
    claimedInvoiceIds.add(match.invoiceId);
    proposed++;
  }

  return { proposed };
}

// PAY-003. Idempotent: confirming an already-confirmed match is a no-op
// returning its current state (spec: "repeat idempotent").
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
    // match.status is PROPOSED at this point (CONFIRMED/REJECTED already
    // returned/threw above), so a paid invoice here was paid by a
    // *different* match -- without this, a second transaction proposed
    // against the same invoice could be confirmed too, double-recording
    // payment for one invoice.
    if (invoice.paidAt) {
      throw new ConflictError("This invoice already has a confirmed payment");
    }

    const [confirmed] = await tx
      .update(paymentMatches)
      .set({
        status: "CONFIRMED",
        confirmedByUserId: actorUserId,
        confirmedAt: new Date(),
      })
      .where(eq(paymentMatches.id, matchId))
      .returning();
    await tx
      .update(invoices)
      .set({ paidAt: new Date(), updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id));
    await tx
      .update(billingCases)
      .set({ status: "PAID", statusUpdatedAt: new Date() })
      .where(eq(billingCases.id, invoice.billingCaseId));
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "PAYMENT_MATCH_CONFIRMED",
      entityType: "payment_match",
      entityId: matchId,
      afterData: confirmed,
    });

    return confirmed;
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
  return db
    .select({
      id: paymentMatches.id,
      status: paymentMatches.status,
      matchType: paymentMatches.matchType,
      confirmedAt: paymentMatches.confirmedAt,
      createdAt: paymentMatches.createdAt,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceTotal: invoices.total,
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
