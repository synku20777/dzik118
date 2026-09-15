// Phase D (Organizations/dwellings) - domain-layer integration tests
// (spec ORG-001/002, DWL-001/002/003/004). Requires a real Postgres
// reachable via DATABASE_URL, and a real Supabase project (SUPABASE_URL/
// SUPABASE_SECRET_KEY) for the resident/admin provisioning tests.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { organizationMemberships } from "../../src/db/schema/organizations";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  archiveDwelling,
  assignResident,
  createDwelling,
  getDwelling,
  listDwellingResidents,
  listDwellings,
  updateDwelling,
  updateInvoiceDeliveryPreferences,
} from "../../src/domain/organizations/dwellings";
import {
  addAdminMembership,
  createOrganization,
  removeAdminMembership,
  updateOrganization,
} from "../../src/domain/organizations/organizations";
import {
  importDwellingsCsv,
  validateDwellingsCsv,
} from "../../src/domain/organizations/csv-import";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SECRET_KEY are required for integration tests"
  );
}

let db: Db;
let seedAdminId: string;
const supabaseAdmin = createSupabaseAdminClient(supabaseUrl, supabaseSecretKey);

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-d-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

describe("organizations", () => {
  it("ORG-001: create sets defaults, grants creator membership, and audits", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Org", addressLine1: "Addr" },
      seedAdminId
    );
    expect(org.currency).toBe("EUR");
    expect(org.timezone).toBe("Europe/Riga");
    expect(org.locale).toBe("lv");

    const [membership] = await db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, org.id));
    expect(membership.userId).toBe(seedAdminId);

    await cleanupOrg(org.id);
  });

  it("ORG-002: update persists and records before/after in the audit log", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Org 2", addressLine1: "Addr" },
      seedAdminId
    );
    const updated = await updateOrganization(
      db,
      org.id,
      { name: "IT Org 2 Renamed" },
      seedAdminId
    );
    expect(updated.name).toBe("IT Org 2 Renamed");
    await cleanupOrg(org.id);
  });

  it("refuses to remove the last admin membership of an organization", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Org 3", addressLine1: "Addr" },
      seedAdminId
    );
    await expect(
      removeAdminMembership(db, org.id, seedAdminId, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    await cleanupOrg(org.id);
  });

  it("addAdminMember provisions a new identity and grants membership; removal then succeeds with 2+ admins", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Org 4", addressLine1: "Addr" },
      seedAdminId
    );
    const email = `it-admin2-${randomUUID()}@example.com`;
    const added = await addAdminMembership(
      db,
      org.id,
      email,
      seedAdminId,
      supabaseAdmin
    );
    expect(added.email).toBe(email);

    await removeAdminMembership(db, org.id, added.userId, seedAdminId);
    const [remainingMembership] = await db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, org.id));
    expect(remainingMembership.userId).toBe(seedAdminId);

    await db.$client.query("delete from app_users where id = $1", [
      added.userId,
    ]);
    await cleanupOrg(org.id);
  }, 20_000);
});

describe("dwellings (spec DWL-001/002/003)", () => {
  it("DWL-001: unique within org, but another org may reuse the same number", async () => {
    const orgA = await createOrganization(
      db,
      { name: "IT Dwl Org A", addressLine1: "Addr" },
      seedAdminId
    );
    const orgB = await createOrganization(
      db,
      { name: "IT Dwl Org B", addressLine1: "Addr" },
      seedAdminId
    );

    const dwellingA = await createDwelling(
      db,
      orgA.id,
      { number: "SAME" },
      seedAdminId
    );
    await expect(
      createDwelling(db, orgA.id, { number: "SAME" }, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    const dwellingB = await createDwelling(
      db,
      orgB.id,
      { number: "SAME" },
      seedAdminId
    );
    expect(dwellingB.number).toBe(dwellingA.number);

    // Cross-tenant isolation: a dwelling scoped to org B must not be
    // reachable through org A's id, even by its own real UUID (spec Section
    // 33's "High-risk failure to test", applied to this phase's resources).
    await expect(getDwelling(db, orgA.id, dwellingB.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(
      updateDwelling(db, orgA.id, dwellingB.id, { notes: "x" }, seedAdminId)
    ).rejects.toThrow();

    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
  });

  it("invoice delivery: defaults to email-only, rejects turning both methods off, allows paper-only", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Dwl Org Delivery", addressLine1: "Addr" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    expect(dwelling.invoiceByEmail).toBe(true);
    expect(dwelling.invoiceByPaper).toBe(false);

    await expect(
      updateInvoiceDeliveryPreferences(
        db,
        org.id,
        dwelling.id,
        { invoiceByEmail: false, invoiceByPaper: false },
        seedAdminId
      )
    ).rejects.toBeInstanceOf(ValidationError);

    const paperOnly = await updateInvoiceDeliveryPreferences(
      db,
      org.id,
      dwelling.id,
      { invoiceByEmail: false, invoiceByPaper: true },
      seedAdminId
    );
    expect(paperOnly.invoiceByEmail).toBe(false);
    expect(paperOnly.invoiceByPaper).toBe(true);

    await expect(
      createDwelling(
        db,
        org.id,
        { number: "2", invoiceByEmail: false, invoiceByPaper: false },
        seedAdminId
      )
    ).rejects.toBeInstanceOf(ValidationError);

    await cleanupOrg(org.id);
  });

  it("DWL-002: archive hides from the active default list but keeps the row", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Dwl Org C", addressLine1: "Addr" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "A-1" },
      seedAdminId
    );
    await archiveDwelling(db, org.id, dwelling.id, seedAdminId);

    const active = await listDwellings(db, org.id);
    expect(active.some((d) => d.id === dwelling.id)).toBe(false);

    const all = await listDwellings(db, org.id, { includeArchived: true });
    expect(all.some((d) => d.id === dwelling.id)).toBe(true);

    await cleanupOrg(org.id);
  });

  it("DWL-003: assigning and removing resident access", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Dwl Org D", addressLine1: "Addr" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "A-1" },
      seedAdminId
    );

    const resident = await assignResident(
      db,
      org.id,
      dwelling.id,
      `it-resident-${randomUUID()}@example.com`,
      seedAdminId,
      supabaseAdmin
    );
    const residents = await listDwellingResidents(db, dwelling.id);
    expect(residents.some((r) => r.userId === resident.userId)).toBe(true);

    await db.$client.query("delete from dwelling_access where user_id = $1", [
      resident.userId,
    ]);
    await db.$client.query("delete from app_users where id = $1", [
      resident.userId,
    ]);
    await cleanupOrg(org.id);
  }, 20_000);
});

describe("DWL-004: CSV import", () => {
  it("classifies rows deterministically and rejects in-file duplicates", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Csv Org", addressLine1: "Addr" },
      seedAdminId
    );
    await createDwelling(db, org.id, { number: "EXIST-1" }, seedAdminId);

    const csv = [
      "number,type,display_name,occupant_name,billing_name,billing_email,billing_address,area_m2,resident_count,cold_water_meter_serial,hot_water_meter_serial",
      "NEW-1,APARTMENT,,,,,,40,1,,",
      "EXIST-1,APARTMENT,,,,,,40,1,,", // create mode: hitting an existing number is an error
      "NEW-1,APARTMENT,,,,,,40,1,,", // duplicate within the file
    ].join("\n");

    const { rows } = await validateDwellingsCsv(db, org.id, csv, "create");
    expect(rows[0].status).toBe("CREATE");
    expect(rows[1].status).toBe("ERROR");
    expect(rows[2].status).toBe("ERROR");

    const result = await importDwellingsCsv(
      db,
      org.id,
      csv,
      "create",
      seedAdminId
    );
    expect(result.created).toBe(1);
    expect(result.errored).toBe(2);

    await cleanupOrg(org.id);
  });

  it("update mode matches existing dwellings by number", async () => {
    const org = await createOrganization(
      db,
      { name: "IT Csv Org 2", addressLine1: "Addr" },
      seedAdminId
    );
    await createDwelling(
      db,
      org.id,
      { number: "U-1", occupantName: "Old Name" },
      seedAdminId
    );

    const csv = [
      "number,type,display_name,occupant_name,billing_name,billing_email,billing_address,area_m2,resident_count,cold_water_meter_serial,hot_water_meter_serial",
      "U-1,APARTMENT,,New Name,,,,50,2,,",
    ].join("\n");

    const result = await importDwellingsCsv(
      db,
      org.id,
      csv,
      "update",
      seedAdminId
    );
    expect(result.updated).toBe(1);
    const [dwelling] = await listDwellings(db, org.id);
    expect(dwelling.occupantName).toBe("New Name");

    await cleanupOrg(org.id);
  });
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}
