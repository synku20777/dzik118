// Phase C (Auth/security) - isolation integration tests (spec Section 47
// task brief C, spec Section 35 SEC-001/SEC-002 at the authorization-
// primitive level -- full route-level isolation tests are Phase M).
// Requires a real Postgres reachable via DATABASE_URL.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../src/db/client";
import { appUsers } from "../../src/db/schema/auth";
import {
  organizations,
  organizationMemberships,
} from "../../src/db/schema/organizations";
import { dwellings, dwellingAccess } from "../../src/db/schema/dwellings";
import { loadAuthContext } from "../../src/domain/authorization/context";
import {
  ForbiddenError,
  requireDwellingAccess,
  requireOrganizationAccess,
} from "../../src/domain/authorization/guards";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for integration tests");
}

let db: Db;

const orgAId = randomUUID();
const orgBId = randomUUID();
const dwellingAId = randomUUID(); // resident A's dwelling, org A
const dwellingA2Id = randomUUID(); // resident B's dwelling, also org A
const dwellingBId = randomUUID(); // unrelated dwelling, org B
const adminId = randomUUID();
const residentId = randomUUID(); // "resident A"
const residentBId = randomUUID(); // "resident B" -- same org as resident A, different dwelling
const disabledAdminId = randomUUID();
const unprovisionedUserId = randomUUID();

beforeAll(async () => {
  db = await createDb(connectionString!);

  await db.insert(organizations).values([
    { id: orgAId, name: "Test Org A", addressLine1: "Addr A" },
    { id: orgBId, name: "Test Org B", addressLine1: "Addr B" },
  ]);
  await db.insert(dwellings).values([
    { id: dwellingAId, organizationId: orgAId, number: "IT-A1" },
    { id: dwellingA2Id, organizationId: orgAId, number: "IT-A2" },
    { id: dwellingBId, organizationId: orgBId, number: "IT-B1" },
  ]);
  await db.insert(appUsers).values([
    { id: adminId, role: "ADMIN", emailSnapshot: "it-admin@example.com" },
    {
      id: residentId,
      role: "RESIDENT",
      emailSnapshot: "it-resident@example.com",
    },
    {
      id: residentBId,
      role: "RESIDENT",
      emailSnapshot: "it-resident-b@example.com",
    },
    {
      id: disabledAdminId,
      role: "ADMIN",
      emailSnapshot: "it-disabled@example.com",
      disabledAt: new Date(),
    },
  ]);
  await db.insert(organizationMemberships).values([
    { organizationId: orgAId, userId: adminId },
    { organizationId: orgAId, userId: disabledAdminId },
  ]);
  await db.insert(dwellingAccess).values([
    { dwellingId: dwellingAId, userId: residentId },
    { dwellingId: dwellingA2Id, userId: residentBId },
  ]);
});

afterAll(async () => {
  await db.$client.query(
    "delete from organization_memberships where organization_id in ($1, $2)",
    [orgAId, orgBId]
  );
  await db.$client.query(
    "delete from dwelling_access where dwelling_id in ($1, $2, $3)",
    [dwellingAId, dwellingA2Id, dwellingBId]
  );
  await db.$client.query("delete from dwellings where id in ($1, $2, $3)", [
    dwellingAId,
    dwellingA2Id,
    dwellingBId,
  ]);
  await db.$client.query("delete from app_users where id in ($1, $2, $3, $4)", [
    adminId,
    residentId,
    residentBId,
    disabledAdminId,
  ]);
  await db.$client.query("delete from organizations where id in ($1, $2)", [
    orgAId,
    orgBId,
  ]);
  await db.$client.end();
});

describe("loadAuthContext", () => {
  it("returns an admin context scoped to their own organization memberships only", async () => {
    const auth = await loadAuthContext(db, adminId, "it-admin@example.com");
    expect(auth).toEqual({
      role: "ADMIN",
      userId: adminId,
      email: "it-admin@example.com",
      organizationIds: [orgAId],
    });
  });

  it("returns a resident context scoped to their own dwelling access only", async () => {
    const auth = await loadAuthContext(
      db,
      residentId,
      "it-resident@example.com"
    );
    expect(auth).toEqual({
      role: "RESIDENT",
      userId: residentId,
      email: "it-resident@example.com",
      dwellingIds: [dwellingAId],
    });
  });

  it("returns null for a disabled account (spec Section 15.3)", async () => {
    const auth = await loadAuthContext(
      db,
      disabledAdminId,
      "it-disabled@example.com"
    );
    expect(auth).toBeNull();
  });

  it("returns null when no app_users row exists (resident not yet provisioned)", async () => {
    const auth = await loadAuthContext(
      db,
      unprovisionedUserId,
      "unknown@example.com"
    );
    expect(auth).toBeNull();
  });
});

describe("requireOrganizationAccess (SEC-001 primitive)", () => {
  it("allows an admin to access their own organization", async () => {
    const auth = await loadAuthContext(db, adminId, "it-admin@example.com");
    expect(() => requireOrganizationAccess(auth, orgAId)).not.toThrow();
  });

  it("denies an admin access to a foreign organization by known UUID", async () => {
    const auth = await loadAuthContext(db, adminId, "it-admin@example.com");
    expect(() => requireOrganizationAccess(auth, orgBId)).toThrow(
      ForbiddenError
    );
  });

  it("denies a resident (wrong role) any organization access", async () => {
    const auth = await loadAuthContext(
      db,
      residentId,
      "it-resident@example.com"
    );
    expect(() => requireOrganizationAccess(auth, orgAId)).toThrow(
      ForbiddenError
    );
  });

  it("denies an unauthenticated caller", () => {
    expect(() => requireOrganizationAccess(null, orgAId)).toThrow(
      ForbiddenError
    );
  });
});

describe("requireDwellingAccess (SEC-002 primitive)", () => {
  it("allows a resident to access their own dwelling", async () => {
    const auth = await loadAuthContext(
      db,
      residentId,
      "it-resident@example.com"
    );
    expect(() => requireDwellingAccess(auth, dwellingAId)).not.toThrow();
  });

  it("denies a resident access to a foreign dwelling by known UUID (cross-tenant)", async () => {
    const auth = await loadAuthContext(
      db,
      residentId,
      "it-resident@example.com"
    );
    expect(() => requireDwellingAccess(auth, dwellingBId)).toThrow(
      ForbiddenError
    );
  });

  it("denies resident A access to resident B's dwelling, same organization (cross-resident, spec SEC-002)", async () => {
    const authA = await loadAuthContext(
      db,
      residentId,
      "it-resident@example.com"
    );
    expect(() => requireDwellingAccess(authA, dwellingA2Id)).toThrow(
      ForbiddenError
    );

    const authB = await loadAuthContext(
      db,
      residentBId,
      "it-resident-b@example.com"
    );
    expect(() => requireDwellingAccess(authB, dwellingAId)).toThrow(
      ForbiddenError
    );
    // Sanity check: resident B can still access their own dwelling.
    expect(() => requireDwellingAccess(authB, dwellingA2Id)).not.toThrow();
  });

  it("denies an admin (wrong role) dwelling access", async () => {
    const auth = await loadAuthContext(db, adminId, "it-admin@example.com");
    expect(() => requireDwellingAccess(auth, dwellingAId)).toThrow(
      ForbiddenError
    );
  });

  it("denies an unauthenticated caller", () => {
    expect(() => requireDwellingAccess(null, dwellingAId)).toThrow(
      ForbiddenError
    );
  });
});
