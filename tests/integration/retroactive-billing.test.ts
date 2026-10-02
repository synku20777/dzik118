// Retroactive billing: reopenPeriod and addDwellingToPeriod
// (src/domain/periods/periods.ts). Requires a real Postgres via DATABASE_URL.
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createMeter } from "../../src/domain/organizations/meters";
import { createRule } from "../../src/domain/billing/rules";
import { generateInvoice } from "../../src/domain/billing/generation";
import {
  addDwellingToPeriod,
  createPeriod,
  getCurrentOpenPeriod,
  listDwellingsWithoutCase,
  lockPeriod,
  reopenPeriod,
} from "../../src/domain/periods/periods";
import { listCasesForPeriod } from "../../src/domain/periods/cases";
import { submitAdminReading } from "../../src/domain/periods/readings";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-retro-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

it("a dwelling created after a locked period is billed for it: reopen, add to period, read, generate", async () => {
  const org = await createOrganization(
    db,
    {
      name: "IT-Retro Org",
      addressLine1: "1 Test St",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    adminId
  );
  await createDwelling(
    db,
    org.id,
    { number: "1", occupantName: "A", billingAddress: "1 Test St" },
    adminId
  );
  await createRule(
    db,
    org.id,
    {
      name: "Cold Water",
      code: "cold_water",
      calculationType: "METER_CONSUMPTION",
      meterType: "COLD_WATER",
      unit: "m3",
      unitPrice: "2.0000",
      effectiveFrom: "2026-01-01",
    },
    adminId
  );
  const july = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month: 7,
      startsOn: "2026-07-01",
      endsOn: "2026-07-31",
      invoiceIssueDate: "2026-07-31",
      invoiceDueDate: "2026-08-14",
    },
    adminId
  );
  await lockPeriod(db, org.id, july.id, adminId);
  const august = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month: 8,
      startsOn: "2026-08-01",
      endsOn: "2026-08-31",
      invoiceIssueDate: "2026-08-31",
      invoiceDueDate: "2026-09-14",
    },
    adminId
  );
  await lockPeriod(db, org.id, august.id, adminId);

  // The contract arrives after July was locked.
  const late = await createDwelling(
    db,
    org.id,
    { number: "2", occupantName: "B", billingAddress: "2 Test St" },
    adminId
  );
  const meter = await createMeter(
    db,
    org.id,
    late.id,
    { type: "COLD_WATER", unit: "m3" },
    adminId
  );
  expect(await listCasesForPeriod(db, org.id, july.id)).toHaveLength(1);
  expect(await listDwellingsWithoutCase(db, org.id, july.id)).toEqual([
    { id: late.id, number: "2" },
  ]);

  // A locked period refuses the backfill.
  await expect(
    addDwellingToPeriod(db, org.id, july.id, late.id, adminId)
  ).rejects.toThrow("locked");

  const reopened = await reopenPeriod(db, org.id, july.id, adminId);
  expect(reopened.status).toBe("OPEN");
  expect(reopened.lockedAt).toBeNull();
  // A reopened older period is not the current period: the newest one is
  // August, and it is locked. So a dwelling created now gets no July case.
  expect(await getCurrentOpenPeriod(db, org.id)).toBeNull();
  const unrelated = await createDwelling(
    db,
    org.id,
    { number: "3", occupantName: "C", billingAddress: "3 Test St" },
    adminId
  );
  expect(
    (await listDwellingsWithoutCase(db, org.id, july.id)).map((d) => d.id)
  ).toEqual([late.id, unrelated.id]);

  // Reopening alone does not add the dwelling: the backfill is explicit.
  await expect(
    submitAdminReading(db, org.id, july.id, meter.id, "5.000", adminId)
  ).rejects.toThrow("No billing case exists");

  const added = await addDwellingToPeriod(
    db,
    org.id,
    july.id,
    late.id,
    adminId
  );
  expect(added.status).toBe("MISSING_DATA");
  expect(added.missingData).toMatchObject([{ reason: "NO_READING" }]);
  expect(await listDwellingsWithoutCase(db, org.id, july.id)).toEqual([
    { id: unrelated.id, number: "3" },
  ]);
  await expect(
    addDwellingToPeriod(db, org.id, july.id, late.id, adminId)
  ).rejects.toThrow("already has a billing case");

  await submitAdminReading(db, org.id, july.id, meter.id, "5.000", adminId);
  const invoice = await generateInvoice(db, org.id, july.id, late.id, adminId);
  expect(invoice.subtotal).toBe("10.00");
  // The retroactive invoice keeps the period's own dates.
  expect(invoice.issueDate).toBe("2026-07-31");
  expect(invoice.dueDate).toBe("2026-08-14");

  await cleanupOrganization(db, org.id);
});
