// Phase J / Financial history integrity - integration tests for append-only
// triggers (migration 0002_flimsy_charles_xavier.sql).
// Verifies that account_entries, payment_allocations, and late_fee_adjustments
// reject UPDATE and DELETE at the PostgreSQL trigger level.
import { randomUUID } from "node:crypto";
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
import {
  confirmMatch,
  listPaymentMatches,
} from "../../src/domain/payments/matching";
import { importBankCsv } from "../../src/domain/payments/bank-import";
import { postAccountEntry } from "../../src/domain/accounts/ledger";
import { adjustLateFee } from "../../src/domain/accounts/adjustments";
import { createLateFeePolicy } from "../../src/domain/accounts/settings";

const EXPECTED_TRIGGER_MESSAGE =
  "Financial history is append-only; create a compensating entry instead";
const PG_RAISE_EXCEPTION_CODE = "P0001";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-append-only-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

async function assertAppendOnlyTriggerRejection(
  operation: Promise<unknown>
): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (err) {
    thrown = err;
  }

  expect(
    thrown,
    "Expected database operation to be rejected by trigger, but it succeeded"
  ).toBeDefined();

  const pgErr = thrown as { message?: string; code?: string };
  expect(pgErr.message).toBe(EXPECTED_TRIGGER_MESSAGE);
  expect(pgErr.code).toBe(PG_RAISE_EXCEPTION_CODE);
}

describe("financial history append-only database triggers", () => {
  it("account_entries: rejects UPDATE and DELETE, preserving original row state", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT Append-Only Entries Org",
        addressLine1: "1 Ledger Way",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000001",
      },
      seedAdminId
    );
    try {
      const dwelling = await createDwelling(
        db,
        org.id,
        {
          number: "101",
          occupantName: "Alice Entry",
          billingAddress: "1 Ledger Way",
        },
        seedAdminId
      );

      // 1. Create a real row through the normal domain-layer path (postAccountEntry)
      const idempotencyKey = `manual-entry-test:${randomUUID()}`;
      const createdEntry = await postAccountEntry(db, {
        organizationId: org.id,
        dwellingId: dwelling.id,
        effectiveDate: "2026-01-15",
        type: "OPENING_BALANCE",
        debit: "125.50",
        credit: "0.00",
        currency: "EUR",
        description: "Initial opening balance for dwelling 101",
        actorUserId: seedAdminId,
        idempotencyKey,
      });

      // Capture initial row state directly from database
      const initialRows = await db.$client.query(
        "SELECT * FROM account_entries WHERE id = $1",
        [createdEntry.id]
      );
      expect(initialRows.rowCount).toBe(1);
      const baseline = initialRows.rows[0];

      // 2. Attempt raw UPDATE on that specific row -- assert it REJECTS with trigger error
      await assertAppendOnlyTriggerRejection(
        db.$client.query(
          "UPDATE account_entries SET description = $1 WHERE id = $2",
          ["Tampered description", createdEntry.id]
        )
      );

      // 3. Attempt raw DELETE on that same row -- assert it ALSO rejects the same way
      await assertAppendOnlyTriggerRejection(
        db.$client.query("DELETE FROM account_entries WHERE id = $1", [
          createdEntry.id,
        ])
      );

      // 4. Re-read the row and confirm it is COMPLETELY UNCHANGED
      const afterRows = await db.$client.query(
        "SELECT * FROM account_entries WHERE id = $1",
        [createdEntry.id]
      );
      expect(afterRows.rowCount).toBe(1);
      expect(afterRows.rows[0]).toEqual(baseline);
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("payment_allocations: rejects UPDATE and DELETE, preserving original row state", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT Append-Only Allocations Org",
        addressLine1: "2 Payment Rd",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000002",
      },
      seedAdminId
    );
    try {
      const dwelling = await createDwelling(
        db,
        org.id,
        {
          number: "201",
          occupantName: "Bob Payment",
          billingAddress: "2 Payment Rd",
        },
        seedAdminId
      );
      const period = await createPeriod(
        db,
        org.id,
        {
          year: 2026,
          month: 1,
          startsOn: "2026-01-01",
          endsOn: "2026-01-31",
          invoiceIssueDate: "2026-01-31",
          invoiceDueDate: "2026-02-14",
        },
        seedAdminId
      );
      await createRule(
        db,
        org.id,
        {
          name: "Standard Maintenance",
          code: "maint",
          calculationType: "FIXED",
          unit: "month",
          unitPrice: "80.00",
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
      const invoice = await prepareInvoice(
        db,
        org.id,
        generated.id,
        seedAdminId
      );

      // 1. Create a real row through the normal domain-layer path (importBankCsv -> confirmMatch)
      const csv = [
        "booking_date,amount,currency,reference",
        `2026-02-05,${invoice.total},${invoice.currency},${invoice.invoiceNumber}`,
      ].join("\n");
      await importBankCsv(db, org.id, "allocations-test.csv", csv, seedAdminId);
      const [match] = await listPaymentMatches(db, org.id, "PROPOSED");
      expect(match).toBeDefined();

      await confirmMatch(db, org.id, match.id, seedAdminId);

      // Capture initial payment_allocations row state
      const initialRows = await db.$client.query(
        "SELECT * FROM payment_allocations WHERE invoice_id = $1",
        [invoice.id]
      );
      expect(initialRows.rowCount).toBe(1);
      const baseline = initialRows.rows[0];

      // 2. Attempt raw UPDATE on that specific row -- assert it REJECTS with trigger error
      await assertAppendOnlyTriggerRejection(
        db.$client.query(
          "UPDATE payment_allocations SET allocated_amount = $1 WHERE id = $2",
          ["999.99", baseline.id]
        )
      );

      // 3. Attempt raw DELETE on that same row -- assert it ALSO rejects the same way
      await assertAppendOnlyTriggerRejection(
        db.$client.query("DELETE FROM payment_allocations WHERE id = $1", [
          baseline.id,
        ])
      );

      // 4. Re-read the row and confirm it is COMPLETELY UNCHANGED
      const afterRows = await db.$client.query(
        "SELECT * FROM payment_allocations WHERE id = $1",
        [baseline.id]
      );
      expect(afterRows.rowCount).toBe(1);
      expect(afterRows.rows[0]).toEqual(baseline);
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("late_fee_adjustments: rejects UPDATE and DELETE, preserving original row state", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT Append-Only LateFee Org",
        addressLine1: "3 Penalty Ave",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000003",
      },
      seedAdminId
    );
    try {
      const dwelling = await createDwelling(
        db,
        org.id,
        {
          number: "301",
          occupantName: "Charlie Fee",
          billingAddress: "3 Penalty Ave",
        },
        seedAdminId
      );

      // Create an active late-fee policy
      await createLateFeePolicy(db, {
        organizationId: org.id,
        effectiveFrom: "2025-01-01",
        enabled: true,
        dailyRate: "0.05",
        graceDays: 0,
        maxPenaltyPercent: "25.00",
        stopsAtCap: true,
        actorUserId: seedAdminId,
      });

      // Create billing rule
      await createRule(
        db,
        org.id,
        {
          name: "Rent",
          code: "rent",
          calculationType: "FIXED",
          unit: "month",
          unitPrice: "100.00",
          effectiveFrom: "2025-01-01",
        },
        seedAdminId
      );

      // Period 1: January 2026 -- prepare invoice so it becomes an unpaid overdue invoice for Period 2
      const period1 = await createPeriod(
        db,
        org.id,
        {
          year: 2026,
          month: 1,
          startsOn: "2026-01-01",
          endsOn: "2026-01-31",
          invoiceIssueDate: "2026-01-31",
          invoiceDueDate: "2026-02-14",
        },
        seedAdminId
      );
      const gen1 = await generateInvoice(
        db,
        org.id,
        period1.id,
        dwelling.id,
        seedAdminId
      );
      await prepareInvoice(db, org.id, gen1.id, seedAdminId);

      // Period 2: March 2026 -- issue date is 2026-03-31, past period 1's dueDate 2026-02-14
      const period2 = await createPeriod(
        db,
        org.id,
        {
          year: 2026,
          month: 3,
          startsOn: "2026-03-01",
          endsOn: "2026-03-31",
          invoiceIssueDate: "2026-03-31",
          invoiceDueDate: "2026-04-14",
        },
        seedAdminId
      );
      const invoice2Draft = await generateInvoice(
        db,
        org.id,
        period2.id,
        dwelling.id,
        seedAdminId
      );

      // Verify late fee was calculated on the draft invoice
      expect(Number(invoice2Draft.lateFeeCalculated)).toBeGreaterThan(0);

      // 1. Create a real row through the normal domain-layer path (adjustLateFee)
      await adjustLateFee(db, {
        organizationId: org.id,
        invoiceId: invoice2Draft.id,
        newAppliedAmount: "0.00",
        reason: "ADMIN_WAIVER",
        note: "Admin courtesy waiver for testing append-only trigger",
        actorUserId: seedAdminId,
      });

      // Capture initial late_fee_adjustments row state
      const initialRows = await db.$client.query(
        "SELECT * FROM late_fee_adjustments WHERE invoice_id = $1",
        [invoice2Draft.id]
      );
      expect(initialRows.rowCount).toBe(1);
      const baseline = initialRows.rows[0];

      // 2. Attempt raw UPDATE on that specific row -- assert it REJECTS with trigger error
      await assertAppendOnlyTriggerRejection(
        db.$client.query(
          "UPDATE late_fee_adjustments SET note = $1 WHERE id = $2",
          ["Tampered waiver note", baseline.id]
        )
      );

      // 3. Attempt raw DELETE on that same row -- assert it ALSO rejects the same way
      await assertAppendOnlyTriggerRejection(
        db.$client.query("DELETE FROM late_fee_adjustments WHERE id = $1", [
          baseline.id,
        ])
      );

      // 4. Re-read the row and confirm it is COMPLETELY UNCHANGED
      const afterRows = await db.$client.query(
        "SELECT * FROM late_fee_adjustments WHERE id = $1",
        [baseline.id]
      );
      expect(afterRows.rowCount).toBe(1);
      expect(afterRows.rows[0]).toEqual(baseline);
    } finally {
      await cleanupOrg(org.id);
    }
  });
});
