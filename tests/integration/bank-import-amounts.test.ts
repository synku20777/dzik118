// Only incoming money is imported: zero and negative rows are row errors.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { importBankCsv } from "../../src/domain/payments/bank-import";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-bank-amounts-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

describe("bank import amounts", () => {
  it("imports incoming rows and rejects zero and negative rows", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-Bank-Amounts", addressLine1: "1 Main St" },
      seedAdminId
    );
    try {
      const csv = [
        "booking_date,amount,currency,reference",
        "2026-01-10,25.00,EUR,INV-202601-00001",
        "2026-01-11,-25.00,EUR,INV-202601-00001",
        "2026-01-12,0.00,EUR,zero row",
      ].join("\n");
      const result = await importBankCsv(
        db,
        org.id,
        "amounts.csv",
        csv,
        seedAdminId
      );
      expect(result.imported).toBe(1);
      expect(result.errored).toBe(2);
      const errors = result.rows.flatMap((row) => row.errors);
      expect(errors.filter((e) => e.includes("greater than 0"))).toHaveLength(
        2
      );

      const { rows } = await db.$client.query(
        "select amount from bank_transactions where organization_id = $1",
        [org.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe("25.00");
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("the database refuses a zero or negative transaction", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-Bank-Amounts-2", addressLine1: "2 Main St" },
      seedAdminId
    );
    try {
      const csv = "booking_date,amount,currency\n2026-01-10,5.00,EUR";
      const result = await importBankCsv(
        db,
        org.id,
        "one.csv",
        csv,
        seedAdminId
      );
      await expect(
        db.$client.query(
          `insert into bank_transactions (organization_id, bank_import_id, booking_date, amount, currency, raw_data, row_number)
           values ($1, $2, '2026-01-11', '-1.00', 'EUR', '{}', 99)`,
          [org.id, result.bankImport.id]
        )
      ).rejects.toThrow(/bank_transactions_amount_positive_check/);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });
});
