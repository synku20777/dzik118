// Phase E (Periods/meters/readings) - domain-layer integration tests
// (spec PER-001/002, MTR-001/002/003). Requires a real Postgres reachable
// via DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "../../src/db/client";
import { auditLogs } from "../../src/db/schema/audit";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  requireDatabaseUrl,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import {
  archiveMeter,
  createMeter,
  listMeters,
  updateMeter,
} from "../../src/domain/organizations/meters";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createPeriod,
  getPeriod,
  lockPeriod,
} from "../../src/domain/periods/periods";
import { listCasesForPeriod } from "../../src/domain/periods/cases";
import {
  submitAdminReading,
  submitResidentReading,
} from "../../src/domain/periods/readings";
import { lookupMutationReceipt } from "../../src/domain/mutations/receipts";
import { createRule } from "../../src/domain/billing/rules";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-e-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

async function setupOrgWithDwellingAndMeter(name: string) {
  const org = await createOrganization(
    db,
    { name, addressLine1: "Addr" },
    seedAdminId
  );
  const dwelling = await createDwelling(
    db,
    org.id,
    { number: "1" },
    seedAdminId
  );
  const meter = await createMeter(
    db,
    org.id,
    dwelling.id,
    { type: "COLD_WATER", unit: "m3" },
    seedAdminId
  );
  // A meter only counts as required missing data if an applicable
  // METER_CONSUMPTION rule actually consumes its type (case-readiness.ts) --
  // without this, every test in this file relying on the cold-water meter
  // producing NO_READING missing data would see none at all.
  await createRule(
    db,
    org.id,
    {
      name: "Cold water",
      code: "cold_water",
      calculationType: "METER_CONSUMPTION",
      meterType: "COLD_WATER",
      unit: "m3",
      unitPrice: "1.00",
      effectiveFrom: "2026-01-01",
    },
    seedAdminId
  );
  return { org, dwelling, meter };
}

describe("periods", () => {
  it("PER-001: creates a billing case per active dwelling with initial missing_data", async () => {
    const { org, dwelling, meter } =
      await setupOrgWithDwellingAndMeter("IT-E Org 1");
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        invoiceIssueDate: "2026-02-01",
        invoiceDueDate: "2026-02-15",
      },
      seedAdminId
    );
    const cases = await listCasesForPeriod(db, org.id, period.id);
    expect(cases).toHaveLength(1);
    expect(cases[0].dwellingId).toBe(dwelling.id);
    expect(cases[0].status).toBe("MISSING_DATA");
    expect(cases[0].missingData).toEqual([
      {
        meterId: meter.id,
        meterType: "COLD_WATER",
        label: null,
        reason: "NO_READING",
      },
    ]);
    await cleanupOrg(org.id);
  });

  it("case status moves MISSING_DATA -> READY once the last required reading is submitted", async () => {
    const { org, meter } = await setupOrgWithDwellingAndMeter("IT-E Org Ready");
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 3,
        startsOn: "2026-03-01",
        endsOn: "2026-03-31",
        invoiceIssueDate: "2026-04-01",
        invoiceDueDate: "2026-04-15",
      },
      seedAdminId
    );
    const [before] = await listCasesForPeriod(db, org.id, period.id);
    expect(before.status).toBe("MISSING_DATA");

    await submitAdminReading(
      db,
      org.id,
      period.id,
      meter.id,
      "10.000",
      seedAdminId
    );

    const [after] = await listCasesForPeriod(db, org.id, period.id);
    expect(after.status).toBe("READY");
    expect(after.missingData).toEqual([]);
    await cleanupOrg(org.id);
  });

  it("PER-001: rejects a duplicate org/year/month period", async () => {
    const { org } = await setupOrgWithDwellingAndMeter("IT-E Org 2");
    const input = {
      year: 2026,
      month: 2,
      startsOn: "2026-02-01",
      endsOn: "2026-02-28",
      invoiceIssueDate: "2026-03-01",
      invoiceDueDate: "2026-03-15",
    };
    await createPeriod(db, org.id, input, seedAdminId);
    await expect(
      createPeriod(db, org.id, input, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    await cleanupOrg(org.id);
  });

  it("PER-001: rejects invalid date ordering", async () => {
    const { org } = await setupOrgWithDwellingAndMeter("IT-E Org 3");
    await expect(
      createPeriod(
        db,
        org.id,
        {
          year: 2026,
          month: 3,
          startsOn: "2026-03-31",
          endsOn: "2026-03-01",
          invoiceIssueDate: "2026-04-01",
          invoiceDueDate: "2026-04-15",
        },
        seedAdminId
      )
    ).rejects.toBeInstanceOf(ValidationError);
    await cleanupOrg(org.id);
  });

  it("PER-002: lock rejects reading edits and is idempotent", async () => {
    const { org, meter } = await setupOrgWithDwellingAndMeter("IT-E Org 4");
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 4,
        startsOn: "2026-04-01",
        endsOn: "2026-04-30",
        invoiceIssueDate: "2026-05-01",
        invoiceDueDate: "2026-05-15",
      },
      seedAdminId
    );
    const locked = await lockPeriod(db, org.id, period.id, seedAdminId);
    expect(locked.status).toBe("LOCKED");

    const relocked = await lockPeriod(db, org.id, period.id, seedAdminId);
    expect(relocked.status).toBe("LOCKED");

    await expect(
      submitAdminReading(db, org.id, period.id, meter.id, "10.000", seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    await cleanupOrg(org.id);
  });

  it("cross-tenant: a period from another org is not found", async () => {
    const { org: orgA } = await setupOrgWithDwellingAndMeter("IT-E Org 5a");
    const { org: orgB } = await setupOrgWithDwellingAndMeter("IT-E Org 5b");
    const periodB = await createPeriod(
      db,
      orgB.id,
      {
        year: 2026,
        month: 5,
        startsOn: "2026-05-01",
        endsOn: "2026-05-31",
        invoiceIssueDate: "2026-06-01",
        invoiceDueDate: "2026-06-15",
      },
      seedAdminId
    );
    await expect(getPeriod(db, orgA.id, periodB.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
  });
});

describe("meters and readings", () => {
  it("retries meter creation with one client mutation ID without duplicating it", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Meter Idempotency", addressLine1: "Addr" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const key = crypto.randomUUID();
    const input = {
      type: "COLD_WATER" as const,
      unit: "m3",
      label: "Idempotent",
    };
    const first = await createMeter(
      db,
      org.id,
      dwelling.id,
      input,
      seedAdminId,
      key
    );
    const retry = await createMeter(
      db,
      org.id,
      dwelling.id,
      input,
      seedAdminId,
      key
    );

    expect(retry.id).toBe(first.id);
    expect(
      (await listMeters(db, org.id, dwelling.id)).filter(
        (row) => row.label === "Idempotent"
      )
    ).toHaveLength(1);

    const otherDwelling = await createDwelling(
      db,
      org.id,
      { number: "2" },
      seedAdminId
    );
    await expect(
      createMeter(db, org.id, otherDwelling.id, input, seedAdminId, key)
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await lookupMutationReceipt(db, org.id, key)).toMatchObject({
      state: "committed",
      entityType: "meter",
      scopeId: dwelling.id,
      entity: { id: first.id },
    });
    await db.$client.query("delete from meters where id = $1", [first.id]);
    expect(await lookupMutationReceipt(db, org.id, key)).toMatchObject({
      state: "committed",
      entity: null,
    });
    await cleanupOrg(org.id);
  });

  it("MTR-002: records an exact Decimal consumption and recalculates case readiness", async () => {
    const { org, meter } = await setupOrgWithDwellingAndMeter("IT-E Org 6");
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 6,
        startsOn: "2026-06-01",
        endsOn: "2026-06-30",
        invoiceIssueDate: "2026-07-01",
        invoiceDueDate: "2026-07-15",
      },
      seedAdminId
    );
    const reading = await submitAdminReading(
      db,
      org.id,
      period.id,
      meter.id,
      "100.100",
      seedAdminId
    );
    expect(reading.previousValue).toBeNull();
    expect(reading.consumption).toBe("100.100");

    const [caseAfter] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseAfter.missingData).toEqual([]);

    // Second period: exact subtraction, not float-rounded.
    const period2 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 7,
        startsOn: "2026-07-01",
        endsOn: "2026-07-31",
        invoiceIssueDate: "2026-08-01",
        invoiceDueDate: "2026-08-15",
      },
      seedAdminId
    );
    const reading2 = await submitAdminReading(
      db,
      org.id,
      period2.id,
      meter.id,
      "199.150",
      seedAdminId
    );
    expect(reading2.previousValue).toBe("100.100");
    expect(reading2.consumption).toBe("99.050");

    // Lower value rejected without force, accepted with it.
    await expect(
      submitAdminReading(
        db,
        org.id,
        period2.id,
        meter.id,
        "50.000",
        seedAdminId
      )
    ).rejects.toBeInstanceOf(ConflictError);
    const forced = await submitAdminReading(
      db,
      org.id,
      period2.id,
      meter.id,
      "50.000",
      seedAdminId,
      { force: true, note: "meter replaced" }
    );
    expect(forced.currentValue).toBe("50.000");
    // A confirmed reset's consumption is the new reading itself, not a
    // negative delta against a baseline the reset invalidated.
    expect(forced.consumption).toBe("50.000");

    // Editing period2's reading again is fine (no later reading exists
    // yet), but once a period3 reading exists, editing period2 is blocked.
    const period3 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 8,
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
        invoiceIssueDate: "2026-09-01",
        invoiceDueDate: "2026-09-15",
      },
      seedAdminId
    );
    await submitAdminReading(
      db,
      org.id,
      period3.id,
      meter.id,
      "60.000",
      seedAdminId
    );
    await expect(
      submitAdminReading(
        db,
        org.id,
        period2.id,
        meter.id,
        "55.000",
        seedAdminId,
        { force: true }
      )
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("MTR-001/E: archiving a meter mid-period still requires its reading (it was active during part of the period)", async () => {
    const { org, meter } = await setupOrgWithDwellingAndMeter("IT-E Org 7");
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 8,
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
        invoiceIssueDate: "2026-09-01",
        invoiceDueDate: "2026-09-15",
      },
      seedAdminId
    );
    let [caseRow] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseRow.missingData).toHaveLength(1);

    await archiveMeter(db, org.id, meter.id, seedAdminId);
    // Archiving mid-period still requires a reading for the part of the
    // period it was active, per computeMissingData's date-range rule --
    // this archive happens "now" (after the period started), so it should
    // still be required.
    [caseRow] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseRow.missingData).toHaveLength(1);

    // An admin can still back-fill a reading for it (it was active during
    // part of the period); a resident never can, archived or not.
    const backfilled = await submitAdminReading(
      db,
      org.id,
      period.id,
      meter.id,
      "3.000",
      seedAdminId
    );
    expect(backfilled.currentValue).toBe("3.000");
    [caseRow] = await listCasesForPeriod(db, org.id, period.id);
    expect(caseRow.missingData).toEqual([]);

    await expect(
      submitResidentReading(
        db,
        caseRow.dwellingId,
        period.id,
        meter.id,
        "4.000",
        seedAdminId
      )
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("MTR-001/E: updating a meter edits fields, writes audit log, prevents archived edits, preserves type", async () => {
    const { org, dwelling } = await setupOrgWithDwellingAndMeter("IT-E Org 8");
    const meter = await createMeter(
      db,
      org.id,
      dwelling.id,
      {
        type: "COLD_WATER",
        unit: "m3",
        serialNumber: "SN-ORIG",
        label: "Orig Label",
        installedAt: "2026-01-01",
      },
      seedAdminId
    );

    const updated = await updateMeter(
      db,
      org.id,
      meter.id,
      {
        serialNumber: "SN-UPDATED",
        label: "Updated Label",
        unit: "liters",
        installedAt: null,
      },
      seedAdminId
    );

    expect(updated.serialNumber).toBe("SN-UPDATED");
    expect(updated.label).toBe("Updated Label");
    expect(updated.unit).toBe("liters");
    expect(updated.installedAt).toBeNull();
    expect(updated.type).toBe("COLD_WATER");

    const meters = await listMeters(db, org.id, dwelling.id);
    const reRead = meters.find((m) => m.id === meter.id);
    expect(reRead).toBeDefined();
    expect(reRead?.serialNumber).toBe("SN-UPDATED");
    expect(reRead?.label).toBe("Updated Label");
    expect(reRead?.unit).toBe("liters");
    expect(reRead?.installedAt).toBeNull();
    expect(reRead?.type).toBe("COLD_WATER");

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.id),
          eq(auditLogs.action, "METER_UPDATED"),
          eq(auditLogs.entityId, meter.id)
        )
      );
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].entityType).toBe("meter");
    expect(auditRows[0].actorUserId).toBe(seedAdminId);

    const separateMeter = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "HOT_WATER", unit: "m3" },
      seedAdminId
    );
    await archiveMeter(db, org.id, separateMeter.id, seedAdminId);

    await expect(
      updateMeter(
        db,
        org.id,
        separateMeter.id,
        { label: "Should Reject" },
        seedAdminId
      )
    ).rejects.toBeInstanceOf(ConflictError);

    // The unit is locked once a reading exists; other fields stay editable.
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 9,
        startsOn: "2026-09-01",
        endsOn: "2026-09-30",
        invoiceIssueDate: "2026-10-01",
        invoiceDueDate: "2026-10-15",
      },
      seedAdminId
    );
    await submitAdminReading(
      db,
      org.id,
      period.id,
      meter.id,
      "1.000",
      seedAdminId
    );
    await expect(
      updateMeter(db, org.id, meter.id, { unit: "gallons" }, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    const relabeled = await updateMeter(
      db,
      org.id,
      meter.id,
      { label: "Still editable", unit: "liters" },
      seedAdminId
    );
    expect(relabeled.label).toBe("Still editable");

    // Another organization cannot edit this meter.
    await expect(
      updateMeter(
        db,
        crypto.randomUUID(),
        meter.id,
        { label: "Nope" },
        seedAdminId
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    await cleanupOrg(org.id);
  });

  it("reading deadline ends at midnight in the organization's timezone", async () => {
    const { org, meter } = await setupOrgWithDwellingAndMeter("IT-E Org 10");
    await db.$client.query(
      "update organizations set timezone = 'Pacific/Kiritimati' where id = $1",
      [org.id]
    );
    const open = await createPeriod(
      db,
      org.id,
      {
        year: 2099,
        month: 1,
        startsOn: "2099-01-01",
        endsOn: "2099-01-31",
        readingDeadline: "2099-01-16",
        invoiceIssueDate: "2099-02-01",
        invoiceDueDate: "2099-02-15",
      },
      seedAdminId
    );
    const closed = await createPeriod(
      db,
      org.id,
      {
        year: 2099,
        month: 2,
        startsOn: "2099-02-01",
        endsOn: "2099-02-28",
        readingDeadline: "2099-01-15",
        invoiceIssueDate: "2099-03-01",
        invoiceDueDate: "2099-03-15",
      },
      seedAdminId
    );
    const [openCase] = await listCasesForPeriod(db, org.id, open.id);
    // 12:00 UTC on Jan 15 is already Jan 16 in Kiritimati (UTC+14): the UTC
    // date would still be inside the "2099-01-15" deadline, the local date is not.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-15T12:00:00Z"));
    try {
      const ok = await submitResidentReading(
        db,
        openCase.dwellingId,
        open.id,
        meter.id,
        "1.000",
        seedAdminId
      );
      expect(ok.currentValue).toBe("1.000");
      await expect(
        submitResidentReading(
          db,
          openCase.dwellingId,
          closed.id,
          meter.id,
          "2.000",
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ConflictError);
    } finally {
      vi.useRealTimers();
    }
    await cleanupOrg(org.id);
  });

  it("concurrent first-time submissions for the same meter/period both succeed (no raw unique-violation)", async () => {
    const { org, meter } = await setupOrgWithDwellingAndMeter("IT-E Org 9");
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 10,
        startsOn: "2026-10-01",
        endsOn: "2026-10-31",
        invoiceIssueDate: "2026-11-01",
        invoiceDueDate: "2026-11-15",
      },
      seedAdminId
    );

    // Two separate connections, like two real concurrent HTTP requests
    // (withRequestDb opens a fresh createDb() per request) -- reusing one
    // connection here would serialize the two calls and hide the race.
    const dbA = await createDb(requireDatabaseUrl());
    const dbB = await createDb(requireDatabaseUrl());
    const [r1, r2] = await Promise.allSettled([
      submitAdminReading(
        dbA,
        org.id,
        period.id,
        meter.id,
        "5.000",
        seedAdminId
      ),
      submitAdminReading(
        dbB,
        org.id,
        period.id,
        meter.id,
        "5.000",
        seedAdminId
      ),
    ]);
    await dbA.$client.end();
    await dbB.$client.end();

    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");

    await cleanupOrg(org.id);
  });

  it("a dwelling created after the period already exists still gets a billing case in it (OPEN period), so its readings work", async () => {
    const { org } = await setupOrgWithDwellingAndMeter("IT-E Org 10");
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 11,
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        invoiceIssueDate: "2026-12-01",
        invoiceDueDate: "2026-12-15",
      },
      seedAdminId
    );
    // Created after the period -- createPeriod's own snapshot never saw it,
    // but createDwelling now backfills a case into every OPEN period itself.
    const lateDwelling = await createDwelling(
      db,
      org.id,
      { number: "late" },
      seedAdminId
    );
    const lateMeter = await createMeter(
      db,
      org.id,
      lateDwelling.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );

    const cases = await listCasesForPeriod(db, org.id, period.id);
    const lateCase = cases.find((c) => c.dwellingId === lateDwelling.id);
    expect(lateCase).toBeDefined();
    expect(lateCase?.status).toBe("MISSING_DATA");

    await submitAdminReading(
      db,
      org.id,
      period.id,
      lateMeter.id,
      "1.000",
      seedAdminId
    );
    const [updated] = await listCasesForPeriod(db, org.id, period.id).then(
      (rows) => rows.filter((c) => c.dwellingId === lateDwelling.id)
    );
    expect(updated.status).toBe("READY");

    await cleanupOrg(org.id);
  });

  it("a dwelling created after a period is LOCKED does not get a case in it", async () => {
    const { org } = await setupOrgWithDwellingAndMeter(
      "IT-E Org Locked Create"
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 12,
        startsOn: "2026-12-01",
        endsOn: "2026-12-31",
        invoiceIssueDate: "2027-01-01",
        invoiceDueDate: "2027-01-15",
      },
      seedAdminId
    );
    await lockPeriod(db, org.id, period.id, seedAdminId);

    const lateDwelling = await createDwelling(
      db,
      org.id,
      { number: "after-lock" },
      seedAdminId
    );

    const cases = await listCasesForPeriod(db, org.id, period.id);
    expect(cases.some((c) => c.dwellingId === lateDwelling.id)).toBe(false);

    await cleanupOrg(org.id);
  });

  it("MTR-003: resident reading rejects a meter from a different dwelling", async () => {
    const { org, dwelling, meter } =
      await setupOrgWithDwellingAndMeter("IT-E Org 8");
    const otherDwelling = await createDwelling(
      db,
      org.id,
      { number: "2" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 9,
        startsOn: "2026-09-01",
        endsOn: "2026-09-30",
        invoiceIssueDate: "2026-10-01",
        invoiceDueDate: "2026-10-15",
      },
      seedAdminId
    );

    await expect(
      submitResidentReading(
        db,
        otherDwelling.id,
        period.id,
        meter.id,
        "10.000",
        seedAdminId
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    const reading = await submitResidentReading(
      db,
      dwelling.id,
      period.id,
      meter.id,
      "10.000",
      seedAdminId
    );
    expect(reading.source).toBe("RESIDENT");

    await cleanupOrg(org.id);
  });
});
