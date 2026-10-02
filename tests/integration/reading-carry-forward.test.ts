// carryForwardMissingReadings (src/domain/periods/readings.ts).
// Requires a real Postgres via DATABASE_URL.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
import { auditLogs } from "../../src/db/schema/audit";
import { meterReadings } from "../../src/db/schema/billing";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import {
  createOrganization,
  updateOrganization,
} from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createMeter } from "../../src/domain/organizations/meters";
import { createRule } from "../../src/domain/billing/rules";
import { bulkGenerateInvoices } from "../../src/domain/billing/generation";
import { createPeriod } from "../../src/domain/periods/periods";
import { listCasesForPeriod } from "../../src/domain/periods/cases";
import {
  carryForwardMissingReadings,
  submitAdminReading,
} from "../../src/domain/periods/readings";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-carry-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

it("after the deadline a missing reading reuses the previous one, with an audit event; a meter with no history stays blocked", async () => {
  const org = await createOrganization(
    db,
    {
      name: "IT-Carry Org",
      addressLine1: "1 Test St",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    adminId
  );
  const withHistory = await createDwelling(
    db,
    org.id,
    { number: "1", occupantName: "A", billingAddress: "1 Test St" },
    adminId
  );
  const noHistory = await createDwelling(
    db,
    org.id,
    { number: "2", occupantName: "B", billingAddress: "2 Test St" },
    adminId
  );
  const meter = await createMeter(
    db,
    org.id,
    withHistory.id,
    { type: "COLD_WATER", unit: "m3" },
    adminId
  );
  await createMeter(
    db,
    org.id,
    noHistory.id,
    { type: "COLD_WATER", unit: "m3" },
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
  const june = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month: 6,
      startsOn: "2026-06-01",
      endsOn: "2026-06-30",
      invoiceIssueDate: "2026-06-30",
      invoiceDueDate: "2026-07-14",
    },
    adminId
  );
  await submitAdminReading(db, org.id, june.id, meter.id, "10.000", adminId);
  const july = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month: 7,
      startsOn: "2026-07-01",
      endsOn: "2026-07-31",
      readingDeadline: "2026-07-25",
      invoiceIssueDate: "2026-07-31",
      invoiceDueDate: "2026-08-14",
    },
    adminId
  );

  // The setting is off by default: nothing is carried.
  expect(await carryForwardMissingReadings(db, org.id, july.id, null)).toBe(0);
  await updateOrganization(
    db,
    org.id,
    { carryForwardReadingsEnabled: true },
    adminId
  );

  // On the deadline day nothing is carried.
  expect(
    await carryForwardMissingReadings(
      db,
      org.id,
      july.id,
      null,
      new Date("2026-07-25T09:00:00Z")
    )
  ).toBe(0);
  // A period with no deadline never carries.
  expect(await carryForwardMissingReadings(db, org.id, june.id, null)).toBe(0);

  // Bulk generation after the deadline carries first, then generates.
  const result = await bulkGenerateInvoices(db, org.id, july.id, adminId);
  expect(result.generated).toEqual([withHistory.id]);
  expect(result.skipped.map((s) => s.dwellingId)).toEqual([noHistory.id]);

  const [carried] = await db
    .select()
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.periodId, july.id),
        eq(meterReadings.meterId, meter.id)
      )
    );
  expect(carried).toMatchObject({
    source: "CARRIED_FORWARD",
    previousValue: "10.000",
    currentValue: "10.000",
    consumption: "0.000",
    submittedByUserId: null,
  });
  const audit = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, org.id),
        eq(auditLogs.action, "METER_READING_CARRIED_FORWARD")
      )
    );
  expect(audit).toHaveLength(1);
  expect(audit[0].entityId).toBe(carried.id);

  const cases = await listCasesForPeriod(db, org.id, july.id);
  expect(
    cases.find((c) => c.dwellingId === noHistory.id)?.missingData
  ).toMatchObject([{ reason: "NO_READING" }]);

  // A second run writes nothing.
  expect(await carryForwardMissingReadings(db, org.id, july.id, null)).toBe(0);

  // An admin can replace the carried reading with the real value.
  const real = await submitAdminReading(
    db,
    org.id,
    july.id,
    meter.id,
    "12.000",
    adminId
  );
  expect(real).toMatchObject({ source: "ADMIN", consumption: "2.000" });

  await cleanupOrganization(db, org.id);
});
