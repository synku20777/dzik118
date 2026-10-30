// Migration Center, meters and latest readings (ADR 0013). Requires Postgres
// via DATABASE_URL.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
import { auditLogs } from "../../src/db/schema/audit";
import {
  billingCases,
  billingPeriods,
  meterReadings,
} from "../../src/db/schema/billing";
import { dwellings, meters } from "../../src/db/schema/dwellings";
import { migrationImports } from "../../src/db/schema/migration";
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
import { recalculateCaseReadinessForOrganizationOpenPeriods } from "../../src/domain/periods/case-readiness";
import {
  NO_FIRST_PERIOD_MESSAGE,
  OPENING_LATER_READING_MESSAGE,
  listOpeningReadings,
  recordOpeningReadings,
} from "../../src/domain/periods/opening-readings";
import { parseTable } from "../../src/domain/migration/files";
import { proposeMapping } from "../../src/domain/migration/mapping";
import { findSavedMapping } from "../../src/domain/migration/dwellings";
import {
  ROW_METER_AFTER_START_ERROR,
  ROW_METER_AMBIGUOUS_ERROR,
  ROW_METER_DUPLICATE_ERROR,
  ROW_METER_OLDER_SKIP_MESSAGE,
  ROW_METER_READING_ERROR,
  ROW_METER_REPLACE_WARNING_MESSAGE,
  ROW_METER_SAME_DATE_ERROR,
  ROW_METER_SAME_SKIP_MESSAGE,
  ROW_METER_TYPE_ERROR,
  ROW_METER_UNIT_ERROR,
  importMeters,
  validateMeters,
} from "../../src/domain/migration/meters";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-migration-meters@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

const october = {
  year: 2026,
  month: 10,
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  invoiceIssueDate: "2026-10-31",
  invoiceDueDate: "2026-11-14",
};

async function newOrg(name: string, withPeriod = true) {
  const org = await createOrganization(
    db,
    { name, addressLine1: "1 Test St" },
    adminId
  );
  return { org, withPeriod };
}

async function dwelling(orgId: string, number: string) {
  return createDwelling(db, orgId, { number }, adminId);
}

async function period(orgId: string) {
  return createPeriod(db, orgId, october, adminId);
}

function fieldsFor(text: string): (string | null)[] {
  const table = parseTable(text);
  return proposeMapping(
    "METERS",
    table.headers,
    table.rows,
    table.delimiter
  ).map((p) => p.field);
}

async function run(orgId: string, text: string, fields = fieldsFor(text)) {
  return importMeters(
    db,
    orgId,
    {
      text,
      filename: "skaititaji.csv",
      fields,
      mappingSources: fields.map(() => "DICTIONARY" as const),
    },
    adminId
  );
}

const check = (orgId: string, text: string, fields = fieldsFor(text)) =>
  validateMeters(db, orgId, parseTable(text), fields);

const sheet = [
  "SIA Nams - skaitītāju rādījumi",
  "Dzīvokļa Nr.;Skaitītāja veids;Sērijas numurs;Rādījums;Datums",
  "1;Aukstais ūdens;S100;123,456;30.09.2026",
  "1;Karstais ūdens;S101;45,5;30.09.2026",
  "2;Elektrība;;1 200,5;30.09.2026",
  "Kopā;;;1 369,456;",
].join("\n");

describe("migration: meters and latest readings", () => {
  it("creates the meters, stores the readings as starting readings, audits", async () => {
    const { org } = await newOrg("IT-Met Post");
    await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    await period(org.id);

    expect(fieldsFor(sheet)).toEqual([
      "number",
      "meter_type",
      "serial_number",
      "reading",
      "reading_date",
    ]);
    const result = await run(org.id, sheet);
    expect(result).toMatchObject({ written: 3, createdMeters: 3, skipped: 0 });

    const created = await db
      .select()
      .from(meters)
      .where(eq(meters.organizationId, org.id));
    expect(
      created
        .map((m) => [m.type, m.serialNumber, m.unit])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    ).toEqual([
      ["COLD_WATER", "S100", "m3"],
      ["ELECTRICITY", null, "kWh"],
      ["HOT_WATER", "S101", "m3"],
    ]);

    const opening = await listOpeningReadings(db, org.id);
    expect(opening.map((r) => r.value).sort()).toEqual([
      "1200.500",
      "123.456",
      "45.500",
    ]);
    const [openingPeriod] = await db
      .select()
      .from(billingPeriods)
      .where(
        and(
          eq(billingPeriods.organizationId, org.id),
          eq(billingPeriods.openingReadings, true)
        )
      );
    expect(openingPeriod).toMatchObject({
      year: 2026,
      month: 9,
      status: "LOCKED",
    });

    const audit = async (action: string) =>
      (
        await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.organizationId, org.id),
              eq(auditLogs.action, action)
            )
          )
      ).length;
    expect(await audit("METER_CREATED")).toBe(3);
    expect(await audit("METER_OPENING_READING_RECORDED")).toBe(3);
    expect(await audit("MIGRATION_IMPORT_COMPLETED")).toBe(1);

    const [record] = await db
      .select()
      .from(migrationImports)
      .where(eq(migrationImports.organizationId, org.id));
    expect(record).toMatchObject({ kind: "METERS", createdCount: 3 });
    expect(
      await findSavedMapping(db, org.id, "METERS", parseTable(sheet).headers)
    ).not.toBeNull();
    await cleanupOrganization(db, org.id);
  });

  it("matches existing meters, then a rerun changes nothing and a new value replaces", async () => {
    const { org } = await newOrg("IT-Met Rerun");
    const d1 = await dwelling(org.id, "1");
    await period(org.id);
    const [existing] = await db
      .insert(meters)
      .values({
        organizationId: org.id,
        dwellingId: d1.id,
        type: "COLD_WATER",
        unit: "m3",
      })
      .returning();
    const text = "Nr;Veids;Rādījums\n1;auksts ūdens;100,5";
    const first = await run(org.id, text);
    expect(first).toMatchObject({ written: 1, createdMeters: 0 });
    expect((await listOpeningReadings(db, org.id))[0]).toMatchObject({
      meterId: existing.id,
      value: "100.500",
    });

    const again = await run(org.id, text);
    expect(again).toEqual({
      importId: null,
      written: 0,
      createdMeters: 0,
      skipped: 1,
    });
    expect((await check(org.id, text)).rows[0].skipReason).toBe(
      ROW_METER_SAME_SKIP_MESSAGE
    );

    const changed = "Nr;Veids;Rādījums\n1;auksts ūdens;101,25";
    const view = await check(org.id, changed);
    expect(view.rows[0]).toMatchObject({
      status: "POST",
      previousValue: "100.500",
      warnings: [ROW_METER_REPLACE_WARNING_MESSAGE],
    });
    await run(org.id, changed);
    expect((await listOpeningReadings(db, org.id))[0].value).toBe("101.250");
    expect(
      await db.select().from(meters).where(eq(meters.organizationId, org.id))
    ).toHaveLength(1);
    await cleanupOrganization(db, org.id);
  });

  it("reads a column where every reading has three decimals (comma decimals in a ; file)", async () => {
    const { org } = await newOrg("IT-Met Decimals");
    await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    await period(org.id);
    const text =
      "Nr;Veids;Rādījums\n1;auksts ūdens;123,456\n2;auksts ūdens;1 234,567";
    expect(fieldsFor(text)).toEqual(["number", "meter_type", "reading"]);
    const view = await check(org.id, text);
    expect(view.rows.map((r) => r.reading)).toEqual(["123.456", "1234.567"]);
    await cleanupOrganization(db, org.id);
  });

  it("needs a first billing period", async () => {
    const { org } = await newOrg("IT-Met NoPeriod");
    await dwelling(org.id, "1");
    await expect(
      check(org.id, "Nr;Veids;Rādījums\n1;auksts ūdens;1")
    ).rejects.toThrow(NO_FIRST_PERIOD_MESSAGE);
    await expect(
      run(org.id, "Nr;Veids;Rādījums\n1;auksts ūdens;1")
    ).rejects.toThrow();
    await cleanupOrganization(db, org.id);
  });

  it("a reading dated after the first period starts is an error", async () => {
    const { org } = await newOrg("IT-Met Date");
    await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    await period(org.id);
    const text = [
      "Nr;Veids;Rādījums;Datums",
      "1;auksts ūdens;10;01.10.2026",
      "2;auksts ūdens;10;02.10.2026",
    ].join("\n");
    const view = await check(org.id, text);
    expect(view.rows[0].status).toBe("POST");
    expect(view.rows[1].errors).toContain(ROW_METER_AFTER_START_ERROR);
    await cleanupOrganization(db, org.id);
  });

  it("keeps the latest of several dated readings of one meter, and refuses undated repeats", async () => {
    const { org } = await newOrg("IT-Met Latest");
    await dwelling(org.id, "1");
    await period(org.id);
    const dated = [
      "Nr;Veids;Sērijas numurs;Rādījums;Datums",
      "1;auksts ūdens;S1;10;31.07.2026",
      "1;auksts ūdens;S1;30;30.09.2026",
      "1;auksts ūdens;S1;20;31.08.2026",
    ].join("\n");
    const view = await check(org.id, dated);
    expect(view.rows.map((r) => r.status)).toEqual(["SKIP", "POST", "SKIP"]);
    expect(view.rows[0].skipReason).toBe(ROW_METER_OLDER_SKIP_MESSAGE);
    await run(org.id, dated);
    expect((await listOpeningReadings(db, org.id))[0].value).toBe("30.000");

    const undated =
      "Nr;Veids;Sērijas numurs;Rādījums\n1;auksts ūdens;S2;1\n1;auksts ūdens;S2;2";
    const bad = await check(org.id, undated);
    expect(
      bad.rows.every((r) => r.errors.includes(ROW_METER_DUPLICATE_ERROR))
    ).toBe(true);
    const sameDay = [
      "Nr;Veids;Sērijas numurs;Rādījums;Datums",
      "1;auksts ūdens;S3;1;30.09.2026",
      "1;auksts ūdens;S3;2;30.09.2026",
    ].join("\n");
    expect((await check(org.id, sameDay)).rows[0].errors).toContain(
      ROW_METER_SAME_DATE_ERROR
    );
    await cleanupOrganization(db, org.id);
  });

  it("blocks the import on error rows and writes nothing", async () => {
    const { org } = await newOrg("IT-Met Errors");
    const d1 = await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    await period(org.id);
    for (const serial of ["A", "B"]) {
      await db.insert(meters).values({
        organizationId: org.id,
        dwellingId: d1.id,
        type: "HOT_WATER",
        serialNumber: serial,
        unit: "m3",
      });
    }
    const text = [
      "Nr;Veids;Rādījums",
      "1;ūdens;5", // no temperature
      "2;karsts ūdens;-3", // negative
      "9;karsts ūdens;3", // unknown dwelling
      "1;karstais ūdens;4", // two hot water meters, no serial
      "2;siltums;7", // heat needs a unit
    ].join("\n");
    const view = await check(org.id, text);
    expect(view.counts).toMatchObject({ post: 0, error: 5 });
    expect(view.rows[0].errors).toContain(ROW_METER_TYPE_ERROR);
    expect(view.rows[1].errors).toContain(ROW_METER_READING_ERROR);
    expect(view.rows[3].errors).toContain(ROW_METER_AMBIGUOUS_ERROR);
    expect(view.rows[4].errors).toContain(ROW_METER_UNIT_ERROR);
    await expect(run(org.id, text)).rejects.toThrow("Fix the rows");
    expect(
      await db.select().from(meters).where(eq(meters.organizationId, org.id))
    ).toHaveLength(2);
    // The failed import rolled back its opening period too.
    expect(
      await db
        .select()
        .from(billingPeriods)
        .where(
          and(
            eq(billingPeriods.organizationId, org.id),
            eq(billingPeriods.openingReadings, true)
          )
        )
    ).toHaveLength(0);
    await cleanupOrganization(db, org.id);
  });

  it("a meter that already has a billing-period reading keeps its starting reading", async () => {
    const { org } = await newOrg("IT-Met Later");
    const d1 = await dwelling(org.id, "1");
    const p = await period(org.id);
    const [meter] = await db
      .insert(meters)
      .values({
        organizationId: org.id,
        dwellingId: d1.id,
        type: "COLD_WATER",
        unit: "m3",
      })
      .returning();
    await db.insert(meterReadings).values({
      organizationId: org.id,
      periodId: p.id,
      meterId: meter.id,
      currentValue: "50.000",
      consumption: "5.000",
      source: "ADMIN",
    });
    const view = await check(org.id, "Nr;Veids;Rādījums\n1;auksts ūdens;40");
    expect(view.rows[0].errors).toContain(OPENING_LATER_READING_MESSAGE);
    await cleanupOrganization(db, org.id);
  });

  it("an unchanged starting reading is skipped even after a later reading exists; counts split new and replaced", async () => {
    const { org } = await newOrg("IT-Met Unchanged");
    const d1 = await dwelling(org.id, "1");
    const p = await period(org.id);
    const text = "Nr;Veids;Rādījums\n1;auksts ūdens;100";
    const first = await run(org.id, text);
    const [meter] = await db
      .select()
      .from(meters)
      .where(eq(meters.dwellingId, d1.id));
    // Billing starts: a reading in the first period.
    await db.insert(meterReadings).values({
      organizationId: org.id,
      periodId: p.id,
      meterId: meter.id,
      currentValue: "110.000",
      consumption: "10.000",
      source: "ADMIN",
    });
    const view = await check(org.id, text);
    expect(view.rows[0]).toMatchObject({
      status: "SKIP",
      skipReason: ROW_METER_SAME_SKIP_MESSAGE,
    });
    // A different value is blocked.
    const changed = await check(org.id, "Nr;Veids;Rādījums\n1;auksts ūdens;99");
    expect(changed.rows[0].errors).toContain(OPENING_LATER_READING_MESSAGE);

    const [record] = await db
      .select()
      .from(migrationImports)
      .where(eq(migrationImports.id, first.importId!));
    expect(record).toMatchObject({ createdCount: 1, updatedCount: 0 });
    await cleanupOrganization(db, org.id);
  });

  it("a replaced starting reading is counted as updated", async () => {
    const { org } = await newOrg("IT-Met Replaced");
    await dwelling(org.id, "1");
    await period(org.id);
    await run(org.id, "Nr;Veids;Rādījums\n1;auksts ūdens;100");
    const second = await run(org.id, "Nr;Veids;Rādījums\n1;auksts ūdens;101");
    const [record] = await db
      .select()
      .from(migrationImports)
      .where(eq(migrationImports.id, second.importId!));
    expect(record).toMatchObject({ createdCount: 0, updatedCount: 1 });
    await cleanupOrganization(db, org.id);
  });

  it("another organization's meter is reported as missing, whatever readings it has", async () => {
    const a = await newOrg("IT-Met Oracle A");
    const b = await newOrg("IT-Met Oracle B");
    const db1 = await dwelling(b.org.id, "1");
    await dwelling(a.org.id, "1");
    await period(a.org.id);
    const pb = await period(b.org.id);
    const [foreign] = await db
      .insert(meters)
      .values({
        organizationId: b.org.id,
        dwellingId: db1.id,
        type: "COLD_WATER",
        unit: "m3",
      })
      .returning();
    await db.insert(meterReadings).values({
      organizationId: b.org.id,
      periodId: pb.id,
      meterId: foreign.id,
      currentValue: "5.000",
      consumption: "5.000",
      source: "ADMIN",
    });
    await expect(
      recordOpeningReadings(
        db,
        a.org.id,
        [{ meterId: foreign.id, value: "1" }],
        adminId
      )
    ).rejects.toThrow("Meter not found");
    await cleanupOrganization(db, a.org.id);
    await cleanupOrganization(db, b.org.id);
  });

  it("an import waits for a meter that is being added by hand and then uses it", async () => {
    const { org } = await newOrg("IT-Met Hand");
    const d1 = await dwelling(org.id, "1");
    await period(org.id);
    const other = await createIntegrationDb();
    await other.$client.query("begin");
    await other.$client.query(
      "insert into meters (organization_id, dwelling_id, type, serial_number, unit) values ($1, $2, 'COLD_WATER', 'S100', 'm3')",
      [org.id, d1.id]
    );
    const importing = run(
      org.id,
      "Nr;Veids;Sērijas numurs;Rādījums\n1;auksts ūdens;S100;7"
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await other.$client.query("commit");
    await other.$client.end();
    expect(await importing).toMatchObject({ written: 1, createdMeters: 0 });
    expect(
      await db.select().from(meters).where(eq(meters.dwellingId, d1.id))
    ).toHaveLength(1);
    await cleanupOrganization(db, org.id);
  });

  it("one organization cannot write into another's dwellings", async () => {
    const a = await newOrg("IT-Met A");
    const b = await newOrg("IT-Met B");
    await dwelling(a.org.id, "1");
    await dwelling(b.org.id, "7");
    await period(a.org.id);
    const view = await check(a.org.id, "Nr;Veids;Rādījums\n7;auksts ūdens;5");
    expect(view.counts.error).toBe(1);
    await cleanupOrganization(db, a.org.id);
    await cleanupOrganization(db, b.org.id);
  });

  it("new meters update the readiness of the open cases like the one-by-one recalculation", async () => {
    const { org } = await newOrg("IT-Met Ready");
    for (const n of ["1", "2", "3"]) await dwelling(org.id, n);
    await createRule(
      db,
      org.id,
      {
        name: "Cold water",
        code: "cold",
        calculationType: "METER_CONSUMPTION",
        meterType: "COLD_WATER",
        unit: "m3",
        unitPrice: "2.00",
        effectiveFrom: "2025-01-01",
      },
      adminId
    );
    const p = await period(org.id);
    const casesNow = async () =>
      (
        await db
          .select()
          .from(billingCases)
          .where(eq(billingCases.periodId, p.id))
      )
        .map((c) => [c.status, JSON.stringify(c.missingData)])
        .sort((x, y) => x[1].localeCompare(y[1]));
    const before = await casesNow();
    // No meter yet, so the cold-water rule applies to nobody.
    expect(before.every((c) => c[1].includes("NO_APPLICABLE_RULES"))).toBe(
      true
    );

    await run(
      org.id,
      "Nr;Veids;Rādījums\n1;auksts ūdens;1\n2;auksts ūdens;2\n3;elektrība;3"
    );
    const after = await casesNow();
    // Two dwellings now wait for a cold-water reading; the electricity one
    // still has no rule that applies.
    expect(after.filter((c) => c[1].includes("NO_READING"))).toHaveLength(2);
    expect(
      after.filter((c) => c[1].includes("NO_APPLICABLE_RULES"))
    ).toHaveLength(1);

    // The old, per-case code finds nothing left to change.
    await recalculateCaseReadinessForOrganizationOpenPeriods(db, org.id);
    expect(await casesNow()).toEqual(after);
    await cleanupOrganization(db, org.id);
  });

  it("2,000 readings import with a fixed number of statements", async () => {
    const { org } = await newOrg("IT-Met Bulk");
    const dwellingRows = Array.from({ length: 1000 }, (_, i) => ({
      organizationId: org.id,
      number: `M${i + 1}`,
    }));
    await db.insert(dwellings).values(dwellingRows);
    await period(org.id);
    const lines = ["Nr;Veids;Rādījums"];
    for (let i = 1; i <= 1000; i++) {
      lines.push(`M${i};auksts ūdens;${i}`, `M${i};karsts ūdens;${i + 1}`);
    }
    const client = db.$client as unknown as {
      query: (...a: unknown[]) => unknown;
    };
    const original = client.query.bind(client);
    let queries = 0;
    client.query = (...a: unknown[]) => {
      queries++;
      return original(...a);
    };
    const started = Date.now();
    let result;
    try {
      result = await run(org.id, lines.join("\n"));
    } finally {
      client.query = original;
    }
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `MIGRATION 2000 meter readings: ${seconds.toFixed(2)}s, ${queries} queries`
    );
    expect(result).toMatchObject({ written: 2000, createdMeters: 2000 });
    expect(queries).toBeLessThan(80);
    expect(seconds).toBeLessThan(20);
    await cleanupOrganization(db, org.id);
  }, 90_000);
});
