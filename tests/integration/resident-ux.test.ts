// Phase I (Resident UX) - domain-layer integration tests for the resident
// dashboard's new read helpers (spec Section 28). Requires a real Postgres
// reachable via DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import {
  createDwelling,
  listDwellingsForResident,
} from "../../src/domain/organizations/dwellings";
import { createMeter } from "../../src/domain/organizations/meters";
import { createPeriod } from "../../src/domain/periods/periods";
import { listConsumptionHistoryForDwelling } from "../../src/domain/periods/cases";
import { submitAdminReading } from "../../src/domain/periods/readings";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  getInvoiceForDwellingPeriod,
} from "../../src/domain/billing/generation";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-i-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

describe("resident dashboard read helpers", () => {
  it("getInvoiceForDwellingPeriod returns null before generation, then the invoice", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-I Org Invoice", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-28",
        invoiceIssueDate: "2026-01-28",
        invoiceDueDate: "2026-02-14",
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
        unitPrice: "10.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    const before = await getInvoiceForDwellingPeriod(
      db,
      dwelling.id,
      period.id
    );
    expect(before).toBeNull();

    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const after = await getInvoiceForDwellingPeriod(db, dwelling.id, period.id);
    expect(after?.id).toBe(invoice.id);

    await cleanupOrg(org.id);
  });

  it("listConsumptionHistoryForDwelling groups readings by period, newest first", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-I Org Consumption", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const coldMeter = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );
    const hotMeter = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "HOT_WATER", unit: "m3" },
      seedAdminId
    );
    const period1 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-28",
        invoiceIssueDate: "2026-01-28",
        invoiceDueDate: "2026-02-14",
      },
      seedAdminId
    );
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
    await submitAdminReading(
      db,
      org.id,
      period1.id,
      coldMeter.id,
      "10.000",
      seedAdminId
    );
    await submitAdminReading(
      db,
      org.id,
      period1.id,
      hotMeter.id,
      "5.000",
      seedAdminId
    );
    await submitAdminReading(
      db,
      org.id,
      period2.id,
      coldMeter.id,
      "16.000",
      seedAdminId
    );

    const rows = await listConsumptionHistoryForDwelling(db, dwelling.id);
    // Newest period first, one row per period (not per meter reading).
    expect(rows[0]).toEqual({
      year: 2026,
      month: 2,
      coldWaterConsumption: "6.000",
      hotWaterConsumption: null,
    });
    expect(rows[1]).toEqual({
      year: 2026,
      month: 1,
      coldWaterConsumption: "10.000",
      hotWaterConsumption: "5.000",
    });

    await cleanupOrg(org.id);
  });

  it("does not split a period's data across the period limit when a dwelling has extra meters", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-I Org ConsumptionLimit", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    // Two cold-water meters on one dwelling (e.g. a mid-history replacement)
    // -- a period can then contribute more than 2 rows.
    const meterA = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );
    const meterB = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-28",
        invoiceIssueDate: "2026-01-28",
        invoiceDueDate: "2026-02-14",
      },
      seedAdminId
    );
    await submitAdminReading(
      db,
      org.id,
      period.id,
      meterA.id,
      "1.000",
      seedAdminId
    );
    await submitAdminReading(
      db,
      org.id,
      period.id,
      meterB.id,
      "2.000",
      seedAdminId
    );

    const rows = await listConsumptionHistoryForDwelling(db, dwelling.id, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe(2026);
    expect(rows[0].month).toBe(1);

    await cleanupOrg(org.id);
  });
});

describe("listDwellingsForResident", () => {
  it("returns the requested dwellings, and an empty array for no ids", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-I Org DwellingBatch", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwellingA = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      org.id,
      { number: "2" },
      seedAdminId
    );

    const result = await listDwellingsForResident(db, [
      dwellingA.id,
      dwellingB.id,
    ]);
    expect(result.map((d) => d.id).sort()).toEqual(
      [dwellingA.id, dwellingB.id].sort()
    );
    expect(await listDwellingsForResident(db, [])).toEqual([]);

    await cleanupOrg(org.id);
  });
});
