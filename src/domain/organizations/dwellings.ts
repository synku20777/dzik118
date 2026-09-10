// Phase D (Organizations/dwellings) - Dwelling CRUD and resident access
// (spec Section 10, DWL-001/002/003). Callers must call
// requireOrganizationAccess() before calling any of these -- they take an
// already-authorized organizationId, per spec Section 14.
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { appUsers } from "../../db/schema/auth";
import { dwellingAccess, dwellings } from "../../db/schema/dwellings";
import { recordAuditEvent } from "../../lib/logging/audit";
import {
  findOrCreateSupabaseUser,
  type createSupabaseAdminClient,
} from "../../lib/supabase/admin";
import { isUniqueViolation } from "../../lib/db-errors";
import { ConflictError, NotFoundError } from "./organizations";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export { ConflictError, NotFoundError };

export interface CreateDwellingInput {
  type?: "APARTMENT" | "COMMERCIAL_UNIT" | "PARKING" | "STORAGE" | "OTHER";
  number: string;
  displayName?: string;
  occupantName?: string;
  billingName?: string;
  billingEmail?: string;
  billingAddress?: string;
  areaM2?: string;
  residentCount?: number;
  notes?: string;
}

// DWL-001: unique within org (enforced by the DB unique constraint, spec
// Section 13.4); another organization may freely reuse the same number.
export async function createDwelling(
  db: Db,
  organizationId: string,
  input: CreateDwellingInput,
  actorUserId: string
) {
  try {
    return await db.transaction(async (tx) => {
      const [dwelling] = await tx
        .insert(dwellings)
        .values({ organizationId, ...input })
        .returning();
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "DWELLING_CREATED",
        entityType: "dwelling",
        entityId: dwelling.id,
        afterData: dwelling,
      });
      return dwelling;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        `Dwelling number "${input.number}" already exists in this organization`
      );
    }
    throw err;
  }
}

export async function getDwelling(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string
) {
  const [dwelling] = await db
    .select()
    .from(dwellings)
    .where(
      and(
        eq(dwellings.id, dwellingId),
        eq(dwellings.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!dwelling) throw new NotFoundError("Dwelling not found");
  return dwelling;
}

// Resident-facing reads take no organizationId: the caller already proved
// access via requireDwellingAccess(auth, dwellingId) against the resident's
// own dwellingIds (spec Section 8), so there's no separate org to check
// against here (unlike the admin path, which always has an asserted org).
export async function getDwellingForResident(db: DbOrTx, dwellingId: string) {
  const [dwelling] = await db
    .select()
    .from(dwellings)
    .where(eq(dwellings.id, dwellingId))
    .limit(1);
  if (!dwelling) throw new NotFoundError("Dwelling not found");
  return dwelling;
}

export interface ListDwellingsOptions {
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

// List defaults to hiding archived dwellings (spec DWL-002: "hidden from
// active default"); old financial history stays reachable via
// includeArchived, never via a separate un-archived copy of the row.
export async function listDwellings(
  db: Db,
  organizationId: string,
  options: ListDwellingsOptions = {}
) {
  const { search, includeArchived = false, limit = 50, offset = 0 } = options;

  const conditions = [eq(dwellings.organizationId, organizationId)];
  if (!includeArchived) {
    conditions.push(isNull(dwellings.archivedAt));
  }
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(dwellings.number, pattern),
        ilike(dwellings.displayName, pattern),
        ilike(dwellings.occupantName, pattern)
      )!
    );
  }

  return db
    .select()
    .from(dwellings)
    .where(and(...conditions))
    .orderBy(asc(dwellings.number))
    .limit(limit)
    .offset(offset);
}

export interface UpdateDwellingInput {
  type?: "APARTMENT" | "COMMERCIAL_UNIT" | "PARKING" | "STORAGE" | "OTHER";
  displayName?: string | null;
  occupantName?: string | null;
  billingName?: string | null;
  billingEmail?: string | null;
  billingAddress?: string | null;
  areaM2?: string;
  residentCount?: number;
  notes?: string | null;
}

// Deliberately does not accept `number`: renumbering a dwelling with
// financial history would sever the trail an admin uses to find past
// invoices for it. Not asked for by any acceptance criterion.
export async function updateDwelling(
  db: Db,
  organizationId: string,
  dwellingId: string,
  input: UpdateDwellingInput,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const before = await getDwelling(tx, organizationId, dwellingId);
    const [after] = await tx
      .update(dwellings)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(dwellings.id, dwellingId),
          eq(dwellings.organizationId, organizationId)
        )
      )
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "DWELLING_UPDATED",
      entityType: "dwelling",
      entityId: dwellingId,
      beforeData: before,
      afterData: after,
    });
    return after;
  });
}

// DWL-002: soft-delete only. A dwelling with financial history is never
// hard-deleted (spec Section 27); archiving excludes it from new periods
// (enforced by Phase E's period-creation dwelling selection) while every
// past invoice/reading referencing it remains intact.
export async function archiveDwelling(
  db: Db,
  organizationId: string,
  dwellingId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [dwelling] = await tx
      .update(dwellings)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(dwellings.id, dwellingId),
          eq(dwellings.organizationId, organizationId)
        )
      )
      .returning();
    if (!dwelling) throw new NotFoundError("Dwelling not found");
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "DWELLING_ARCHIVED",
      entityType: "dwelling",
      entityId: dwellingId,
    });
    return dwelling;
  });
}

export async function listDwellingResidents(db: Db, dwellingId: string) {
  return db
    .select({
      userId: appUsers.id,
      email: appUsers.emailSnapshot,
      displayName: appUsers.displayName,
      disabledAt: appUsers.disabledAt,
      accessSince: dwellingAccess.createdAt,
    })
    .from(dwellingAccess)
    .innerJoin(appUsers, eq(appUsers.id, dwellingAccess.userId))
    .where(eq(dwellingAccess.dwellingId, dwellingId));
}

// DWL-003: provisions a Supabase identity + app_users(RESIDENT) row for
// `email` if one doesn't exist, then grants dwelling access. Rejects if the
// email belongs to an existing ADMIN (no role-transition path in v1, same
// reasoning as addAdminMembership).
export async function assignResident(
  db: Db,
  organizationId: string,
  dwellingId: string,
  email: string,
  actorUserId: string,
  supabaseAdmin: SupabaseAdmin
) {
  await getDwelling(db, organizationId, dwellingId);

  const supabaseUser = await findOrCreateSupabaseUser(supabaseAdmin, email);

  return db.transaction(async (tx) => {
    // insert-then-reselect: see the identical comment in addAdminMembership
    // (src/domain/organizations/organizations.ts) -- avoids a raw
    // unique-violation when two requests provision the same new email
    // concurrently.
    await tx
      .insert(appUsers)
      .values({ id: supabaseUser.id, role: "RESIDENT", emailSnapshot: email })
      .onConflictDoNothing();
    const [appUser] = await tx
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, supabaseUser.id))
      .limit(1);

    if (appUser!.role !== "RESIDENT") {
      throw new ConflictError(
        `${email} is already an admin and cannot also be a resident`
      );
    }

    const [access] = await tx
      .insert(dwellingAccess)
      .values({ dwellingId, userId: supabaseUser.id })
      .onConflictDoNothing()
      .returning();

    if (access) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "DWELLING_ACCESS_ADDED",
        entityType: "dwelling",
        entityId: dwellingId,
        afterData: { email },
      });
    }

    return { userId: supabaseUser.id, email };
  });
}

// DWL-003: "removed access immediately blocks authenticated access" holds
// for free -- loadAuthContext (Phase C) re-queries dwelling_access on every
// request, so there is no session cache to invalidate.
export async function removeResidentAccess(
  db: Db,
  organizationId: string,
  dwellingId: string,
  userId: string,
  actorUserId: string
) {
  await getDwelling(db, organizationId, dwellingId);
  await db.transaction(async (tx) => {
    await tx
      .delete(dwellingAccess)
      .where(
        and(
          eq(dwellingAccess.dwellingId, dwellingId),
          eq(dwellingAccess.userId, userId)
        )
      );
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "DWELLING_ACCESS_REMOVED",
      entityType: "dwelling",
      entityId: dwellingId,
      beforeData: { userId },
    });
  });
}
