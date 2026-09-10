// Phase E (Periods/meters/readings) - domain-layer integration tests
// (spec PER-001/002, MTR-001/002/003). Requires a real Postgres reachable
// via DATABASE_URL.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../src/db/client";
import { appUsers } from "../../src/db/schema/auth";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import {
  archiveMeter,
  createMeter,
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for integration tests");
}

let db: Db;
const seedAdminId = randomUUID();

beforeAll(async () => {
  db = await createDb(connectionString!);
  await db.insert(appUsers).values({
    id: seedAdminId,
    role: "ADMIN",
    emailSnapshot: "it-e-admin@example.com",
  });
});

afterAll(async () => {
  await db.$client.query("delete from app_users where id = $1", [seedAdminId]);
  await db.$client.end();
});

async function cleanupOrg(organizationId: string) {
  await db.$client.query(
    "delete from meter_readings where organization_id = $1",
    [organizationId]
  );
  await db.$client.query(
    "delete from billing_cases where organization_id = $1",
    [organizationId]
  );
  await db.$client.query(
    "delete from billing_periods where organization_id = $1",
    [organizationId]
  );
  await db.$client.query("delete from meters where organization_id = $1", [
    organizationId,
  ]);
  await db.$client.query("delete from audit_logs where organization_id = $1", [
    organizationId,
  ]);
  await db.$client.query("delete from dwellings where organization_id = $1", [
    organizationId,
  ]);
  await db.$client.query(
    "delete from organization_memberships where organization_id = $1",
    [organizationId]
  );
  await db.$client.query("delete from organizations where id = $1", [
    organizationId,
  ]);
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

  it("concurrent first-time submissions for the same meter/period both succeed (no raw unique-violation)", async () => {
    const connectionString = process.env.DATABASE_URL!;
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
    const dbA = await createDb(connectionString);
    const dbB = await createDb(connectionString);
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

  it("rejects a reading for a dwelling with no billing case in this period (dwelling created after the period)", async () => {
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
    // Created after the period, so createPeriod never snapshotted it into
    // a billing_case.
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
    await expect(
      submitAdminReading(
        db,
        org.id,
        period.id,
        lateMeter.id,
        "1.000",
        seedAdminId
      )
    ).rejects.toBeInstanceOf(NotFoundError);

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
