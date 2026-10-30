// Migration Center, dwellings (ADR 0013). Requires Postgres via DATABASE_URL.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
import { auditLogs } from "../../src/db/schema/audit";
import { billingCases } from "../../src/db/schema/billing";
import { dwellings } from "../../src/db/schema/dwellings";
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
import { parseTable } from "../../src/domain/migration/files";
import {
  fingerprintHeaders,
  proposeMapping,
  toSavedMapping,
} from "../../src/domain/migration/mapping";
import {
  findSavedMapping,
  importDwellings,
  validateDwellings,
  type DwellingImportMode,
} from "../../src/domain/migration/dwellings";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-migration-admin@example.com");
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

async function newOrg(name: string) {
  return createOrganization(db, { name, addressLine1: "1 Test St" }, adminId);
}

function fieldsFor(text: string): (string | null)[] {
  const table = parseTable(text);
  return proposeMapping("DWELLINGS", table.headers, table.rows).map(
    (p) => p.field
  );
}

async function run(
  orgId: string,
  text: string,
  mode: DwellingImportMode = "create",
  fields = fieldsFor(text)
) {
  return importDwellings(
    db,
    orgId,
    {
      text,
      filename: "dzivokli.csv",
      fields,
      mappingSources: fields.map(() => "DICTIONARY" as const),
      mode,
    },
    adminId
  );
}

const latvian = [
  "SIA Nams - dzīvokļu saraksts",
  "",
  "Dzīvokļa Nr.;Īpašnieks;E-pasts;Platība, m²;Iedzīvotāju skaits;Piegāde",
  "1;Jānis Bērziņš;janis@example.lv;45,5;2;e-pasts",
  "2;Anna Ozola;;60;3;papīrs",
  "3;Pēteris Kalniņš;peteris@example.lv;72,25;1;abi",
  "Kopā;;;177,75;6;",
].join("\n");

describe("migration: dwellings", () => {
  it("imports a Latvian Excel sheet: mapping, parsing, delivery, cases, audit, saved mapping", async () => {
    const org = await newOrg("IT-Mig Latvian");
    await createPeriod(db, org.id, october, adminId);

    const result = await run(org.id, latvian);
    expect(result).toMatchObject({ created: 3, updated: 0, skipped: 0 });
    expect(result.importId).not.toBeNull();

    const rows = await db
      .select()
      .from(dwellings)
      .where(eq(dwellings.organizationId, org.id))
      .orderBy(dwellings.number);
    expect(rows.map((r) => r.number)).toEqual(["1", "2", "3"]);
    expect(rows[0]).toMatchObject({
      occupantName: "Jānis Bērziņš",
      billingEmail: "janis@example.lv",
      areaM2: "45.50",
      residentCount: 2,
      invoiceByEmail: true,
      invoiceByPaper: false,
    });
    expect(rows[1]).toMatchObject({
      areaM2: "60.00",
      invoiceByEmail: false,
      invoiceByPaper: true,
    });
    expect(rows[2]).toMatchObject({
      areaM2: "72.25",
      invoiceByEmail: true,
      invoiceByPaper: true,
    });

    // A case in the current period for each new dwelling (batched).
    const cases = await db
      .select()
      .from(billingCases)
      .where(eq(billingCases.organizationId, org.id));
    expect(cases).toHaveLength(3);

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.id),
          eq(auditLogs.action, "DWELLING_CREATED")
        )
      );
    expect(audit).toHaveLength(3);
    expect(audit[0].scopeDwellingId).not.toBeNull();

    const [record] = await db
      .select()
      .from(migrationImports)
      .where(eq(migrationImports.organizationId, org.id));
    expect(record).toMatchObject({
      kind: "DWELLINGS",
      createdCount: 3,
      rowCount: 3,
    });

    // The mapping is remembered for the next sheet with these headers.
    const table = parseTable(latvian);
    const saved = await findSavedMapping(
      db,
      org.id,
      "DWELLINGS",
      table.headers
    );
    expect(saved).toEqual(toSavedMapping(table.headers, fieldsFor(latvian)));
    expect(await fingerprintHeaders(table.headers)).toBe(record.fingerprint);

    await cleanupOrganization(db, org.id);
  });

  it("running the same file again changes nothing and writes no record", async () => {
    const org = await newOrg("IT-Mig Rerun");
    await run(org.id, latvian);
    const again = await run(org.id, latvian);
    expect(again).toEqual({
      importId: null,
      created: 0,
      updated: 0,
      skipped: 3,
    });
    const records = await db
      .select()
      .from(migrationImports)
      .where(eq(migrationImports.organizationId, org.id));
    expect(records).toHaveLength(1);
    await cleanupOrganization(db, org.id);
  });

  it("update mode patches only the mapped columns", async () => {
    const org = await newOrg("IT-Mig Update");
    await createDwelling(
      db,
      org.id,
      {
        number: "1",
        billingAddress: "Brīvības 1, Rīga",
        areaM2: "50",
        residentCount: 4,
        occupantName: "Old Name",
      },
      adminId
    );
    await createDwelling(db, org.id, { number: "2", areaM2: "30" }, adminId);
    // Only the number and the delivery column are in the file. Both rows share
    // one patch, so they are saved with one statement.
    const text = "Nr;Piegāde\n1;papīrs\n2;papīrs\n";
    const result = await run(org.id, text, "update");
    expect(result).toMatchObject({ created: 0, updated: 2 });
    const all = await db
      .select()
      .from(dwellings)
      .where(eq(dwellings.organizationId, org.id));
    expect(all.every((d) => d.invoiceByPaper && !d.invoiceByEmail)).toBe(true);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.id),
          eq(auditLogs.action, "DWELLING_UPDATED")
        )
      );
    expect(audit).toHaveLength(2);
    // The audit keeps what the patched fields held before.
    expect(audit[0].beforeData).toMatchObject({
      invoiceByEmail: true,
      invoiceByPaper: false,
    });
    const row = all.find((d) => d.number === "1")!;
    expect(row).toMatchObject({
      invoiceByEmail: false,
      invoiceByPaper: true,
      billingAddress: "Brīvības 1, Rīga",
      areaM2: "50.00",
      residentCount: 4,
      occupantName: "Old Name",
    });
    await cleanupOrganization(db, org.id);
  });

  it("blocks the import on any error row and says what is wrong", async () => {
    const org = await newOrg("IT-Mig Errors");
    const text = [
      "Nr;E-pasts;Platība;Iedzīvotāju skaits;Piegāde",
      "1;not-an-email;45;2;e-pasts",
      "1;a@b.lv;45;2;e-pasts",
      "2;a@b.lv;abc;x;carrier pigeon",
      ";a@b.lv;45;2;e-pasts",
    ].join("\n");
    const fields = fieldsFor(text);
    const table = parseTable(text);
    const { rows, counts } = await validateDwellings(
      db,
      org.id,
      table,
      fields,
      "create"
    );
    expect(counts.error).toBe(4);
    expect(rows[0].errors).toEqual(["The billing email is not valid"]);
    expect(rows[1].errors).toEqual([
      "This dwelling number appears more than once in the file",
    ]);
    expect(rows[2].errors).toHaveLength(3);
    expect(rows[3].errors).toEqual(["The dwelling number is empty"]);
    await expect(run(org.id, text)).rejects.toThrow("Fix the rows");
    const none = await db
      .select()
      .from(dwellings)
      .where(eq(dwellings.organizationId, org.id));
    expect(none).toHaveLength(0);
    await cleanupOrganization(db, org.id);
  });

  it("refuses a tampered mapping and keeps dwelling numbers as text", async () => {
    const org = await newOrg("IT-Mig Mapping");
    const text = "Nr;Platība\n01;45\n1;50\n";
    // No column mapped to the number.
    await expect(
      run(org.id, text, "create", [null, "area_m2"])
    ).rejects.toThrow("mapping is not valid");
    await expect(
      run(org.id, text, "create", ["number", "balance"])
    ).rejects.toThrow("mapping is not valid");
    // "01" and "1" are two different dwellings.
    const result = await run(org.id, text);
    expect(result.created).toBe(2);
    const rows = await db
      .select({ number: dwellings.number })
      .from(dwellings)
      .where(eq(dwellings.organizationId, org.id))
      .orderBy(dwellings.number);
    expect(rows.map((r) => r.number)).toEqual(["01", "1"]);
    await cleanupOrganization(db, org.id);
  });

  it("the same numbers in another organization do not collide", async () => {
    const a = await newOrg("IT-Mig A");
    const b = await newOrg("IT-Mig B");
    await run(a.id, latvian);
    expect((await run(b.id, latvian)).created).toBe(3);
    await cleanupOrganization(db, a.id);
    await cleanupOrganization(db, b.id);
  });

  it("imports 2,000 dwellings in a fixed number of queries", async () => {
    const org = await newOrg("IT-Mig Large");
    await createPeriod(db, org.id, october, adminId);
    const text =
      "Nr;Platība;Piegāde\n" +
      Array.from(
        { length: 2000 },
        (_, i) => `${i + 1};${40 + (i % 60)},5;e-pasts`
      ).join("\n");
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
      result = await run(org.id, text);
    } finally {
      client.query = original;
    }
    const seconds = (Date.now() - started) / 1000;
    expect(result.created).toBe(2000);
    // Bulk inserts and one batch of readiness queries, not several queries per
    // dwelling. 2,000 rows are 4 insert chunks of 500 for dwellings, cases
    // and audit logs.
    expect(queries).toBeLessThan(60);
    expect(seconds).toBeLessThan(15);
    const cases = await db
      .select()
      .from(billingCases)
      .where(eq(billingCases.organizationId, org.id));
    expect(cases).toHaveLength(2000);
    console.log(`MIGRATION 2000 dwellings: ${seconds}s, ${queries} queries`);
    await cleanupOrganization(db, org.id);
  }, 60_000);
});
