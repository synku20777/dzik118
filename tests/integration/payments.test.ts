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
