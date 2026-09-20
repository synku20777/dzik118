// Phase J (Payments) - domain-layer integration tests (spec Section 25,
// PAY-001/002/003). Requires a real Postgres reachable via DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { bankTransactions, paymentMatches } from "../../src/db/schema/payments";
import {
  ImportHeaderError,
  NotFoundError,
  getBankImport,
  importBankCsv,
  listBankImports,
  listTransactionsForImport,
  validateBankCsv,
} from "../../src/domain/payments/bank-import";
import {
  ConflictError,
  confirmMatch,
  listPaymentMatches,
  listUnmatchedTransactions,
  proposeExactMatches,
  rejectMatch,
} from "../../src/domain/payments/matching";
import {
  addExact,
  compareExact,
  maxExact,
  minExact,
  negateExact,
  subtractExact,
  sumExact,
} from "../../src/lib/decimal2";
import {
  getDwellingAccountBalance,
  getInvoiceAllocatedAmount,
} from "../../src/domain/accounts/ledger";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-j-admin@example.com");
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
  // proposeExactMatches only matches against PREPARED/SENT/OVERDUE invoices
  // (a DRAFT invoice isn't yet a real payment obligation), so every payments
  // fixture needs to be prepared before it can be matched against.
  const invoice = await prepareInvoice(db, org.id, generated.id, seedAdminId);
  return { org, dwelling, period, invoice };
}

describe("validateBankCsv", () => {
  it("rejects a file missing required headers", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-J Org Headers", addressLine1: "Addr 1" },
      seedAdminId
    );
    const result = await validateBankCsv(db, org.id, "not_a_real_column\nfoo");
    expect(result.headerError).toMatch(/Missing required column/);
    await cleanupOrg(org.id);
  });

  it("classifies rows and flags a bad amount as an error", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-J Org Rows", addressLine1: "Addr 1" },
      seedAdminId
    );
    const csv = [
      "booking_date,amount,currency,reference",
      "2026-01-15,60.50,EUR,INV-202601-00001",
      "2026-01-16,not-a-number,EUR,INV-202601-00002",
    ].join("\n");
    const result = await validateBankCsv(db, org.id, csv);
    expect(result.headerError).toBeNull();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].status).toBe("OK");
    expect(result.rows[1].status).toBe("ERROR");
    await cleanupOrg(org.id);
  });

  it("flags a calendar-impossible date (shape-valid but not a real date) as an error", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-J Org BadDate", addressLine1: "Addr 1" },
      seedAdminId
    );
    const csv = [
      "booking_date,amount,currency,reference",
      "2026-02-30,10.00,EUR,X",
    ].join("\n");
    const result = await validateBankCsv(db, org.id, csv);
    expect(result.rows[0].status).toBe("ERROR");
    expect(result.rows[0].errors.join(" ")).toMatch(/calendar date/);
    await cleanupOrg(org.id);
  });
});

describe("importBankCsv and proposeExactMatches", () => {
  it("PAY-001/002: imports valid rows, skips error rows, and proposes an exact match by reference", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-J Org Import", 1);
    const csv = [
      "booking_date,amount,currency,payer_name,reference",
      `2026-01-20,${invoice.total},${invoice.currency},Jane Doe,Payment for ${invoice.invoiceNumber}`,
      "2026-01-21,bad,EUR,Someone,no amount",
    ].join("\n");

    const result = await importBankCsv(
      db,
      org.id,
      "statement.csv",
      csv,
      seedAdminId
    );
    expect(result.imported).toBe(1);
    expect(result.errored).toBe(1);
    expect(result.proposed).toBe(1);

    const matches = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(matches).toHaveLength(1);
    expect(matches[0].invoiceId).toBe(invoice.id);
    expect(matches[0].matchType).toBe("AUTO_EXACT");

    const imports = await listBankImports(db, org.id);
    expect(imports).toHaveLength(1);
    const transactions = await listTransactionsForImport(
      db,
      org.id,
      imports[0].id
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].matchStatus).toBe("PROPOSED");

    await cleanupOrg(org.id);
  });

  it("PAY-001: blocks re-importing the exact same file (duplicate file hash)", async () => {
    const { org } = await setupOrgWithInvoice("IT-J Org Duplicate", 2);
    const csv = "booking_date,amount,currency\n2026-02-01,10.00,EUR";
    await importBankCsv(db, org.id, "a.csv", csv, seedAdminId);

    const preview = await validateBankCsv(db, org.id, csv);
    expect(preview.isDuplicateFile).toBe(true);

    await expect(
      importBankCsv(db, org.id, "a-again.csv", csv, seedAdminId)
    ).rejects.toBeInstanceOf(ImportHeaderError);

    await cleanupOrg(org.id);
  });

  it("getBankImport is tenant-scoped: another org's import id is not found", async () => {
    const { org: orgA } = await setupOrgWithInvoice("IT-J Org GetA", 10);
    const { org: orgB } = await setupOrgWithInvoice("IT-J Org GetB", 11);
    const csv = "booking_date,amount,currency\n2026-10-01,10.00,EUR";
    const result = await importBankCsv(db, orgA.id, "a.csv", csv, seedAdminId);

    const found = await getBankImport(db, orgA.id, result.bankImport.id);
    expect(found.id).toBe(result.bankImport.id);
    await expect(
      getBankImport(db, orgB.id, result.bankImport.id)
    ).rejects.toBeInstanceOf(NotFoundError);

    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
  });

  it("PAY-002: does not propose a match for an already-paid invoice, or when the amount doesn't match", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-J Org NoMatch", 3);
    await db.$client.query(
      "update invoices set paid_at = now() where id = $1",
      [invoice.id]
    );
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-03-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");

    const result = await importBankCsv(db, org.id, "s.csv", csv, seedAdminId);
    expect(result.proposed).toBe(0);
    const unmatched = await listUnmatchedTransactions(db, org.id);
    expect(unmatched).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("PAY-002: a transaction with no reference stays unmatched even if the amount matches", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-J Org NoRef", 4);
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-04-20,${invoice.total},${invoice.currency},`,
    ].join("\n");

    const result = await importBankCsv(db, org.id, "s.csv", csv, seedAdminId);
    expect(result.proposed).toBe(0);
    const unmatched = await listUnmatchedTransactions(db, org.id);
    expect(unmatched).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("does not auto-propose when the reference is ambiguous between two candidate invoices", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-J Org Ambiguous",
        addressLine1: "Addr 1",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    // Both dwellings must exist before the period is created: createPeriod
    // only snapshots a billing_case for dwellings that already exist then.
    const dwellingA = await createDwelling(
      db,
      org.id,
      { number: "1", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      org.id,
      { number: "2", occupantName: "John Roe", billingAddress: "2 Test St" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 5,
        startsOn: "2026-05-01",
        endsOn: "2026-05-28",
        invoiceIssueDate: "2026-05-28",
        invoiceDueDate: "2026-06-14",
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
    const invoiceA = await generateInvoice(
      db,
      org.id,
      period.id,
      dwellingA.id,
      seedAdminId
    );
    const invoiceB = await generateInvoice(
      db,
      org.id,
      period.id,
      dwellingB.id,
      seedAdminId
    );

    const csv = [
      "booking_date,amount,currency,reference",
      `2026-05-20,${invoiceA.total},${invoiceA.currency},${invoiceA.invoiceNumber} ${invoiceB.invoiceNumber}`,
    ].join("\n");

    const result = await importBankCsv(db, org.id, "s.csv", csv, seedAdminId);
    expect(result.proposed).toBe(0);

    await cleanupOrg(org.id);
  });
});

describe("confirmMatch / rejectMatch", () => {
  it("PAY-003: confirming a match sets invoice paidAt and case PAID, and is idempotent", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-J Org Confirm", 6);
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-06-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "s.csv", csv, seedAdminId);
    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");

    const confirmed = await confirmMatch(
      db,
      org.id,
      proposedMatch.id,
      seedAdminId
    );
    expect(confirmed.status).toBe("CONFIRMED");

    const invoiceRow = await db.$client.query(
      "select paid_at from invoices where id = $1",
      [invoice.id]
    );
    expect(invoiceRow.rows[0].paid_at).not.toBeNull();
    const caseRow = await db.$client.query(
      "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
      [invoice.id]
    );
    expect(caseRow.rows[0].status).toBe("PAID");

    const confirmedAgain = await confirmMatch(
      db,
      org.id,
      proposedMatch.id,
      seedAdminId
    );
    expect(confirmedAgain.confirmedAt).toEqual(confirmed.confirmedAt);

    await cleanupOrg(org.id);
  });

  it("rejecting a match is idempotent, and a confirmed match cannot be rejected", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-J Org Reject", 7);
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-07-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "s.csv", csv, seedAdminId);
    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");

    const rejected = await rejectMatch(
      db,
      org.id,
      proposedMatch.id,
      seedAdminId
    );
    expect(rejected.status).toBe("REJECTED");
    const rejectedAgain = await rejectMatch(
      db,
      org.id,
      proposedMatch.id,
      seedAdminId
    );
    expect(rejectedAgain.status).toBe("REJECTED");

    await expect(
      confirmMatch(db, org.id, proposedMatch.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("a confirmed match cannot be rejected", async () => {
    const { org, invoice } = await setupOrgWithInvoice(
      "IT-J Org ConfirmReject",
      8
    );
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-08-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "s.csv", csv, seedAdminId);
    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");
    await confirmMatch(db, org.id, proposedMatch.id, seedAdminId);

    await expect(
      rejectMatch(db, org.id, proposedMatch.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("still proposes a second transaction against an invoice already claimed by a live match, but only one can ever be confirmed", async () => {
    // Unlike a bank transaction (which is only ever proposed once, per the
    // dedup-by-transaction test above), an invoice's remaining balance isn't
    // reduced until a match is actually CONFIRMED -- two transactions can
    // legitimately both reference the same invoice (e.g. a duplicate wire,
    // or a since-rejected first attempt), so both are proposed here.
    // confirmMatch is what enforces the invariant this test's old name
    // described, by re-checking the invoice's remaining balance at confirm
    // time (see the "refuses to double-confirm" test below).
    const { org, invoice } = await setupOrgWithInvoice(
      "IT-J Org DoubleClaim",
      6
    );
    const csvOne = [
      "booking_date,amount,currency,reference",
      `2026-06-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    const first = await importBankCsv(
      db,
      org.id,
      "s1.csv",
      csvOne,
      seedAdminId
    );
    expect(first.proposed).toBe(1);

    const csvTwo = [
      "booking_date,amount,currency,reference",
      `2026-06-21,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    const second = await importBankCsv(
      db,
      org.id,
      "s2.csv",
      csvTwo,
      seedAdminId
    );
    expect(second.proposed).toBe(1);

    const unmatched = await listUnmatchedTransactions(db, org.id);
    expect(unmatched).toHaveLength(0);
    const matches = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(matches).toHaveLength(2);

    await confirmMatch(db, org.id, matches[0].id, seedAdminId);
    await expect(
      confirmMatch(db, org.id, matches[1].id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("confirmMatch refuses to double-confirm payment on an invoice a different match already paid", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-J Org DoublePay", 6);
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-06-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "s.csv", csv, seedAdminId);
    const [firstMatch] = await listPaymentMatches(db, org.id, "PROPOSED");
    await confirmMatch(db, org.id, firstMatch.id, seedAdminId);

    // Simulate a second live match against the same, now-paid invoice via a
    // MANUAL match (proposeExactMatches's own version of this is covered by
    // the test above) to exercise confirmMatch's remaining-balance guard
    // directly.
    const [existingImport] = await listBankImports(db, org.id);
    const [secondTxn] = await db
      .insert(bankTransactions)
      .values({
        organizationId: org.id,
        bankImportId: existingImport.id,
        bookingDate: "2026-06-22",
        amount: invoice.total,
        currency: invoice.currency,
        reference: invoice.invoiceNumber,
        rawData: {},
        rowNumber: 99,
      })
      .returning();
    const [secondMatch] = await db
      .insert(paymentMatches)
      .values({
        organizationId: org.id,
        bankTransactionId: secondTxn.id,
        invoiceId: invoice.id,
        matchType: "MANUAL",
        status: "PROPOSED",
      })
      .returning();

    await expect(
      confirmMatch(db, org.id, secondMatch.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("proposeExactMatches re-run does not double-propose an already-matched transaction", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-J Org Rerun", 9);
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-09-20,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    const result = await importBankCsv(db, org.id, "s.csv", csv, seedAdminId);
    expect(result.proposed).toBe(1);

    const [bankImport] = await listBankImports(db, org.id);
    const rerun = await proposeExactMatches(
      db,
      org.id,
      bankImport.id,
      seedAdminId
    );
    expect(rerun.proposed).toBe(0);
    const matches = await listPaymentMatches(db, org.id);
    expect(matches).toHaveLength(1);

    await cleanupOrg(org.id);
  });
});

describe("payment reconciliation (PACKAGE F1+F2: partial payments and overpayments)", () => {
  it("PACKAGE F1: reconciles a partial payment, leaves invoice open, and settles in full upon second payment", async () => {
    // 1. Create an org+dwelling+period+rule+invoice via setupOrgWithInvoice
    const { org, dwelling, invoice } = await setupOrgWithInvoice(
      "IT-J Org Partial Reconcile",
      11
    );
    const partialAmount = "20.00";
    expect(compareExact(partialAmount, invoice.amountDue)).toBeLessThan(0);

    // 2. Import a bank CSV with a transaction amount LESS than invoice amountDue, matched by reference
    const csv1 = [
      "booking_date,amount,currency,reference",
      `2026-11-15,${partialAmount},${invoice.currency},Payment for ${invoice.invoiceNumber}`,
    ].join("\n");
    const import1 = await importBankCsv(
      db,
      org.id,
      "partial-1.csv",
      csv1,
      seedAdminId
    );
    expect(import1.imported).toBe(1);
    expect(import1.proposed).toBe(1);

    const matches1 = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(matches1).toHaveLength(1);
    const firstMatch = matches1[0];
    expect(firstMatch.invoiceId).toBe(invoice.id);
    expect(firstMatch.resultType).toBe("PARTIAL");

    // 3. Confirm the match via confirmMatch
    const confirmed1 = await confirmMatch(
      db,
      org.id,
      firstMatch.id,
      seedAdminId
    );
    expect(confirmed1.status).toBe("CONFIRMED");

    // 4. Assert against REAL DATABASE ROWS:
    // - exactly one account_entries row posted for this bank_transaction_id, type PAYMENT,
    //   credit = FULL transaction amount (not partial allocation)
    const entries1 = await db.$client.query<{
      type: string;
      credit: string;
      debit: string;
      bank_transaction_id: string;
    }>(
      "select type, credit, debit, bank_transaction_id from account_entries where bank_transaction_id = $1",
      [firstMatch.transactionId]
    );
    expect(entries1.rows).toHaveLength(1);
    expect(entries1.rows[0].type).toBe("PAYMENT");
    expect(entries1.rows[0].credit).toBe(partialAmount);
    expect(entries1.rows[0].debit).toBe("0.00");

    // - exactly one payment_allocations row for this invoice, allocated_amount equals partial transaction amount
    const allocations1 = await db.$client.query<{
      allocated_amount: string;
      invoice_id: string;
    }>(
      "select allocated_amount, invoice_id from payment_allocations where invoice_id = $1",
      [invoice.id]
    );
    expect(allocations1.rows).toHaveLength(1);
    expect(allocations1.rows[0].allocated_amount).toBe(partialAmount);
    expect(allocations1.rows[0].allocated_amount).not.toBe(invoice.amountDue);

    // - invoice paid_at is still NULL
    const invoiceRow1 = await db.$client.query<{ paid_at: Date | null }>(
      "select paid_at from invoices where id = $1",
      [invoice.id]
    );
    expect(invoiceRow1.rows[0].paid_at).toBeNull();

    // - billing case status is still whatever it was before (PREPARED/SENT, NOT PAID)
    const caseRow1 = await db.$client.query<{ status: string }>(
      "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
      [invoice.id]
    );
    expect(caseRow1.rows[0].status).toBe("PREPARED");
    expect(caseRow1.rows[0].status).not.toBe("PAID");

    // - getInvoiceAllocatedAmount equals partial amount, remaining balance (amountDue - allocated) is correct
    const allocated1 = await getInvoiceAllocatedAmount(db, org.id, invoice.id);
    expect(allocated1).toBe(partialAmount);
    const remaining1 = subtractExact(invoice.amountDue, allocated1);
    expect(remaining1).toBe("30.00");
    expect(remaining1).toBe(subtractExact(invoice.amountDue, partialAmount));

    // 5. Import and confirm a SECOND transaction for exactly the remaining balance
    const csv2 = [
      "booking_date,amount,currency,reference",
      `2026-11-20,${remaining1},${invoice.currency},Settlement ${invoice.invoiceNumber}`,
    ].join("\n");
    const import2 = await importBankCsv(
      db,
      org.id,
      "partial-2.csv",
      csv2,
      seedAdminId
    );
    expect(import2.imported).toBe(1);
    expect(import2.proposed).toBe(1);

    const matches2 = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(matches2).toHaveLength(1);
    const secondMatch = matches2[0];
    expect(secondMatch.invoiceId).toBe(invoice.id);
    expect(secondMatch.resultType).toBe("EXACT");

    const confirmed2 = await confirmMatch(
      db,
      org.id,
      secondMatch.id,
      seedAdminId
    );
    expect(confirmed2.status).toBe("CONFIRMED");

    // 6. Assert:
    // - invoice paid_at is now set
    const invoiceRow2 = await db.$client.query<{ paid_at: Date | null }>(
      "select paid_at from invoices where id = $1",
      [invoice.id]
    );
    expect(invoiceRow2.rows[0].paid_at).not.toBeNull();

    // - billing case status is now PAID
    const caseRow2 = await db.$client.query<{ status: string }>(
      "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
      [invoice.id]
    );
    expect(caseRow2.rows[0].status).toBe("PAID");

    // - getInvoiceAllocatedAmount now equals invoice full amountDue
    const allocated2 = await getInvoiceAllocatedAmount(db, org.id, invoice.id);
    expect(allocated2).toBe(invoice.amountDue);

    // - exactly TWO payment_allocations rows exist for this invoice, summing exactly to amountDue
    const allocations2 = await db.$client.query<{
      allocated_amount: string;
      bank_transaction_id: string;
      invoice_id: string;
    }>(
      "select allocated_amount, bank_transaction_id, invoice_id from payment_allocations where invoice_id = $1 order by created_at asc",
      [invoice.id]
    );
    expect(allocations2.rows).toHaveLength(2);
    const sumAllocations = sumExact(
      allocations2.rows.map((r) => r.allocated_amount)
    );
    expect(sumAllocations).toBe(invoice.amountDue);

    // - exactly TWO account_entries rows of type PAYMENT exist for this dwelling, and no other unexpected rows
    const paymentEntries = await db.$client.query<{
      id: string;
      type: string;
      bank_transaction_id: string;
      credit: string;
      debit: string;
    }>(
      "select id, type, bank_transaction_id, credit, debit from account_entries where dwelling_id = $1 and type = 'PAYMENT' order by created_at asc",
      [dwelling.id]
    );
    expect(paymentEntries.rows).toHaveLength(2);
    expect(paymentEntries.rows[0].bank_transaction_id).toBe(
      firstMatch.transactionId
    );
    expect(paymentEntries.rows[0].credit).toBe(partialAmount);
    expect(paymentEntries.rows[1].bank_transaction_id).toBe(
      secondMatch.transactionId
    );
    expect(paymentEntries.rows[1].credit).toBe(remaining1);

    const allDwellingEntries = await db.$client.query<{
      id: string;
      type: string;
    }>(
      "select id, type from account_entries where dwelling_id = $1 order by created_at asc",
      [dwelling.id]
    );
    expect(allDwellingEntries.rows).toHaveLength(3);
    const nonPaymentEntries = allDwellingEntries.rows.filter(
      (r) => r.type !== "PAYMENT"
    );
    expect(nonPaymentEntries).toHaveLength(1);
    expect(nonPaymentEntries[0].type).toBe("INVOICE_CHARGE");

    // - sum(allocation amounts) <= sum(transaction amounts) and sum(allocations against this invoice) <= invoice.amountDue
    const sumTransactionAmounts = sumExact([partialAmount, remaining1]);
    expect(
      compareExact(sumAllocations, sumTransactionAmounts)
    ).toBeLessThanOrEqual(0);
    expect(compareExact(sumAllocations, invoice.amountDue)).toBeLessThanOrEqual(
      0
    );

    await cleanupOrg(org.id);
  });

  it("PACKAGE F2: reconciles an overpayment, caps allocation, creates dwelling credit, and is idempotent on replay", async () => {
    // 1. Set up an invoice. Import and confirm a transaction with amount GREATER than amountDue (overpayment)
    const { org, dwelling, invoice } = await setupOrgWithInvoice(
      "IT-J Org Overpay Reconcile",
      10
    );
    const overpaymentAmount = "80.00";
    expect(compareExact(overpaymentAmount, invoice.amountDue)).toBeGreaterThan(
      0
    );

    const csv = [
      "booking_date,amount,currency,reference",
      `2026-10-15,${overpaymentAmount},${invoice.currency},${invoice.invoiceNumber}`,
    ].join("\n");
    const importResult = await importBankCsv(
      db,
      org.id,
      "overpay.csv",
      csv,
      seedAdminId
    );
    expect(importResult.imported).toBe(1);
    expect(importResult.proposed).toBe(1);

    const [proposedMatch] = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(proposedMatch.invoiceId).toBe(invoice.id);
    expect(proposedMatch.resultType).toBe("OVERPAYMENT");
    expect(proposedMatch.proposedAllocationAmount).toBe(invoice.amountDue);

    const confirmed = await confirmMatch(
      db,
      org.id,
      proposedMatch.id,
      seedAdminId
    );
    expect(confirmed.status).toBe("CONFIRMED");

    // 2. Assert against real rows:
    // - exactly one account_entries PAYMENT row credited for FULL (overpayment) transaction amount
    const paymentEntries = await db.$client.query<{
      type: string;
      credit: string;
      debit: string;
    }>(
      "select type, credit, debit from account_entries where bank_transaction_id = $1",
      [proposedMatch.transactionId]
    );
    expect(paymentEntries.rows).toHaveLength(1);
    expect(paymentEntries.rows[0].type).toBe("PAYMENT");
    expect(paymentEntries.rows[0].credit).toBe(overpaymentAmount);
    expect(paymentEntries.rows[0].debit).toBe("0.00");

    // - exactly one payment_allocations row, allocated_amount CAPPED at exactly invoice amountDue
    const allocationRows = await db.$client.query<{
      allocated_amount: string;
      invoice_id: string;
    }>(
      "select allocated_amount, invoice_id from payment_allocations where invoice_id = $1",
      [invoice.id]
    );
    expect(allocationRows.rows).toHaveLength(1);
    expect(allocationRows.rows[0].allocated_amount).toBe(invoice.amountDue);
    expect(allocationRows.rows[0].allocated_amount).not.toBe(overpaymentAmount);

    // - invoice paid_at is now set, billing case status is PAID
    const invoiceRow = await db.$client.query<{ paid_at: Date | null }>(
      "select paid_at from invoices where id = $1",
      [invoice.id]
    );
    expect(invoiceRow.rows[0].paid_at).not.toBeNull();
    const caseRow = await db.$client.query<{ status: string }>(
      "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
      [invoice.id]
    );
    expect(caseRow.rows[0].status).toBe("PAID");

    // - dwelling account balance is NEGATIVE, and its magnitude equals exactly transactionAmount - invoiceAmountDue
    const expectedSurplus = subtractExact(overpaymentAmount, invoice.amountDue);
    expect(expectedSurplus).toBe("30.00");
    const balance = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );
    expect(compareExact(balance, "0.00")).toBeLessThan(0);
    expect(balance).toBe(negateExact(expectedSurplus));
    expect(negateExact(balance)).toBe(expectedSurplus);

    // 3. Idempotent replay: call confirmMatch AGAIN on the same already-CONFIRMED match id
    const confirmedAgain = await confirmMatch(
      db,
      org.id,
      proposedMatch.id,
      seedAdminId
    );
    expect(confirmedAgain.status).toBe("CONFIRMED");
    expect(confirmedAgain.confirmedAt).toEqual(confirmed.confirmedAt);

    // - account_entries row count for this bank_transaction_id is STILL exactly one
    const recheckEntries = await db.$client.query<{ count: string }>(
      "select count(*) as count from account_entries where bank_transaction_id = $1",
      [proposedMatch.transactionId]
    );
    expect(Number(recheckEntries.rows[0].count)).toBe(1);

    // - payment_allocations row count for this invoice is STILL exactly one
    const recheckAllocations = await db.$client.query<{ count: string }>(
      "select count(*) as count from payment_allocations where invoice_id = $1",
      [invoice.id]
    );
    expect(Number(recheckAllocations.rows[0].count)).toBe(1);

    // - dwelling account balance is UNCHANGED from step 2's value
    const balanceAfterReplay = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice.currency
    );
    expect(balanceAfterReplay).toBe(balance);
    expect(balanceAfterReplay).toBe(negateExact(expectedSurplus));

    await cleanupOrg(org.id);
  });
});

describe("credit carry-forward (PACKAGE F3)", () => {
  it("PACKAGE F3: carries forward credit when credit < new charges, fully consuming credit and leaving prior invoice intact", async () => {
    // 1. Set up org+dwelling+period+rule+invoice via setupOrgWithInvoice (month 1 = Jan 2026)
    const {
      org,
      dwelling,
      invoice: invoice1,
    } = await setupOrgWithInvoice("IT-J Org F3 CarryForward", 1);
    expect(invoice1.currentCharges).toBe("50.00");
    expect(invoice1.amountDue).toBe("50.00");

    // 2. Overpay invoice 1 via confirmMatch: pay 80.00 against 50.00 due, leaving 30.00 credit
    const overpaymentAmount = "80.00";
    expect(compareExact(overpaymentAmount, invoice1.amountDue)).toBeGreaterThan(
      0
    );

    const csv1 = [
      "booking_date,amount,currency,reference",
      `2026-01-20,${overpaymentAmount},${invoice1.currency},${invoice1.invoiceNumber}`,
    ].join("\n");
    const import1 = await importBankCsv(
      db,
      org.id,
      "overpay-p1.csv",
      csv1,
      seedAdminId
    );
    expect(import1.imported).toBe(1);
    expect(import1.proposed).toBe(1);

    const [match1] = await listPaymentMatches(db, org.id, "PROPOSED");
    expect(match1.invoiceId).toBe(invoice1.id);
    expect(match1.resultType).toBe("OVERPAYMENT");
    const confirmed1 = await confirmMatch(db, org.id, match1.id, seedAdminId);
    expect(confirmed1.status).toBe("CONFIRMED");

    // 3. Snapshot persisted state of invoice 1 immediately after payment settlement
    const [invoice1Before] = (
      await db.$client.query<{
        id: string;
        invoice_number: string;
        subtotal: string;
        vat_total: string;
        total: string;
        current_charges: string;
        previous_outstanding: string;
        previous_credit_applied: string;
        late_fee_calculated: string;
        late_fee_adjustment: string;
        late_fee_applied: string;
        manual_adjustment: string;
        amount_due: string;
        remaining_credit: string;
        balance_snapshot: Record<string, unknown>;
        penalty_snapshot: Record<string, unknown>;
        manual_adjustment_snapshot: Record<string, unknown>;
        paid_at: Date | null;
      }>(
        "select id, invoice_number, subtotal, vat_total, total, current_charges, previous_outstanding, previous_credit_applied, late_fee_calculated, late_fee_adjustment, late_fee_applied, manual_adjustment, amount_due, remaining_credit, balance_snapshot, penalty_snapshot, manual_adjustment_snapshot, paid_at from invoices where id = $1",
        [invoice1.id]
      )
    ).rows;
    expect(invoice1Before.paid_at).not.toBeNull();

    // 4. Assert dwelling account balance immediately before generating invoice 2 is negative (credit exists),
    // and compute its exact magnitude via getDwellingAccountBalance (don't hardcode a guess)
    const balanceBefore = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice1.currency
    );
    expect(compareExact(balanceBefore, "0.00")).toBeLessThan(0);
    const expectedSurplus = subtractExact(
      overpaymentAmount,
      invoice1.amountDue
    );
    expect(balanceBefore).toBe(negateExact(expectedSurplus));
    const availableCredit = negateExact(balanceBefore);
    expect(availableCredit).toBe(expectedSurplus);

    // 5. Create a SECOND period (N+1 = Feb 2026) for the same organization/dwelling
    const period2 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 2,
        startsOn: "2026-02-01",
        endsOn: "2026-02-28",
        invoiceIssueDate: "2026-02-28",
        invoiceDueDate: "2026-03-14",
      },
      seedAdminId
    );

    // 6. Generate and prepare the second invoice
    const generated2 = await generateInvoice(
      db,
      org.id,
      period2.id,
      dwelling.id,
      seedAdminId
    );
    const invoice2 = await prepareInvoice(
      db,
      org.id,
      generated2.id,
      seedAdminId
    );

    // 7. Assert against invoice 2:
    // - credit < new charges: credit is fully consumed, leftover new charges still due
    expect(compareExact(availableCredit, invoice2.currentCharges)).toBeLessThan(
      0
    );

    // - previousCreditApplied equals min(availableCredit, currentCharges)
    const expectedCreditApplied = minExact(
      availableCredit,
      invoice2.currentCharges
    );
    expect(invoice2.previousCreditApplied).toBe(expectedCreditApplied);
    const snapshot2 = invoice2.balanceSnapshot as {
      previousCreditApplied: string;
      remainingCredit: string;
    };
    expect(snapshot2.previousCreditApplied).toBe(expectedCreditApplied);

    // - amountDue equals currentCharges - previousCreditApplied (floored at zero)
    const expectedAmountDue = maxExact(
      subtractExact(invoice2.currentCharges, expectedCreditApplied),
      "0.00"
    );
    expect(invoice2.amountDue).toBe(expectedAmountDue);
    expect(invoice2.amountDue).toBe(
      subtractExact(invoice2.currentCharges, invoice2.previousCreditApplied)
    );

    // - remainingCredit on second invoice is 0.00
    expect(invoice2.remainingCredit).toBe("0.00");
    expect(snapshot2.remainingCredit).toBe("0.00");

    // - Query raw DB row for invoice 2 to verify against real Postgres row
    const [rawInvoice2] = (
      await db.$client.query<{
        current_charges: string;
        previous_outstanding: string;
        previous_credit_applied: string;
        amount_due: string;
        remaining_credit: string;
        balance_snapshot: {
          previousCreditApplied: string;
          remainingCredit: string;
        };
      }>(
        "select current_charges, previous_outstanding, previous_credit_applied, amount_due, remaining_credit, balance_snapshot from invoices where id = $1",
        [invoice2.id]
      )
    ).rows;
    expect(rawInvoice2.current_charges).toBe(invoice2.currentCharges);
    expect(rawInvoice2.previous_outstanding).toBe("0.00");
    expect(rawInvoice2.previous_credit_applied).toBe(expectedCreditApplied);
    expect(rawInvoice2.amount_due).toBe(expectedAmountDue);
    expect(rawInvoice2.remaining_credit).toBe("0.00");
    expect(rawInvoice2.balance_snapshot.previousCreditApplied).toBe(
      expectedCreditApplied
    );
    expect(rawInvoice2.balance_snapshot.remainingCredit).toBe("0.00");

    // 8. Assert FIRST invoice is UNCHANGED by generating/preparing the second invoice
    const [invoice1After] = (
      await db.$client.query<{
        id: string;
        invoice_number: string;
        subtotal: string;
        vat_total: string;
        total: string;
        current_charges: string;
        previous_outstanding: string;
        previous_credit_applied: string;
        late_fee_calculated: string;
        late_fee_adjustment: string;
        late_fee_applied: string;
        manual_adjustment: string;
        amount_due: string;
        remaining_credit: string;
        balance_snapshot: Record<string, unknown>;
        penalty_snapshot: Record<string, unknown>;
        manual_adjustment_snapshot: Record<string, unknown>;
        paid_at: Date | null;
      }>(
        "select id, invoice_number, subtotal, vat_total, total, current_charges, previous_outstanding, previous_credit_applied, late_fee_calculated, late_fee_adjustment, late_fee_applied, manual_adjustment, amount_due, remaining_credit, balance_snapshot, penalty_snapshot, manual_adjustment_snapshot, paid_at from invoices where id = $1",
        [invoice1.id]
      )
    ).rows;

    expect(invoice1After.previous_outstanding).toBe(
      invoice1Before.previous_outstanding
    );
    expect(invoice1After.previous_credit_applied).toBe(
      invoice1Before.previous_credit_applied
    );
    expect(invoice1After.amount_due).toBe(invoice1Before.amount_due);
    expect(invoice1After.total).toBe(invoice1Before.total);
    expect(invoice1After.current_charges).toBe(invoice1Before.current_charges);
    expect(invoice1After.late_fee_calculated).toBe(
      invoice1Before.late_fee_calculated
    );
    expect(invoice1After.late_fee_adjustment).toBe(
      invoice1Before.late_fee_adjustment
    );
    expect(invoice1After.late_fee_applied).toBe(
      invoice1Before.late_fee_applied
    );
    expect(invoice1After.manual_adjustment).toBe(
      invoice1Before.manual_adjustment
    );
    expect(invoice1After.remaining_credit).toBe(
      invoice1Before.remaining_credit
    );
    expect(invoice1After.balance_snapshot).toEqual(
      invoice1Before.balance_snapshot
    );
    expect(invoice1After.penalty_snapshot).toEqual(
      invoice1Before.penalty_snapshot
    );
    expect(invoice1After.manual_adjustment_snapshot).toEqual(
      invoice1Before.manual_adjustment_snapshot
    );
    expect(invoice1After.paid_at).toEqual(invoice1Before.paid_at);

    await cleanupOrg(org.id);
  });

  it("PACKAGE F3: handles boundary case where credit exactly equals new charges (amountDue and remainingCredit are 0.00)", async () => {
    // 1. Set up org with invoice in period 1
    const {
      org,
      dwelling,
      invoice: invoice1,
    } = await setupOrgWithInvoice("IT-J Org F3 ExactMatch", 1);

    // 2. Overpay invoice 1 such that surplus credit exactly equals period 2 currentCharges (50.00)
    // invoice1.amountDue = 50.00, so payment = 50.00 + 50.00 = 100.00
    const targetCredit = "50.00";
    const overpaymentAmount = addExact(invoice1.amountDue, targetCredit);

    const csv = [
      "booking_date,amount,currency,reference",
      `2026-01-20,${overpaymentAmount},${invoice1.currency},${invoice1.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "overpay-exact.csv", csv, seedAdminId);
    const [match] = await listPaymentMatches(db, org.id, "PROPOSED");
    await confirmMatch(db, org.id, match.id, seedAdminId);

    // 3. Confirm available credit exactly equals 50.00
    const balanceBefore = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice1.currency
    );
    expect(balanceBefore).toBe(negateExact(targetCredit));
    const availableCredit = negateExact(balanceBefore);
    expect(availableCredit).toBe(targetCredit);

    // 4. Create period 2, generate and prepare invoice 2
    const period2 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 2,
        startsOn: "2026-02-01",
        endsOn: "2026-02-28",
        invoiceIssueDate: "2026-02-28",
        invoiceDueDate: "2026-03-14",
      },
      seedAdminId
    );
    const generated2 = await generateInvoice(
      db,
      org.id,
      period2.id,
      dwelling.id,
      seedAdminId
    );
    const invoice2 = await prepareInvoice(
      db,
      org.id,
      generated2.id,
      seedAdminId
    );

    // 5. Assert availableCredit exactly equals invoice 2 currentCharges
    expect(compareExact(availableCredit, invoice2.currentCharges)).toBe(0);

    // - amountDue is exactly "0.00"
    expect(invoice2.amountDue).toBe("0.00");
    // - remainingCredit is exactly "0.00"
    expect(invoice2.remainingCredit).toBe("0.00");
    // - previousCreditApplied is equal to full currentCharges
    expect(invoice2.previousCreditApplied).toBe(invoice2.currentCharges);

    // - Assert against real database row
    const [rawInvoice2] = (
      await db.$client.query<{
        amount_due: string;
        remaining_credit: string;
        previous_credit_applied: string;
        balance_snapshot: {
          remainingCredit: string;
          previousCreditApplied: string;
        };
      }>(
        "select amount_due, remaining_credit, previous_credit_applied, balance_snapshot from invoices where id = $1",
        [invoice2.id]
      )
    ).rows;
    expect(rawInvoice2.amount_due).toBe("0.00");
    expect(rawInvoice2.remaining_credit).toBe("0.00");
    expect(rawInvoice2.previous_credit_applied).toBe(invoice2.currentCharges);
    expect(rawInvoice2.balance_snapshot.remainingCredit).toBe("0.00");
    expect(rawInvoice2.balance_snapshot.previousCreditApplied).toBe(
      invoice2.currentCharges
    );

    await cleanupOrg(org.id);
  });

  it("PACKAGE F3: handles boundary case where credit exceeds new charges, leaving remainingCredit for future periods", async () => {
    // 1. Set up org with invoice in period 1
    const {
      org,
      dwelling,
      invoice: invoice1,
    } = await setupOrgWithInvoice("IT-J Org F3 Exceeds", 1);

    // 2. Overpay invoice 1 such that surplus credit > period 2 currentCharges (50.00)
    // invoice1.amountDue = 50.00, surplus credit = 80.00, total payment = 130.00
    const surplusCredit = "80.00";
    const overpaymentAmount = addExact(invoice1.amountDue, surplusCredit);

    const csv = [
      "booking_date,amount,currency,reference",
      `2026-01-20,${overpaymentAmount},${invoice1.currency},${invoice1.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "overpay-exceeds.csv", csv, seedAdminId);
    const [match] = await listPaymentMatches(db, org.id, "PROPOSED");
    await confirmMatch(db, org.id, match.id, seedAdminId);

    // 3. Confirm available credit is 80.00
    const balanceBefore = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice1.currency
    );
    expect(balanceBefore).toBe(negateExact(surplusCredit));
    const availableCredit = negateExact(balanceBefore);
    expect(availableCredit).toBe(surplusCredit);

    // 4. Create period 2, generate and prepare invoice 2
    const period2 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 2,
        startsOn: "2026-02-01",
        endsOn: "2026-02-28",
        invoiceIssueDate: "2026-02-28",
        invoiceDueDate: "2026-03-14",
      },
      seedAdminId
    );
    const generated2 = await generateInvoice(
      db,
      org.id,
      period2.id,
      dwelling.id,
      seedAdminId
    );
    const invoice2 = await prepareInvoice(
      db,
      org.id,
      generated2.id,
      seedAdminId
    );

    // 5. Assert credit exceeds new charges: availableCredit (80.00) > currentCharges (50.00)
    expect(
      compareExact(availableCredit, invoice2.currentCharges)
    ).toBeGreaterThan(0);

    // - amountDue is exactly "0.00"
    expect(invoice2.amountDue).toBe("0.00");

    // - remainingCredit equals availableCredit - currentCharges exactly
    const expectedRemainingCredit = subtractExact(
      availableCredit,
      invoice2.currentCharges
    );
    expect(invoice2.remainingCredit).toBe(expectedRemainingCredit);
    expect(invoice2.remainingCredit).toBe("30.00");
    expect(compareExact(invoice2.remainingCredit, "0.00")).toBeGreaterThan(0);

    // - previousCreditApplied is capped at currentCharges
    expect(invoice2.previousCreditApplied).toBe(invoice2.currentCharges);

    // - Assert against real database row
    const [rawInvoice2] = (
      await db.$client.query<{
        amount_due: string;
        remaining_credit: string;
        previous_credit_applied: string;
        balance_snapshot: {
          remainingCredit: string;
          previousCreditApplied: string;
        };
      }>(
        "select amount_due, remaining_credit, previous_credit_applied, balance_snapshot from invoices where id = $1",
        [invoice2.id]
      )
    ).rows;
    expect(rawInvoice2.amount_due).toBe("0.00");
    expect(rawInvoice2.remaining_credit).toBe(expectedRemainingCredit);
    expect(rawInvoice2.previous_credit_applied).toBe(invoice2.currentCharges);
    expect(rawInvoice2.balance_snapshot.remainingCredit).toBe(
      expectedRemainingCredit
    );
    expect(rawInvoice2.balance_snapshot.previousCreditApplied).toBe(
      invoice2.currentCharges
    );

    // - Assert dwelling account balance in ledger reflects leftover credit still available
    const balanceAfter = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice2.currency
    );
    expect(balanceAfter).toBe(negateExact(expectedRemainingCredit));

    await cleanupOrg(org.id);
  });

  it("PACKAGE F3: structurally prevents credit from being applied twice via prepareInvoice state-machine gate", async () => {
    // 1. Set up org with invoice 1, overpay to create credit, and prepare invoice 2
    const {
      org,
      dwelling,
      invoice: invoice1,
    } = await setupOrgWithInvoice("IT-J Org F3 NoDoubleApply", 1);

    const overpaymentAmount = "80.00";
    const csv = [
      "booking_date,amount,currency,reference",
      `2026-01-20,${overpaymentAmount},${invoice1.currency},${invoice1.invoiceNumber}`,
    ].join("\n");
    await importBankCsv(db, org.id, "overpay-double.csv", csv, seedAdminId);
    const [match] = await listPaymentMatches(db, org.id, "PROPOSED");
    await confirmMatch(db, org.id, match.id, seedAdminId);

    const period2 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 2,
        startsOn: "2026-02-01",
        endsOn: "2026-02-28",
        invoiceIssueDate: "2026-02-28",
        invoiceDueDate: "2026-03-14",
      },
      seedAdminId
    );
    const generated2 = await generateInvoice(
      db,
      org.id,
      period2.id,
      dwelling.id,
      seedAdminId
    );
    const invoice2 = await prepareInvoice(
      db,
      org.id,
      generated2.id,
      seedAdminId
    );

    // 2. Record ledger state and dwelling account balance before the duplicate prepare attempt
    const balanceBeforeSecondCall = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice2.currency
    );
    const entriesBefore = await db.$client.query<{
      count: string;
      sum_debit: string;
      sum_credit: string;
    }>(
      "select count(*) as count, coalesce(sum(debit), 0)::text as sum_debit, coalesce(sum(credit), 0)::text as sum_credit from account_entries where dwelling_id = $1",
      [dwelling.id]
    );

    // 3. Attempt to call prepareInvoice AGAIN on the SAME invoice id (already PREPARED)
    // Must throw ConflictError because billing_case.status is PREPARED (not DRAFT)
    await expect(
      prepareInvoice(db, org.id, invoice2.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    // 4. Assert dwelling account balance is UNCHANGED after the rejected second call
    const balanceAfterSecondCall = await getDwellingAccountBalance(
      db,
      org.id,
      dwelling.id,
      invoice2.currency
    );
    expect(balanceAfterSecondCall).toBe(balanceBeforeSecondCall);

    // 5. Assert account_entries count and debit/credit sums for this dwelling are identical
    const entriesAfter = await db.$client.query<{
      count: string;
      sum_debit: string;
      sum_credit: string;
    }>(
      "select count(*) as count, coalesce(sum(debit), 0)::text as sum_debit, coalesce(sum(credit), 0)::text as sum_credit from account_entries where dwelling_id = $1",
      [dwelling.id]
    );
    expect(entriesAfter.rows[0].count).toBe(entriesBefore.rows[0].count);
    expect(entriesAfter.rows[0].sum_debit).toBe(
      entriesBefore.rows[0].sum_debit
    );
    expect(entriesAfter.rows[0].sum_credit).toBe(
      entriesBefore.rows[0].sum_credit
    );

    await cleanupOrg(org.id);
  });
});
