// Guided setup (ADR 0012): progress, range entry, charge presets, and
// starting readings in the opening period. Requires Postgres via DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
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
import { importDwellingsCsv } from "../../src/domain/organizations/csv-import";
import {
  dwellingRangeToCsv,
  parseDwellingRange,
} from "../../src/domain/organizations/dwelling-range";
import { applyChargePresets } from "../../src/domain/onboarding/presets";
import { getSetupProgress } from "../../src/domain/onboarding/progress";
import {
  importOpeningReadingsCsv,
  recordOpeningReadings,
} from "../../src/domain/periods/opening-readings";
import {
  addDwellingToPeriod,
  createPeriod,
  getCurrentOpenPeriod,
  getFirstBillingPeriod,
  listPeriods,
  lockPeriod,
  reopenPeriod,
} from "../../src/domain/periods/periods";
import { submitAdminReading } from "../../src/domain/periods/readings";
import { listConsumptionHistoryForDwelling } from "../../src/domain/periods/cases";
import {
  generateInvoice,
  getInvoice,
} from "../../src/domain/billing/generation";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-onboarding-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

async function newOrg(name: string) {
  return createOrganization(db, { name, addressLine1: "1 Test St" }, adminId);
}

const october = {
  year: 2026,
  month: 10,
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  invoiceIssueDate: "2026-10-31",
  invoiceDueDate: "2026-11-14",
};

describe("guided setup", () => {
  it("a maintenance-only organization: range entry, presets, progress, never sends", async () => {
    const org = await newOrg("IT-Setup Maintenance");
    let progress = await getSetupProgress(db, org.id);
    expect(progress.steps).toEqual({
      organization: true,
      dwellings: false,
      period: false,
      charges: false,
      meters: false,
    });

    // Range entry through the dwelling import, confirmed twice with one key.
    const numbers = parseDwellingRange("1-3");
    const csv = dwellingRangeToCsv(
      numbers.map((n) => ({
        number: n,
        type: "APARTMENT",
        areaM2: "50",
        residentCount: "2",
      }))
    );
    const key = crypto.randomUUID();
    const first = await importDwellingsCsv(
      db,
      org.id,
      csv,
      "create",
      adminId,
      key
    );
    expect(first.created).toBe(3);
    const again = await importDwellingsCsv(
      db,
      org.id,
      csv,
      "create",
      adminId,
      key
    );
    expect(again).toMatchObject({ created: 0, replayed: true });

    await expect(
      applyChargePresets(
        db,
        org.id,
        [{ key: "maintenance", unitPrice: "0.50", vatRate: "0" }],
        adminId
      )
    ).rejects.toThrow("first billing period");

    await createPeriod(db, org.id, october, adminId);
    const results = await applyChargePresets(
      db,
      org.id,
      [{ key: "maintenance", unitPrice: "0.50", vatRate: "21" }],
      adminId
    );
    expect(results).toMatchObject([{ key: "maintenance", outcome: "CREATED" }]);
    // Rerunnable: the second run reports the existing rule.
    expect(
      await applyChargePresets(
        db,
        org.id,
        [
          { key: "maintenance", unitPrice: "0.50", vatRate: "21" },
          { key: "fixed", unitPrice: "5", vatRate: "0" },
        ],
        adminId
      )
    ).toMatchObject([
      { key: "maintenance", outcome: "EXISTS" },
      { key: "fixed", outcome: "CREATED" },
    ]);

    progress = await getSetupProgress(db, org.id);
    expect(progress.complete).toBe(true);
    expect(progress.readyToGenerate).toBe(true);
    // No bank details and no recipients yet: not ready to prepare.
    expect(progress.issuerMissing).toEqual(["bank name", "IBAN"]);
    expect(progress.recipientsIncomplete).toBe(3);
    expect(progress.billingEmailsMissing).toBe(3);

    await updateOrganization(
      db,
      org.id,
      { bankName: "Test Bank", iban: "LV00TEST0000000000000" },
      adminId
    );
    expect((await getSetupProgress(db, org.id)).issuerMissing).toEqual([]);

    await cleanupOrganization(db, org.id);
  });

  it("a metered organization: starting readings make month one bill the difference", async () => {
    const org = await newOrg("IT-Setup Metered");
    const apartment = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "40", residentCount: 1 },
      adminId
    );
    const noWaterRule = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "40", residentCount: 1 },
      adminId
    );
    const october2026 = await createPeriod(db, org.id, october, adminId);
    const [cold] = await applyChargePresets(
      db,
      org.id,
      [{ key: "coldWater", unitPrice: "2", vatRate: "0" }],
      adminId
    );
    expect(cold.outcome).toBe("CREATED");
    const meter = await createMeter(
      db,
      org.id,
      apartment.id,
      { type: "COLD_WATER", unit: "m3" },
      adminId
    );

    let progress = await getSetupProgress(db, org.id);
    expect(progress.steps.meters).toBe(false);
    expect(progress.metersWithoutStartingReading).toBe(1);
    // Dwelling 2 has no cold-water meter: the org-wide rule does not apply
    // there, so no meter is required for it.
    expect(progress.blockers.NO_APPLICABLE_RULES).toBe(1);

    await recordOpeningReadings(
      db,
      org.id,
      [{ meterId: meter.id, value: "1234.500" }],
      adminId
    );
    progress = await getSetupProgress(db, org.id);
    expect(progress.steps.meters).toBe(true);

    // The opening period: September, locked, no cases, never billed.
    const periods = await listPeriods(db, org.id);
    const opening = periods.find((p) => p.openingReadings)!;
    expect(opening).toMatchObject({ year: 2026, month: 9, status: "LOCKED" });
    expect((await getFirstBillingPeriod(db, org.id))?.id).toBe(october2026.id);
    expect((await getCurrentOpenPeriod(db, org.id))?.id).toBe(october2026.id);
    await expect(reopenPeriod(db, org.id, opening.id, adminId)).rejects.toThrow(
      "starting readings"
    );
    await expect(
      addDwellingToPeriod(db, org.id, opening.id, noWaterRule.id, adminId)
    ).rejects.toThrow("starting readings");

    // Month one: 1240.0 - 1234.5 = 5.5 m3.
    await submitAdminReading(
      db,
      org.id,
      october2026.id,
      meter.id,
      "1240.000",
      adminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      october2026.id,
      apartment.id,
      adminId
    );
    const { lines } = await getInvoice(db, org.id, invoice.id);
    expect(lines[0].quantity).toBe("5.5000");
    expect(invoice.subtotal).toBe("11.00");

    // The opening month is not shown as usage.
    const history = await listConsumptionHistoryForDwelling(db, apartment.id);
    expect(history.map((h) => `${h.year}-${h.month}`)).toEqual(["2026-10"]);

    // No billing month may be created at or before the opening month, so
    // there is only ever one opening period.
    await expect(
      createPeriod(
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
      )
    ).rejects.toThrow("starting readings");

    // The start can no longer change: October's consumption depends on it.
    await expect(
      recordOpeningReadings(
        db,
        org.id,
        [{ meterId: meter.id, value: "1000.000" }],
        adminId
      )
    ).rejects.toThrow("later reading");

    await cleanupOrganization(db, org.id);
  });

  it("imports last month's readings from CSV, creating missing meters", async () => {
    const org = await newOrg("IT-Setup CSV");
    const other = await newOrg("IT-Setup CSV Other");
    await createDwelling(db, org.id, { number: "7", areaM2: "30" }, adminId);
    await createPeriod(db, org.id, october, adminId);

    const bad =
      "dwelling_number,meter_type,serial_number,unit,reading\n99,COLD_WATER,,m3,10\n";
    await expect(
      importOpeningReadingsCsv(db, org.id, bad, adminId)
    ).rejects.toThrow("Fix the rows");

    const good =
      'dwelling_number,meter_type,serial_number,unit,reading\n7,COLD_WATER,CW-7,m3,"88,5"\n7,HOT_WATER,HW-7,m3,40\n';
    expect(await importOpeningReadingsCsv(db, org.id, good, adminId)).toEqual({
      createdMeters: 2,
      written: 2,
    });
    // A second import updates the same meters, it does not duplicate them.
    expect(await importOpeningReadingsCsv(db, org.id, good, adminId)).toEqual({
      createdMeters: 0,
      written: 2,
    });

    // Another organization's meter id is refused.
    const otherDwelling = await createDwelling(
      db,
      other.id,
      { number: "1" },
      adminId
    );
    const otherMeter = await createMeter(
      db,
      other.id,
      otherDwelling.id,
      { type: "COLD_WATER", unit: "m3" },
      adminId
    );
    await expect(
      recordOpeningReadings(
        db,
        org.id,
        [{ meterId: otherMeter.id, value: "1" }],
        adminId
      )
    ).rejects.toThrow("Meter not found");

    await cleanupOrganization(db, org.id);
    await cleanupOrganization(db, other.id);
  });

  it("progress uses a fixed number of queries however many dwellings exist", async () => {
    const queriesFor = async (n: number) => {
      const org = await newOrg(`IT-Setup Queries ${n}`);
      const csv = dwellingRangeToCsv(
        parseDwellingRange(`1-${n}`).map((x) => ({
          number: x,
          type: "APARTMENT",
          areaM2: "50",
          residentCount: "2",
        }))
      );
      await importDwellingsCsv(db, org.id, csv, "create", adminId);
      await createPeriod(db, org.id, october, adminId);
      await applyChargePresets(
        db,
        org.id,
        [
          { key: "maintenance", unitPrice: "0.5", vatRate: "0" },
          { key: "coldWater", unitPrice: "2", vatRate: "0" },
        ],
        adminId
      );
      const client = db.$client as unknown as {
        query: (...a: unknown[]) => unknown;
      };
      const original = client.query.bind(client);
      let count = 0;
      client.query = (...a: unknown[]) => {
        count++;
        return original(...a);
      };
      try {
        await getSetupProgress(db, org.id);
      } finally {
        client.query = original;
      }
      await cleanupOrganization(db, org.id);
      return count;
    };
    const small = await queriesFor(3);
    const large = await queriesFor(40);
    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(15);
  });

  it("shows a locked first period as a setup blocker", async () => {
    const org = await newOrg("IT-Setup Locked");
    await createDwelling(db, org.id, { number: "1", areaM2: "30" }, adminId);
    const period = await createPeriod(db, org.id, october, adminId);
    await lockPeriod(db, org.id, period.id, adminId);
    const progress = await getSetupProgress(db, org.id);
    expect(progress.firstPeriodLocked).toBe(true);
    expect(progress.steps.period).toBe(false);
    await cleanupOrganization(db, org.id);
  });
});
