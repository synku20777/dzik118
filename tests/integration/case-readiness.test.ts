// Domain-layer integration tests for src/domain/periods/case-readiness.ts
// (recalculateCaseReadiness, recalculateCaseReadinessForOpenPeriods,
// recalculateCaseReadinessForOrganizationOpenPeriods, wasMeterActiveDuringPeriod,
// deriveReadinessStatus).
// Requires a real Postgres reachable via DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import {
  archiveMeter,
  createMeter,
} from "../../src/domain/organizations/meters";
import { createRule } from "../../src/domain/billing/rules";
import { createPeriod, lockPeriod } from "../../src/domain/periods/periods";
import { listCasesForPeriod } from "../../src/domain/periods/cases";
import { submitAdminReading } from "../../src/domain/periods/readings";
import { submitManualRuleInput } from "../../src/domain/periods/manual-rule-inputs";
import {
  generateInvoice,
  overrideCaseStatus,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import {
  deriveReadinessStatus,
  recalculateCaseReadiness,
  recalculateCaseReadinessForOpenPeriods,
  recalculateCaseReadinessForOrganizationOpenPeriods,
  wasMeterActiveDuringPeriod,
} from "../../src/domain/periods/case-readiness";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-readiness-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

describe("case readiness recalculation", () => {
  it("a dwelling with a METER_CONSUMPTION rule for COLD_WATER and an active COLD_WATER meter and no reading: case status is MISSING_DATA with a NO_READING item; after submitAdminReading it becomes READY", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Readiness Org 1",
        addressLine1: "1 Test St",
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
    const meter = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3", label: "Kitchen Cold" },
      seedAdminId
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
        unitPrice: "2.5000",
        effectiveFrom: "2026-01-01",
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

    const [caseBefore] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseBefore.status).toBe("MISSING_DATA");
    expect(caseBefore.missingData).toEqual([
      {
        meterId: meter.id,
        meterType: "COLD_WATER",
        label: "Kitchen Cold",
        reason: "NO_READING",
      },
    ]);

    await submitAdminReading(
      db,
      org.id,
      period.id,
      meter.id,
      "12.500",
      seedAdminId
    );

    const [caseAfter] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseAfter.status).toBe("READY");
    expect(caseAfter.missingData).toEqual([]);

    await cleanupOrg(org.id);
  });

  it("a meter type that no applicable rule consumes does not create missing data", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Readiness Org 2",
        addressLine1: "2 Test St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "2", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "ELECTRICITY", unit: "kWh" },
      seedAdminId
    );

    // Rule consumes COLD_WATER, not ELECTRICITY
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

    const [caseRow] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseRow.status).toBe("READY");
    expect(caseRow.missingData).toEqual([]);

    await recalculateCaseReadiness(db, org.id, dwelling.id, period.id);
    const [recalculated] = await listCasesForPeriod(db, org.id, period.id);
    expect(recalculated.status).toBe("READY");
    expect(recalculated.missingData).toEqual([]);

    await cleanupOrg(org.id);
  });

  it("an archived meter that was active during the period still requires a reading; a meter created after the period ended does not (wasMeterActiveDuringPeriod)", async () => {
    const periodWindow = { startsOn: "2026-01-01", endsOn: "2026-01-31" };

    // Pure function checks for wasMeterActiveDuringPeriod
    expect(
      wasMeterActiveDuringPeriod(
        {
          installedAt: "2025-06-01",
          archivedAt: new Date("2026-01-15T00:00:00Z"),
        },
        periodWindow
      )
    ).toBe(true);
    expect(
      wasMeterActiveDuringPeriod(
        {
          installedAt: "2025-06-01",
          archivedAt: new Date("2026-02-01T00:00:00Z"),
        },
        periodWindow
      )
    ).toBe(true);
    expect(
      wasMeterActiveDuringPeriod(
        { installedAt: "2026-02-01", archivedAt: null },
        periodWindow
      )
    ).toBe(false);
    expect(
      wasMeterActiveDuringPeriod(
        {
          installedAt: "2025-01-01",
          archivedAt: new Date("2025-12-31T23:59:59Z"),
        },
        periodWindow
      )
    ).toBe(false);

    // Database integration check
    const org = await createOrganization(
      db,
      {
        name: "IT-Readiness Org 3",
        addressLine1: "3 Test St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "3", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    const meter1 = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3", installedAt: "2026-01-01" },
      seedAdminId
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

    // Archive meter1 after period1 started
    await archiveMeter(db, org.id, meter1.id, seedAdminId);

    // Recalculate: meter1 still requires a reading for period 1
    await recalculateCaseReadiness(db, org.id, dwelling.id, period.id);
    const [caseAfterArchive] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseAfterArchive.status).toBe("MISSING_DATA");
    expect(caseAfterArchive.missingData).toEqual([
      expect.objectContaining({
        meterId: meter1.id,
        meterType: "COLD_WATER",
        reason: "NO_READING",
      }),
    ]);

    // Create meter2 installed after period ended (2026-02-01 > 2026-01-31)
    const meter2 = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3", installedAt: "2026-02-01" },
      seedAdminId
    );
    await recalculateCaseReadiness(db, org.id, dwelling.id, period.id);
    const [caseAfterMeter2] = await listCasesForPeriod(db, org.id, period.id);
    const missingMeterIds = (
      caseAfterMeter2.missingData as { meterId?: string }[]
    ).map((m) => m.meterId);
    expect(missingMeterIds).toContain(meter1.id);
    expect(missingMeterIds).not.toContain(meter2.id);

    await cleanupOrg(org.id);
  });

  it("a MANUAL_QUANTITY or MANUAL_AMOUNT rule with no admin-supplied value produces missing data until input is supplied", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Readiness Org 4",
        addressLine1: "4 Test St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "4", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    const qtyRule = await createRule(
      db,
      org.id,
      {
        name: "Parking spaces",
        code: "parking",
        calculationType: "MANUAL_QUANTITY",
        unit: "space",
        unitPrice: "25.00",
        effectiveFrom: "2026-01-01",
      },
      seedAdminId
    );
    const amtRule = await createRule(
      db,
      org.id,
      {
        name: "Repair charge",
        code: "repair",
        calculationType: "MANUAL_AMOUNT",
        unit: "eur",
        effectiveFrom: "2026-01-01",
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

    const [caseBefore] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseBefore.status).toBe("MISSING_DATA");
    expect(caseBefore.missingData).toHaveLength(2);
    expect(caseBefore.missingData).toContainEqual({
      billingRuleId: qtyRule.id,
      ruleName: "Parking spaces",
      unit: "space",
      reason: "NO_MANUAL_INPUT",
    });
    expect(caseBefore.missingData).toContainEqual({
      billingRuleId: amtRule.id,
      ruleName: "Repair charge",
      unit: "eur",
      reason: "NO_MANUAL_INPUT",
    });

    await submitManualRuleInput(
      db,
      org.id,
      period.id,
      dwelling.id,
      qtyRule.id,
      "2.0000",
      seedAdminId
    );

    const [caseMid] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseMid.status).toBe("MISSING_DATA");
    expect(caseMid.missingData).toEqual([
      {
        billingRuleId: amtRule.id,
        ruleName: "Repair charge",
        unit: "eur",
        reason: "NO_MANUAL_INPUT",
      },
    ]);

    await submitManualRuleInput(
      db,
      org.id,
      period.id,
      dwelling.id,
      amtRule.id,
      "50.0000",
      seedAdminId
    );

    const [caseAfter] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseAfter.status).toBe("READY");
    expect(caseAfter.missingData).toEqual([]);

    await cleanupOrg(org.id);
  });

  it("a case with manualStatusOverride = true or a status past DRAFT is not moved back by recalculateCaseReadiness", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Readiness Org 5",
        addressLine1: "5 Test St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "5", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Base Fee",
        code: "base_fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "40.00",
        effectiveFrom: "2026-01-01",
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

    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const [caseDraft] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseDraft.status).toBe("DRAFT");

    // Add a COLD_WATER meter and rule to create missing data
    await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
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
      seedAdminId
    );

    // Recalculate: DRAFT status is retained despite newly missing meter reading
    await recalculateCaseReadiness(db, org.id, dwelling.id, period.id);
    const [caseAfterRecalc] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseAfterRecalc.status).toBe("DRAFT");
    expect(caseAfterRecalc.missingData).toHaveLength(1);

    // Prepare invoice (advances case to PREPARED, a status past DRAFT)
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);
    const [casePrepared] = await listCasesForPeriod(db, org.id, period.id);
    expect(casePrepared.status).toBe("PREPARED");

    // Recalculate: PREPARED status is not moved back
    await recalculateCaseReadiness(db, org.id, dwelling.id, period.id);
    const [caseStillPrepared] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseStillPrepared.status).toBe("PREPARED");

    // Manually override case status (manualStatusOverride = true)
    await db.$client.query(
      "update invoices set sent_at = now() where id = $1",
      [invoice.id]
    );
    const overridden = await overrideCaseStatus(
      db,
      org.id,
      invoice.billingCaseId,
      "SENT",
      "Sent manually to resident",
      seedAdminId
    );
    expect(overridden.status).toBe("SENT");
    expect(overridden.manualStatusOverride).toBe(true);

    // Recalculate: case with manualStatusOverride=true remains SENT
    await recalculateCaseReadiness(db, org.id, dwelling.id, period.id);
    const [caseStillSent] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseStillSent.status).toBe("SENT");

    await cleanupOrg(org.id);
  });

  it("recalculateCaseReadinessForOpenPeriods updates cases only in OPEN periods and skips LOCKED ones", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Readiness Org 6",
        addressLine1: "6 Test St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "6", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );

    // Period 1: Jan 2026, created before any meter exists -> READY
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
    await lockPeriod(db, org.id, period1.id, seedAdminId);

    // Period 2: Feb 2026, OPEN
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

    // Both start READY
    const [case1Before] = await listCasesForPeriod(db, org.id, period1.id);
    const [case2Before] = await listCasesForPeriod(db, org.id, period2.id);
    expect(case1Before.status).toBe("READY");
    expect(case2Before.status).toBe("READY");

    // Add COLD_WATER rule and meter
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
      seedAdminId
    );
    await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );

    // Explicitly run recalculateCaseReadinessForOpenPeriods
    await recalculateCaseReadinessForOpenPeriods(db, org.id, dwelling.id);

    // Locked Period 1 must remain untouched (READY, missingData: [])
    const [case1After] = await listCasesForPeriod(db, org.id, period1.id);
    expect(case1After.status).toBe("READY");
    expect(case1After.missingData).toEqual([]);

    // Open Period 2 must be updated to MISSING_DATA
    const [case2After] = await listCasesForPeriod(db, org.id, period2.id);
    expect(case2After.status).toBe("MISSING_DATA");
    expect(case2After.missingData).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("recalculateCaseReadinessForOrganizationOpenPeriods updates cases for all dwellings in open periods and skips locked periods", async () => {
    // Also asserts deriveReadinessStatus unit behavior
    expect(deriveReadinessStatus([])).toBe("READY");
    expect(
      deriveReadinessStatus([
        {
          meterId: "dummy-id",
          meterType: "COLD_WATER",
          label: null,
          reason: "NO_READING",
        },
      ])
    ).toBe("MISSING_DATA");

    const org = await createOrganization(
      db,
      {
        name: "IT-Readiness Org 7",
        addressLine1: "7 Test St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwellingA = await createDwelling(
      db,
      org.id,
      { number: "7A", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      org.id,
      { number: "7B", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );

    // Locked period
    const lockedPeriod = await createPeriod(
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
    await lockPeriod(db, org.id, lockedPeriod.id, seedAdminId);

    // Open period
    const openPeriod = await createPeriod(
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

    // Add an org-wide manual rule (applies to all dwellings)
    await createRule(
      db,
      org.id,
      {
        name: "Elevator Service",
        code: "elevator",
        calculationType: "MANUAL_AMOUNT",
        unit: "eur",
        effectiveFrom: "2026-01-01",
      },
      seedAdminId
    );

    await recalculateCaseReadinessForOrganizationOpenPeriods(db, org.id);

    // Open period cases for both dwellings become MISSING_DATA
    const openCases = await listCasesForPeriod(db, org.id, openPeriod.id);
    const openCaseA = openCases.find((c) => c.dwellingId === dwellingA.id);
    const openCaseB = openCases.find((c) => c.dwellingId === dwellingB.id);
    expect(openCaseA?.status).toBe("MISSING_DATA");
    expect(openCaseB?.status).toBe("MISSING_DATA");

    // Locked period cases remain READY
    const lockedCases = await listCasesForPeriod(db, org.id, lockedPeriod.id);
    const lockedCaseA = lockedCases.find((c) => c.dwellingId === dwellingA.id);
    const lockedCaseB = lockedCases.find((c) => c.dwellingId === dwellingB.id);
    expect(lockedCaseA?.status).toBe("READY");
    expect(lockedCaseB?.status).toBe("READY");

    await cleanupOrg(org.id);
  });
});
