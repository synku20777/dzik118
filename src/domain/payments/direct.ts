// A payment posted straight to a dwelling account, with no invoice (ADR 0014).
// For money that has no open invoice to land on: an advance payment, or the
// opening debt from the Migration Center, which has no invoice at all. The
// ledger credit is the whole effect. The next invoice carries the balance.
import { and, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { accountEntries } from "../../db/schema/accounts";
import { billingCases } from "../../db/schema/billing";
import { dwellings } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import { organizations } from "../../db/schema/organizations";
import { bankTransactions } from "../../db/schema/payments";
import { compareExact, subtractExact } from "../../lib/decimal2";
import { recordAuditEvent } from "../../lib/logging/audit";
import { orgLocalDateString } from "../../lib/org-time";
import {
  PAYABLE_CASE_STATUSES,
  getInvoiceAllocatedAmount,
  postAccountEntry,
} from "../accounts/ledger";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  assertBookingDateNotFuture,
  assertNoDuplicateBankPayment,
  cleanPaymentFields,
  insertManualTransaction,
  type PaymentMethod,
} from "./manual";

export { ConflictError, NotFoundError, ValidationError };

export interface RecordDwellingPaymentInput {
  dwellingId: string;
  amount: string;
  bookingDate: string;
  method: PaymentMethod;
  payerName?: string;
  reference?: string;
  reason: string;
  submissionId?: string;
}

export const OPEN_INVOICE_MESSAGE =
  "This dwelling has an open invoice. Apply the payment to that invoice";
export const ONLY_DIRECT_REVERSAL_MESSAGE =
  "Only a payment posted to a dwelling account can be reversed here";
export const CREDIT_USED_MESSAGE =
  "The credit from this payment was already used on a later invoice. Fix the balance with an adjustment";

// An open invoice has frozen its balance at preparation and takes payments only
// by allocation. A dwelling credit posted next to it would count twice.
async function hasOpenInvoice(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string,
  currency: string
) {
  const rows = await tx
    .select({ id: invoices.id, amountDue: invoices.amountDue })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.dwellingId, dwellingId),
        eq(invoices.currency, currency),
        isNull(invoices.paidAt),
        inArray(billingCases.status, PAYABLE_CASE_STATUSES)
      )
    );
  for (const row of rows) {
    const allocated = await getInvoiceAllocatedAmount(
      tx,
      organizationId,
      row.id
    );
    if (compareExact(subtractExact(row.amountDue, allocated), "0.00") > 0) {
      return true;
    }
  }
  return false;
}

export async function recordDwellingPayment(
  db: Db,
  organizationId: string,
  input: RecordDwellingPaymentInput,
  actorUserId: string
) {
  const fields = cleanPaymentFields(input, input.method === "BANK");

  return db.transaction(async (tx) => {
    const org = await assertBookingDateNotFuture(
      tx,
      organizationId,
      fields.bookingDate
    );

    // First, like the invoice payment: every path takes this lock before any
    // dwelling or invoice lock, so no three-way wait with prepareInvoice.
    if (input.method === "BANK") {
      await assertNoDuplicateBankPayment(tx, organizationId, {
        currency: org.currency,
        amount: fields.amount,
        bookingDate: fields.bookingDate,
        reference: fields.reference,
      });
    }

    // The same lock prepareInvoice, the opening balance import and the
    // reversal take. A preparation that wins sees this credit in the balance.
    // If this payment wins, the invoice check below sees the prepared invoice.
    const [dwelling] = await tx
      .select({ id: dwellings.id })
      .from(dwellings)
      .where(
        and(
          eq(dwellings.id, input.dwellingId),
          eq(dwellings.organizationId, organizationId)
        )
      )
      .for("no key update")
      .limit(1);
    if (!dwelling) throw new NotFoundError("Dwelling not found");

    if (await hasOpenInvoice(tx, organizationId, dwelling.id, org.currency)) {
      throw new ConflictError(OPEN_INVOICE_MESSAGE);
    }

    const transaction = await insertManualTransaction(tx, {
      organizationId,
      actorUserId,
      submissionId: input.submissionId,
      method: input.method,
      currency: org.currency,
      amount: fields.amount,
      bookingDate: fields.bookingDate,
      payerName: fields.payerName,
      reference: fields.reference,
      reason: fields.reason,
      appliedDwellingId: dwelling.id,
    });

    const label = input.method === "CASH" ? "Cash" : "Bank";
    await postAccountEntry(tx, {
      organizationId,
      dwellingId: dwelling.id,
      effectiveDate: fields.bookingDate,
      type: "PAYMENT",
      debit: "0.00",
      credit: fields.amount,
      currency: org.currency,
      bankTransactionId: transaction.id,
      reason: fields.reason,
      description: `${label} payment ${fields.reference || transaction.id}`,
      actorUserId,
      metadata: { method: input.method, direct: true },
      idempotencyKey: `bank-transaction:${transaction.id}:direct-payment`,
    });

    await recordAuditEvent(tx, {
      organizationId,
      scopeDwellingId: dwelling.id,
      actorUserId,
      action: "DWELLING_PAYMENT_RECORDED",
      entityType: "bank_transaction",
      entityId: transaction.id,
      afterData: {
        method: input.method,
        amount: fields.amount,
        bookingDate: fields.bookingDate,
        reference: fields.reference,
        reason: fields.reason,
      },
    });
    return transaction;
  });
}

// One reversal per payment: the idempotency key is unique, and the dwelling
// lock serializes two admins. The original entry stays; a full debit cancels it.
export async function reverseDwellingPayment(
  db: Db,
  organizationId: string,
  transactionId: string,
  reason: string,
  actorUserId: string
) {
  const cleanReason = reason.trim();
  if (!cleanReason || cleanReason.length > 500) {
    throw new ValidationError("A reason is required (up to 500 characters)");
  }

  return db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ dwellingId: bankTransactions.appliedDwellingId })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          eq(bankTransactions.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!peek) throw new NotFoundError("Bank transaction not found");
    if (!peek.dwellingId) throw new ConflictError(ONLY_DIRECT_REVERSAL_MESSAGE);

    const [org] = await tx
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) throw new NotFoundError("Organization not found");

    await tx
      .select({ id: dwellings.id })
      .from(dwellings)
      .where(eq(dwellings.id, peek.dwellingId))
      .for("no key update");

    const entries = await tx
      .select()
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.organizationId, organizationId),
          eq(accountEntries.bankTransactionId, transactionId),
          isNull(accountEntries.invoiceId)
        )
      );
    const payment = entries.find((e) => e.type === "PAYMENT");
    if (!payment) throw new NotFoundError("Bank transaction not found");
    if (entries.some((e) => e.type === "PAYMENT_REVERSAL")) {
      return payment; // already reversed
    }

    // A later invoice may have used this credit. Reversing now would restore
    // debt that invoice already wrote off. Same rule as the invoice reversal.
    const [usedInvoice] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.dwellingId, peek.dwellingId),
          eq(invoices.currency, payment.currency),
          gte(invoices.updatedAt, payment.createdAt),
          gt(invoices.previousCreditApplied, "0")
        )
      )
      .limit(1);
    if (usedInvoice) throw new ConflictError(CREDIT_USED_MESSAGE);

    const reversal = await postAccountEntry(tx, {
      organizationId,
      dwellingId: peek.dwellingId,
      effectiveDate: orgLocalDateString(new Date(), org.timezone),
      type: "PAYMENT_REVERSAL",
      debit: payment.credit,
      credit: "0.00",
      currency: payment.currency,
      bankTransactionId: transactionId,
      reason: cleanReason,
      description: `Reversal of ${payment.description}`,
      actorUserId,
      metadata: { reversesAccountEntryId: payment.id, direct: true },
      idempotencyKey: `bank-transaction:${transactionId}:direct-reversal`,
    });

    await recordAuditEvent(tx, {
      organizationId,
      scopeDwellingId: peek.dwellingId,
      actorUserId,
      action: "DWELLING_PAYMENT_REVERSED",
      entityType: "bank_transaction",
      entityId: transactionId,
      afterData: { amount: payment.credit, reason: cleanReason },
    });
    return reversal;
  });
}

export async function listDwellingPayments(
  db: Db,
  organizationId: string,
  dwellingId?: string
) {
  return db
    .select({
      id: bankTransactions.id,
      dwellingId: dwellings.id,
      dwellingNumber: dwellings.number,
      bookingDate: bankTransactions.bookingDate,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      payerName: bankTransactions.payerName,
      reference: bankTransactions.reference,
      paymentMethod: bankTransactions.paymentMethod,
      reversed: sql<boolean>`exists (
        select 1 from ${accountEntries}
        where ${accountEntries.bankTransactionId} = ${bankTransactions.id}
          and ${accountEntries.type} = 'PAYMENT_REVERSAL'
          and ${accountEntries.invoiceId} is null
      )`,
    })
    .from(bankTransactions)
    .innerJoin(dwellings, eq(dwellings.id, bankTransactions.appliedDwellingId))
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        eq(dwellings.organizationId, organizationId),
        dwellingId ? eq(dwellings.id, dwellingId) : undefined
      )
    )
    .orderBy(desc(bankTransactions.bookingDate));
}
