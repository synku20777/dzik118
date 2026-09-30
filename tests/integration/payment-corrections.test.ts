import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createPeriod } from "../../src/domain/periods/periods";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import { importBankCsv } from "../../src/domain/payments/bank-import";
import {
  confirmMatch,
  listPaymentMatches,
  listUnmatchedTransactions,
} from "../../src/domain/payments/matching";
import { reversePayment } from "../../src/domain/payments/reversal";
import {
  getDwellingAccountBalance,
  getInvoiceAllocatedAmount,
} from "../../src/domain/accounts/ledger";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../src/domain/errors";
import { orgLocalDateString } from "../../src/lib/org-time";
import { accountEntries, paymentReversals } from "../../src/db/schema/accounts";
import { billingCases } from "../../src/db/schema/billing";
import { invoices } from "../../src/db/schema/invoices";
import { paymentMatches } from "../../src/db/schema/payments";
import { auditLogs } from "../../src/db/schema/audit";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(
    db,
    "it-payment-corrections-admin@example.com"
  );
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

async function setupOrgWithInvoice(name: string, month: number) {
  const org = await createOrganization(
    db,
    {
      name,
      addressLine1: "Addr 1",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    seedAdminId
  );
  const dwelling = await createDwelling(
    db,
    org.id,
    { number: "1", occupantName: "Jane Doe", billingAddress: "1 Test St" },
    seedAdminId
  );
  const period = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month,
      startsOn: `2026-${String(month).padStart(2, "0")}-01`,
      endsOn: `2026-${String(month).padStart(2, "0")}-28`,
      invoiceIssueDate: `2026-${String(month).padStart(2, "0")}-28`,
      invoiceDueDate: `2026-${String(Math.min(month + 1, 12)).padStart(2, "0")}-14`,
    },
    seedAdminId
  );
  await createRule(
    db,
    org.id,
    {
      name: "Fee",
      code: "fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "50.00",
      effectiveFrom: "2025-01-01",
    },
    seedAdminId
  );
  const generated = await generateInvoice(
    db,
    org.id,
    period.id,
    dwelling.id,
    seedAdminId
  );
  const invoice = await prepareInvoice(db, org.id, generated.id, seedAdminId);
  return { org, dwelling, period, invoice };
}

describe("payment reversal (Scope P)", () => {
  it("exact payment reversal restores invoice, case status, balances, and unmatched transaction", async () => {
    const { org, dwelling, invoice } = await setupOrgWithInvoice(
      "IT-P Exact Reversal",
      1
    );

    const initialBalance = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );

    const csv = [
      "booking_date,amount,currency,reference",
      `2026-01-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "exact.csv", csv, seedAdminId);

    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(proposedMatch.resultType).toBe("EXACT");

    const confirmed = await confirmMatch(
      db,
      org.id,
      proposedMatch.id,
      seedAdminId
    );
    expect(confirmed.status).toBe("CONFIRMED");

    const reversed = await reversePayment(
      db,
      org.id,
      proposedMatch.id,
      "Administrative reversal",
      seedAdminId
    );
    expect(reversed.status).toBe("REVERSED");

    // 1. invoice paidAt is null
    const [inv] = await db
      .select({ paidAt: invoices.paidAt })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(inv.paidAt).toBeNull();

    // 2. case status is SENT (or OVERDUE when the due date is past)
    const orgToday = orgLocalDateString(new Date(), org.timezone);
    const expectedStatus = invoice.dueDate < orgToday ? "OVERDUE" : "SENT";
    const [caseRow] = await db
      .select({ status: billingCases.status })
      .from(billingCases)
      .where(eq(billingCases.id, invoice.billingCaseId));
    expect(caseRow.status).toBe(expectedStatus);

    // 3. getInvoiceAllocatedAmount is "0.00"
    const allocated = await getInvoiceAllocatedAmount(db, org.id, invoice.id);
    expect(allocated).toBe("0.00");

    // 4. match status REVERSED
    const [matchRow] = await db
      .select({ status: paymentMatches.status })
      .from(paymentMatches)
      .where(eq(paymentMatches.id, proposedMatch.id));
    expect(matchRow.status).toBe("REVERSED");

    // 5. getDwellingAccountBalance equals balance before payment
    const finalBalance = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );
    expect(finalBalance).toBe(initialBalance);

    // 6. listUnmatchedTransactions contains the transaction again
    const unmatched = await listUnmatchedTransactions(db, org.id);
    expect(unmatched.some((t) => t.id === proposedMatch.transactionId)).toBe(
      true
    );

    // 7. an account entry of type PAYMENT_REVERSAL exists
    const reversalEntries = await db
      .select()
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.organizationId, org.id),
          eq(accountEntries.type, "PAYMENT_REVERSAL")
        )
      );
    expect(reversalEntries).toHaveLength(1);
    expect(reversalEntries[0].debit).toBe(invoice.total);
    expect(reversalEntries[0].credit).toBe("0.00");
    expect(reversalEntries[0].bankTransactionId).toBe(
      proposedMatch.transactionId
    );

    // 8. an audit row PAYMENT_REVERSED exists
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.id),
          eq(auditLogs.action, "PAYMENT_REVERSED")
        )
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entityId).toBe(proposedMatch.id);

    await cleanupOrg(org.id);
  });

  it("partial payment reversal returns allocated amount to 0.00, keeps invoice unpaid, and status unchanged", async () => {
    const { org, invoice } = await setupOrgWithInvoice(
      "IT-P Partial Reversal",
      2
    );

    const [initialCase] = await db
      .select({ status: billingCases.status })
      .from(billingCases)
      .where(eq(billingCases.id, invoice.billingCaseId));
    expect(initialCase.status).toBe("PREPARED");

    const partialAmount = "20.00";
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-02-15,${partialAmount},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "partial.csv", csv, seedAdminId);

    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(proposedMatch.resultType).toBe("PARTIAL");

    await confirmMatch(db, org.id, proposedMatch.id, seedAdminId);

    const allocatedBefore = await getInvoiceAllocatedAmount(
      db,
      org.id,
      invoice.id
    );
    expect(allocatedBefore).toBe(partialAmount);

    await reversePayment(
      db,
      org.id,
      proposedMatch.id,
      "Partial payment entered in error",
      seedAdminId
    );

    // 1. allocated amount returns to "0.00"
    const allocatedAfter = await getInvoiceAllocatedAmount(
      db,
      org.id,
      invoice.id
    );
    expect(allocatedAfter).toBe("0.00");

    // 2. invoice stays unpaid
    const [inv] = await db
      .select({ paidAt: invoices.paidAt })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(inv.paidAt).toBeNull();

    // 3. status unchanged
    const [caseAfter] = await db
      .select({ status: billingCases.status })
      .from(billingCases)
      .where(eq(billingCases.id, invoice.billingCaseId));
    expect(caseAfter.status).toBe(initialCase.status);

    await cleanupOrg(org.id);
  });

  it("overpayment reversal removes credit and restores dwelling account balance", async () => {
    const { org, dwelling, invoice } = await setupOrgWithInvoice(
      "IT-P Overpayment Reversal",
      3
    );

    const initialBalance = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );

    const overpaymentAmount = "80.00";
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-03-15,${overpaymentAmount},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "overpay.csv", csv, seedAdminId);

    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(proposedMatch.resultType).toBe("OVERPAYMENT");

    await confirmMatch(db, org.id, proposedMatch.id, seedAdminId);

    const balanceDuringCredit = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );
    expect(Number(balanceDuringCredit)).toBeLessThan(Number(initialBalance));

    await reversePayment(
      db,
      org.id,
      proposedMatch.id,
      "Overpayment cancellation",
      seedAdminId
    );

    const finalBalance = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );
    expect(finalBalance).toBe(initialBalance);

    await cleanupOrg(org.id);
  });

  it("refuses reversal when overpayment credit was already used on a later invoice", async () => {
    const { org, dwelling, invoice } = await setupOrgWithInvoice(
      "IT-P Credit Used",
      4
    );

    const overpaymentAmount = "80.00";
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-04-15,${overpaymentAmount},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "overpay.csv", csv, seedAdminId);

    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");
    const confirmedMatch = await confirmMatch(
      db,
      org.id,
      proposedMatch.id,
      seedAdminId
    );

    const period2 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 5,
        startsOn: "2026-05-01",
        endsOn: "2026-05-31",
        invoiceIssueDate: "2026-05-31",
        invoiceDueDate: "2026-06-14",
      },
      seedAdminId
    );
    const gen2 = await generateInvoice(
      db,
      org.id,
      period2.id,
      dwelling.id,
      seedAdminId
    );
    const inv2 = await prepareInvoice(db, org.id, gen2.id, seedAdminId);

    const balanceBeforeAttempt = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );

    const laterPreparedAt = new Date(
      confirmedMatch.confirmedAt!.getTime() + 10000
    );
    await db.$client.query(
      "update invoices set prepared_at = $1, previous_credit_applied = '30.00' where id = $2",
      [laterPreparedAt, inv2.id]
    );

    await expect(
      reversePayment(
        db,
        org.id,
        proposedMatch.id,
        "Attempting reversal after credit used",
        seedAdminId
      )
    ).rejects.toThrow(ConflictError);

    const [matchRow] = await db
      .select({ status: paymentMatches.status })
      .from(paymentMatches)
      .where(eq(paymentMatches.id, proposedMatch.id));
    expect(matchRow.status).toBe("CONFIRMED");

    const currentBalance = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );
    expect(currentBalance).toBe(balanceBeforeAttempt);

    const reversals = await db
      .select()
      .from(paymentReversals)
      .where(eq(paymentReversals.paymentMatchId, proposedMatch.id));
    expect(reversals).toHaveLength(0);

    const reversalEntries = await db
      .select()
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.organizationId, org.id),
          eq(accountEntries.type, "PAYMENT_REVERSAL")
        )
      );
    expect(reversalEntries).toHaveLength(0);

    await cleanupOrg(org.id);
  });

  it("enforces validation rules and handles idempotent replay", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-P Validation", 6);

    const csv = [
      "booking_date,amount,currency,reference",
      `2026-06-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "val.csv", csv, seedAdminId);

    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");

    // 1. Reversing a PROPOSED match -> ConflictError
    await expect(
      reversePayment(
        db,
        org.id,
        proposedMatch.id,
        "Valid reason here",
        seedAdminId
      )
    ).rejects.toThrow(ConflictError);

    await confirmMatch(db, org.id, proposedMatch.id, seedAdminId);

    // 2. Empty reason -> ValidationError
    await expect(
      reversePayment(db, org.id, proposedMatch.id, "   ", seedAdminId)
    ).rejects.toThrow(ValidationError);

    // Reason over 500 chars -> ValidationError
    await expect(
      reversePayment(db, org.id, proposedMatch.id, "a".repeat(501), seedAdminId)
    ).rejects.toThrow(ValidationError);

    // 3. Wrong organization id -> NotFoundError
    await expect(
      reversePayment(
        db,
        randomUUID(),
        proposedMatch.id,
        "Valid reason",
        seedAdminId
      )
    ).rejects.toThrow(NotFoundError);

    // 4. Reversing twice returns the same REVERSED match and creates only one PAYMENT_REVERSAL entry
    const firstReversal = await reversePayment(
      db,
      org.id,
      proposedMatch.id,
      "First reversal call",
      seedAdminId
    );
    expect(firstReversal.status).toBe("REVERSED");

    const secondReversal = await reversePayment(
      db,
      org.id,
      proposedMatch.id,
      "Second reversal call (replay)",
      seedAdminId
    );
    expect(secondReversal.status).toBe("REVERSED");
    expect(secondReversal.id).toBe(firstReversal.id);

    const reversalEntries = await db
      .select()
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.organizationId, org.id),
          eq(accountEntries.type, "PAYMENT_REVERSAL")
        )
      );
    expect(reversalEntries).toHaveLength(1);

    const reversals = await db
      .select()
      .from(paymentReversals)
      .where(eq(paymentReversals.paymentMatchId, proposedMatch.id));
    expect(reversals).toHaveLength(1);

    await cleanupOrg(org.id);
  });
});
