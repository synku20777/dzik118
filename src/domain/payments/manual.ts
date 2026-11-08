import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { accountEntries } from "../../db/schema/accounts";
import { billingCases } from "../../db/schema/billing";
import { dwellings } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import { organizations } from "../../db/schema/organizations";
import {
  bankImports,
  bankTransactions,
  paymentMatches,
} from "../../db/schema/payments";
import { parseDateInput } from "../../lib/date-input";
import { isUniqueViolation } from "../../lib/db-errors";
import {
  addExact,
  compareExact,
  minExact,
  subtractExact,
} from "../../lib/decimal2";
import { recordAuditEvent } from "../../lib/logging/audit";
import { orgLocalDateString } from "../../lib/org-time";
import { getInvoiceAllocatedAmount } from "../accounts/ledger";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { confirmMatch } from "./matching";

export { ConflictError, NotFoundError, ValidationError };

export async function matchTransactionToInvoice(
  db: Db,
  organizationId: string,
  transactionId: string,
  invoiceId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [transaction] = await tx
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          eq(bankTransactions.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!transaction) throw new NotFoundError("Bank transaction not found");

    const existingMatches = await tx
      .select({
        id: paymentMatches.id,
        invoiceId: paymentMatches.invoiceId,
        status: paymentMatches.status,
      })
      .from(paymentMatches)
      .where(
        and(
          eq(paymentMatches.bankTransactionId, transactionId),
          eq(paymentMatches.organizationId, organizationId)
        )
      );

    // Posted straight to a dwelling account: it is already applied. Matching it
    // would credit the money a second time.
    if (transaction.appliedDwellingId) {
      throw new ConflictError(
        "This payment is already posted to a dwelling account"
      );
    }

    const activeMatch = existingMatches.find(
      (m) => m.status === "PROPOSED" || m.status === "CONFIRMED"
    );
    if (activeMatch) {
      throw new ConflictError("This payment is already matched");
    }

    const reversedForThisInvoice = existingMatches.find(
      (m) => m.status === "REVERSED" && m.invoiceId === invoiceId
    );
    if (reversedForThisInvoice) {
      throw new ConflictError(
        "This payment was reversed from this invoice. Choose a different invoice"
      );
    }

    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!invoice) throw new NotFoundError("Invoice not found");

    const [bCase] = await tx
      .select({ status: billingCases.status })
      .from(billingCases)
      .where(
        and(
          eq(billingCases.id, invoice.billingCaseId),
          eq(billingCases.organizationId, organizationId)
        )
      )
      .limit(1);

    const validCaseStatus =
      bCase && ["PREPARED", "SENT", "OVERDUE"].includes(bCase.status);
    if (
      invoice.currency !== transaction.currency ||
      invoice.paidAt !== null ||
      !validCaseStatus
    ) {
      throw new ConflictError("This invoice cannot receive a payment");
    }

    const allocated = await getInvoiceAllocatedAmount(
      tx,
      organizationId,
      invoice.id
    );
    const remaining = subtractExact(invoice.amountDue, allocated);
    if (compareExact(remaining, "0.00") <= 0) {
      throw new ConflictError("This invoice is already fully allocated");
    }

    const resultType: "EXACT" | "PARTIAL" | "OVERPAYMENT" =
      compareExact(transaction.amount, remaining) === 0
        ? "EXACT"
        : compareExact(transaction.amount, remaining) < 0
          ? "PARTIAL"
          : "OVERPAYMENT";
    const proposedAllocationAmount = minExact(transaction.amount, remaining);

    const rejected = existingMatches.find(
      (m) => m.status === "REJECTED" && m.invoiceId === invoice.id
    );
    const values = {
      organizationId,
      bankTransactionId: transaction.id,
      invoiceId: invoice.id,
      matchType: "MANUAL" as const,
      resultType,
      proposedAllocationAmount,
      status: "PROPOSED" as const,
      confidence: null,
    };
    const [inserted] = rejected
      ? await tx
          .update(paymentMatches)
          .set(values)
          .where(eq(paymentMatches.id, rejected.id))
          .returning()
      : await tx.insert(paymentMatches).values(values).returning();

    await recordAuditEvent(tx, {
      organizationId,
      scopeDwellingId: invoice.dwellingId,
      actorUserId,
      action: "PAYMENT_MATCH_PROPOSED",
      entityType: "payment_match",
      entityId: inserted.id,
      afterData: inserted,
    });

    return confirmMatch(
      tx as unknown as Db,
      organizationId,
      inserted.id,
      actorUserId
    );
  });
}

export type PaymentMethod = "BANK" | "CASH";

export interface PaymentFieldsInput {
  amount: string;
  bookingDate: string;
  payerName?: string;
  reference?: string;
  reason: string;
}

// Shared by the invoice payment, the dwelling payment and the edit of an
// unmatched row. A bank transfer needs its bank reference; cash may have none
// (or a receipt number).
export function cleanPaymentFields(
  input: PaymentFieldsInput,
  requireReference = true
) {
  // At most 12 whole digits: the column is numeric(14,2).
  if (!input.amount || !/^\d{1,12}(\.\d{1,2})?$/.test(input.amount)) {
    throw new ValidationError(
      "Enter a valid amount, for example 12.50. Use up to 2 decimal places."
    );
  }
  const amount = addExact(input.amount, "0.00");
  if (compareExact(amount, "0.00") <= 0) {
    throw new ValidationError("Amount must be greater than 0");
  }

  const bookingDate = parseDateInput(input.bookingDate);
  if (!bookingDate) {
    throw new ValidationError("Enter a valid booking date (YYYY-MM-DD)");
  }

  const reference = input.reference?.trim() ?? "";
  if (reference.length > 140 || (requireReference && reference.length < 1)) {
    throw new ValidationError("Reference must be between 1 and 140 characters");
  }

  const payerName =
    input.payerName !== undefined && input.payerName !== null
      ? input.payerName.trim()
      : undefined;
  if (payerName !== undefined && payerName.length > 140) {
    throw new ValidationError("Payer name must be up to 140 characters");
  }

  const reason = input.reason?.trim() ?? "";
  if (reason.length < 1 || reason.length > 500) {
    throw new ValidationError("A reason is required (up to 500 characters)");
  }

  return { amount, bookingDate, reference, payerName, reason };
}

export async function assertBookingDateNotFuture(
  tx: DbOrTx,
  organizationId: string,
  bookingDate: string
) {
  const [org] = await tx
    .select({
      timezone: organizations.timezone,
      currency: organizations.currency,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new NotFoundError("Organization not found");
  if (bookingDate > orgLocalDateString(new Date(), org.timezone)) {
    throw new ValidationError("Booking date cannot be in the future");
  }
  return org;
}

export interface RecordManualPaymentInput {
  invoiceId: string;
  amount: string;
  bookingDate: string;
  payerName?: string;
  reference?: string;
  reason: string;
  method?: PaymentMethod;
  // One per rendered form. A second submit of the same form (double click,
  // reload after POST) carries the same id and is refused.
  submissionId?: string;
}

// Stops a repeat of the same form. The id lives in the unique file hash of the
// synthetic "Manual entry" import.
export function manualImportHash(submissionId: string | undefined) {
  return `manual:${submissionId ?? randomUUID()}`;
}

export const PAYMENT_ALREADY_RECORDED_MESSAGE =
  "This payment was already recorded";

// BANK only: the same bank reference, amount and date is almost surely a repeat.
// Two cash payments of the same amount on one day are normal, so cash relies on
// the submission id alone.
export async function assertNoDuplicateBankPayment(
  tx: DbOrTx,
  organizationId: string,
  fields: {
    currency: string;
    amount: string;
    bookingDate: string;
    reference: string;
    // The row being edited does not count as its own duplicate.
    excludeId?: string;
  }
) {
  // Serialize identical submissions: the check below reads, then the caller
  // inserts, so two concurrent requests could both pass it. The lock lasts
  // until this transaction ends. Callers take it before any dwelling or
  // invoice lock, so the lock order is the same everywhere.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`manual-payment:${organizationId}:${fields.currency}:${fields.amount}:${fields.bookingDate}:${fields.reference.toLowerCase()}`}))`
  );
  const [existing] = await tx
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        eq(bankTransactions.currency, fields.currency),
        eq(bankTransactions.amount, fields.amount),
        eq(bankTransactions.bookingDate, fields.bookingDate),
        sql`lower(trim(${bankTransactions.reference})) = ${fields.reference.toLowerCase()}`,
        fields.excludeId
          ? ne(bankTransactions.id, fields.excludeId)
          : undefined,
        // A payment reversed off a dwelling account is gone: typing it in again
        // for the right dwelling must not look like a repeat.
        sql`not exists (
          select 1 from ${accountEntries}
          where ${accountEntries.bankTransactionId} = ${bankTransactions.id}
            and ${accountEntries.type} = 'PAYMENT_REVERSAL'
            and ${accountEntries.invoiceId} is null
        )`
      )
    )
    .limit(1);
  if (existing) {
    throw new ConflictError(
      "A payment with this reference, amount, and date already exists"
    );
  }
}

// Inserts the synthetic import and the transaction row of a typed-in payment.
export async function insertManualTransaction(
  tx: DbOrTx,
  input: {
    organizationId: string;
    actorUserId: string;
    submissionId: string | undefined;
    method: PaymentMethod;
    currency: string;
    amount: string;
    bookingDate: string;
    payerName: string | undefined;
    reference: string;
    reason: string;
    appliedDwellingId?: string;
  }
) {
  let bankImport;
  try {
    // The caller's transaction rolls back when this throws.
    [bankImport] = await tx
      .insert(bankImports)
      .values({
        organizationId: input.organizationId,
        originalFilename: "Manual entry",
        fileSha256: manualImportHash(input.submissionId),
        importedByUserId: input.actorUserId,
        rowCount: 1,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(PAYMENT_ALREADY_RECORDED_MESSAGE);
    }
    throw err;
  }

  const [transaction] = await tx
    .insert(bankTransactions)
    .values({
      organizationId: input.organizationId,
      bankImportId: bankImport.id,
      bookingDate: input.bookingDate,
      amount: input.amount,
      currency: input.currency,
      payerName: input.payerName ? input.payerName : null,
      reference: input.reference ? input.reference : null,
      paymentMethod: input.method,
      appliedDwellingId: input.appliedDwellingId ?? null,
      rawData: {
        source: "manual",
        method: input.method,
        reason: input.reason,
        enteredByUserId: input.actorUserId,
      },
      rowNumber: 1,
    })
    .returning();
  return transaction;
}

export async function recordManualPayment(
  db: Db,
  organizationId: string,
  input: RecordManualPaymentInput,
  actorUserId: string
) {
  const method = input.method ?? "BANK";
  const fields = cleanPaymentFields(input, method === "BANK");
  const {
    amount: normalizedAmount,
    bookingDate: parsedBookingDate,
    reference: cleanReference,
    payerName: cleanPayerName,
    reason: cleanReason,
  } = fields;

  return db.transaction(async (tx) => {
    await assertBookingDateNotFuture(tx, organizationId, parsedBookingDate);

    const [invoice] = await tx
      .select({
        id: invoices.id,
        currency: invoices.currency,
        dwellingId: invoices.dwellingId,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!invoice) throw new NotFoundError("Invoice not found");

    if (method === "BANK") {
      await assertNoDuplicateBankPayment(tx, organizationId, {
        currency: invoice.currency,
        amount: normalizedAmount,
        bookingDate: parsedBookingDate,
        reference: cleanReference,
      });
    }

    const transaction = await insertManualTransaction(tx, {
      organizationId,
      actorUserId,
      submissionId: input.submissionId,
      method,
      currency: invoice.currency,
      amount: normalizedAmount,
      bookingDate: parsedBookingDate,
      payerName: cleanPayerName,
      reference: cleanReference,
      reason: cleanReason,
    });

    await recordAuditEvent(tx, {
      organizationId,
      scopeDwellingId: invoice.dwellingId,
      actorUserId,
      action: "MANUAL_PAYMENT_RECORDED",
      entityType: "bank_transaction",
      entityId: transaction.id,
      afterData: {
        invoiceId: input.invoiceId,
        method,
        amount: normalizedAmount,
        bookingDate: parsedBookingDate,
        reference: cleanReference,
        reason: cleanReason,
      },
    });

    return matchTransactionToInvoice(
      tx as unknown as Db,
      organizationId,
      transaction.id,
      input.invoiceId,
      actorUserId
    );
  });
}

export interface EditUnmatchedInput {
  amount: string;
  bookingDate: string;
  payerName?: string;
  reference?: string;
  reason: string;
}

// Fixes a statement row the parser read wrongly, before it is matched. A row
// with an active match or posted to a dwelling account cannot be edited. The
// currency and the imported raw data never change; the audit event
// keeps the old values.
export async function updateUnmatchedTransaction(
  db: Db,
  organizationId: string,
  transactionId: string,
  input: EditUnmatchedInput,
  actorUserId: string
) {
  const fields = cleanPaymentFields(input, false);

  return db.transaction(async (tx) => {
    await assertBookingDateNotFuture(tx, organizationId, fields.bookingDate);

    const [before] = await tx
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          eq(bankTransactions.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!before) throw new NotFoundError("Bank transaction not found");

    const [activeMatch] = await tx
      .select({ id: paymentMatches.id })
      .from(paymentMatches)
      .where(
        and(
          eq(paymentMatches.bankTransactionId, transactionId),
          eq(paymentMatches.organizationId, organizationId),
          inArray(paymentMatches.status, ["PROPOSED", "CONFIRMED"])
        )
      )
      .limit(1);
    if (activeMatch || before.appliedDwellingId) {
      throw new ConflictError("Only an unmatched payment can be edited");
    }

    // A reference the statement gave cannot be erased. Rows that came without
    // one stay editable.
    if (before.reference && !fields.reference) {
      throw new ValidationError(
        "Reference must be between 1 and 140 characters"
      );
    }
    // Same refusal as typing in a repeat of a bank payment. Only when the
    // identity changes: a statement can hold two identical rows.
    const identityChanged =
      before.amount !== fields.amount ||
      before.bookingDate !== fields.bookingDate ||
      (before.reference ?? "").trim().toLowerCase() !==
        fields.reference.toLowerCase();
    if (
      before.paymentMethod === "BANK" &&
      fields.reference &&
      identityChanged
    ) {
      await assertNoDuplicateBankPayment(tx, organizationId, {
        currency: before.currency,
        amount: fields.amount,
        bookingDate: fields.bookingDate,
        reference: fields.reference,
        excludeId: before.id,
      });
    }

    const [after] = await tx
      .update(bankTransactions)
      .set({
        amount: fields.amount,
        bookingDate: fields.bookingDate,
        payerName: fields.payerName ? fields.payerName : null,
        reference: fields.reference ? fields.reference : null,
      })
      .where(eq(bankTransactions.id, transactionId))
      .returning();

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "BANK_TRANSACTION_EDITED",
      entityType: "bank_transaction",
      entityId: transactionId,
      beforeData: {
        amount: before.amount,
        bookingDate: before.bookingDate,
        payerName: before.payerName,
        reference: before.reference,
      },
      afterData: {
        amount: after.amount,
        bookingDate: after.bookingDate,
        payerName: after.payerName,
        reference: after.reference,
        reason: fields.reason,
      },
    });
    return after;
  });
}

export async function listOpenInvoicesForPayment(
  db: Db,
  organizationId: string,
  dwellingId?: string
) {
  const rows = await db
    .select({
      id: invoices.id,
      dwellingId: invoices.dwellingId,
      invoiceNumber: invoices.invoiceNumber,
      dwellingNumber: dwellings.number,
      currency: invoices.currency,
      amountDue: invoices.amountDue,
    })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .innerJoin(dwellings, eq(dwellings.id, invoices.dwellingId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        dwellingId ? eq(invoices.dwellingId, dwellingId) : undefined,
        isNull(invoices.paidAt),
        inArray(billingCases.status, ["PREPARED", "SENT", "OVERDUE"])
      )
    )
    .orderBy(asc(invoices.invoiceNumber));

  const result: Array<{
    id: string;
    dwellingId: string;
    invoiceNumber: string;
    dwellingNumber: string;
    currency: string;
    amountDue: string;
    remaining: string;
  }> = [];

  for (const row of rows) {
    const allocated = await getInvoiceAllocatedAmount(
      db,
      organizationId,
      row.id
    );
    const remaining = subtractExact(row.amountDue, allocated);
    if (compareExact(remaining, "0.00") > 0) {
      result.push({
        id: row.id,
        dwellingId: row.dwellingId,
        invoiceNumber: row.invoiceNumber,
        dwellingNumber: row.dwellingNumber,
        currency: row.currency,
        amountDue: row.amountDue,
        remaining,
      });
    }
  }

  return result;
}
