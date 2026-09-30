import { and, eq, gt, gte, ne } from "drizzle-orm";
import type { Db } from "../../db/client";
import { paymentReversals } from "../../db/schema/accounts";
import { billingCases } from "../../db/schema/billing";
import { invoices } from "../../db/schema/invoices";
import { organizations } from "../../db/schema/organizations";
import { bankTransactions, paymentMatches } from "../../db/schema/payments";
import { compareExact, maxExact, subtractExact } from "../../lib/decimal2";
import { recordAuditEvent } from "../../lib/logging/audit";
import { orgLocalDateString } from "../../lib/org-time";
import { postAccountEntry } from "../accounts/ledger";
import { ConflictError, NotFoundError, ValidationError } from "../errors";

export { ConflictError, NotFoundError, ValidationError };

export async function reversePayment(
  db: Db,
  organizationId: string,
  matchId: string,
  reason: string,
  actorUserId: string
) {
  const cleanReason = reason.trim();
  if (!cleanReason || cleanReason.length > 500) {
    throw new ValidationError("A reason is required (up to 500 characters)");
  }

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
    if (match.status === "REVERSED") return match;
    if (match.status !== "CONFIRMED") {
      throw new ConflictError("Only a confirmed payment can be reversed");
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

    // Invoice generation locks the organization row too. Holding it here
    // stops a new invoice from taking this payment's credit while we check.
    const [org] = await tx
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for("update")
      .limit(1);
    if (!org) throw new NotFoundError("Organization not found");
    const allocation = match.proposedAllocationAmount;
    const credit = maxExact(
      subtractExact(transaction.amount, allocation),
      "0.00"
    );

    if (compareExact(credit, "0.00") > 0 && match.confirmedAt) {
      const [usedInvoice] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            eq(invoices.dwellingId, invoice.dwellingId),
            eq(invoices.currency, invoice.currency),
            ne(invoices.id, invoice.id),
            gte(invoices.updatedAt, match.confirmedAt),
            gt(invoices.previousCreditApplied, "0")
          )
        )
        .limit(1);
      if (usedInvoice) {
        throw new ConflictError(
          "The credit from this payment was already used on a later invoice. Fix the balance with an adjustment"
        );
      }
    }

    const effectiveDate = orgLocalDateString(new Date(), org.timezone);

    await postAccountEntry(tx, {
      organizationId,
      dwellingId: invoice.dwellingId,
      effectiveDate,
      type: "PAYMENT_REVERSAL",
      debit: transaction.amount,
      credit: "0.00",
      currency: transaction.currency,
      invoiceId: invoice.id,
      bankTransactionId: transaction.id,
      reason: cleanReason,
      description: `Reversal of bank payment ${transaction.reference ?? transaction.id}`,
      actorUserId,
      metadata: {
        paymentMatchId: matchId,
        allocationAmount: allocation,
        creditAmount: credit,
      },
      idempotencyKey: `payment-match:${matchId}:reversal`,
    });

    await tx.insert(paymentReversals).values({
      organizationId,
      dwellingId: invoice.dwellingId,
      paymentMatchId: matchId,
      bankTransactionId: transaction.id,
      invoiceId: invoice.id,
      reversedAllocationAmount: allocation,
      reversedCreditAmount: credit,
      reason: cleanReason,
      actorUserId,
    });

    const [updatedMatch] = await tx
      .update(paymentMatches)
      .set({ status: "REVERSED" })
      .where(eq(paymentMatches.id, matchId))
      .returning();

    if (invoice.paidAt) {
      await tx
        .update(invoices)
        .set({ paidAt: null, updatedAt: new Date() })
        .where(eq(invoices.id, invoice.id));

      const orgToday = orgLocalDateString(new Date(), org.timezone);
      const caseStatus = invoice.dueDate < orgToday ? "OVERDUE" : "SENT";

      await tx
        .update(billingCases)
        .set({
          status: caseStatus,
          statusUpdatedAt: new Date(),
        })
        .where(eq(billingCases.id, invoice.billingCaseId));
    }

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "PAYMENT_REVERSED",
      entityType: "payment_match",
      entityId: matchId,
      beforeData: match,
      afterData: {
        status: "REVERSED",
        reason: cleanReason,
        allocation,
        credit,
      },
    });

    return updatedMatch;
  });
}
