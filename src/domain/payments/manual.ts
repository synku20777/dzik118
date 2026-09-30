import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
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

    const nonReversed = existingMatches.find((m) => m.status !== "REVERSED");
    if (nonReversed) {
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

    const resultType =
      compareExact(transaction.amount, remaining) === 0
        ? "EXACT"
        : compareExact(transaction.amount, remaining) < 0
          ? "PARTIAL"
          : "OVERPAYMENT";
    const proposedAllocationAmount = minExact(transaction.amount, remaining);

    const [inserted] = await tx
      .insert(paymentMatches)
      .values({
        organizationId,
        bankTransactionId: transaction.id,
        invoiceId: invoice.id,
        matchType: "MANUAL",
        resultType,
        proposedAllocationAmount,
        status: "PROPOSED",
        confidence: null,
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

    return confirmMatch(
      tx as unknown as Db,
      organizationId,
      inserted.id,
      actorUserId
    );
  });
}

export interface RecordManualPaymentInput {
  invoiceId: string;
  amount: string;
  bookingDate: string;
  payerName?: string;
  reference: string;
  reason: string;
}

export async function recordManualPayment(
  db: Db,
  organizationId: string,
  input: RecordManualPaymentInput,
  actorUserId: string
) {
  if (!input.amount || !/^\d+(\.\d{1,2})?$/.test(input.amount)) {
    throw new ValidationError(
      "Enter a valid amount, for example 12.50. Use up to 2 decimal places."
    );
  }
  const normalizedAmount = addExact(input.amount, "0.00");
  if (compareExact(normalizedAmount, "0.00") <= 0) {
    throw new ValidationError("Amount must be greater than 0");
  }

  const parsedBookingDate = parseDateInput(input.bookingDate);
  if (!parsedBookingDate) {
    throw new ValidationError("Enter a valid booking date (YYYY-MM-DD)");
  }

  const cleanReference = input.reference?.trim() ?? "";
  if (cleanReference.length < 1 || cleanReference.length > 140) {
    throw new ValidationError("Reference must be between 1 and 140 characters");
  }

  const cleanPayerName =
    input.payerName !== undefined && input.payerName !== null
      ? input.payerName.trim()
      : undefined;
  if (cleanPayerName !== undefined && cleanPayerName.length > 140) {
    throw new ValidationError("Payer name must be up to 140 characters");
  }

  const cleanReason = input.reason?.trim() ?? "";
  if (cleanReason.length < 1 || cleanReason.length > 500) {
    throw new ValidationError("A reason is required (up to 500 characters)");
  }

  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) throw new NotFoundError("Organization not found");

    const today = orgLocalDateString(new Date(), org.timezone);
    if (parsedBookingDate > today) {
      throw new ValidationError("Booking date cannot be in the future");
    }

    const [invoice] = await tx
      .select({ id: invoices.id, currency: invoices.currency })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!invoice) throw new NotFoundError("Invoice not found");

    // Serialize identical submissions: the duplicate check below reads, then
    // inserts, so two concurrent requests could both pass it. The lock lasts
    // until this transaction ends.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`manual-payment:${organizationId}:${invoice.currency}:${normalizedAmount}:${parsedBookingDate}:${cleanReference.toLowerCase()}`}))`
    );

    const [existing] = await tx
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.organizationId, organizationId),
          eq(bankTransactions.currency, invoice.currency),
          eq(bankTransactions.amount, normalizedAmount),
          eq(bankTransactions.bookingDate, parsedBookingDate),
          sql`lower(trim(${bankTransactions.reference})) = ${cleanReference.toLowerCase()}`
        )
      )
      .limit(1);
    if (existing) {
      throw new ConflictError(
        "A payment with this reference, amount, and date already exists"
      );
    }

    const [bankImport] = await tx
      .insert(bankImports)
      .values({
        organizationId,
        originalFilename: "Manual entry",
        fileSha256: `manual:${randomUUID()}`,
        importedByUserId: actorUserId,
        rowCount: 1,
      })
      .returning();

    const [transaction] = await tx
      .insert(bankTransactions)
      .values({
        organizationId,
        bankImportId: bankImport.id,
        bookingDate: parsedBookingDate,
        amount: normalizedAmount,
        currency: invoice.currency,
        payerName: cleanPayerName ? cleanPayerName : null,
        reference: cleanReference,
        rawData: {
          source: "manual",
          reason: cleanReason,
          enteredByUserId: actorUserId,
        },
        rowNumber: 1,
      })
      .returning();

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "MANUAL_PAYMENT_RECORDED",
      entityType: "bank_transaction",
      entityId: transaction.id,
      afterData: {
        invoiceId: input.invoiceId,
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

export async function listOpenInvoicesForPayment(
  db: Db,
  organizationId: string
) {
  const rows = await db
    .select({
      id: invoices.id,
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
        isNull(invoices.paidAt),
        inArray(billingCases.status, ["PREPARED", "SENT", "OVERDUE"])
      )
    )
    .orderBy(asc(invoices.invoiceNumber));

  const result: Array<{
    id: string;
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
