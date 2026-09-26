// Phase D (Organizations/dwellings) - Organization CRUD and admin membership
// (spec Section 10, ORG-001/002). Callers must call
// requireOrganizationAccess() before any function here except
// createOrganization -- these take an already-authorized organizationId,
// per spec Section 14's repository contract.
import { and, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { appUsers } from "../../db/schema/auth";
import {
  organizationMemberships,
  organizations,
} from "../../db/schema/organizations";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { recordAuditEvent } from "../../lib/logging/audit";
import {
  findOrCreateSupabaseUser,
  type createSupabaseAdminClient,
} from "../../lib/supabase/admin";

export { ConflictError, NotFoundError, ValidationError };

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export interface CreateOrganizationInput {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
  email?: string;
  phone?: string;
  registrationNumber?: string;
  vatNumber?: string;
  bankName?: string;
  iban?: string;
  bic?: string;
}

// ORG-001: creator receives membership; EUR/Europe/Riga/lv defaults (already
// the schema's column defaults, spec Section 13.2) apply automatically.
export async function createOrganization(
  db: Db,
  input: CreateOrganizationInput,
  creatorUserId: string
) {
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values(input).returning();
    await tx
      .insert(organizationMemberships)
      .values({ organizationId: org.id, userId: creatorUserId });
    await recordAuditEvent(tx, {
      organizationId: org.id,
      actorUserId: creatorUserId,
      action: "ORGANIZATION_CREATED",
      entityType: "organization",
      entityId: org.id,
      afterData: org,
    });
    return org;
  });
}

export async function getOrganization(db: DbOrTx, organizationId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new NotFoundError("Organization not found");
  return org;
}

export async function listOrganizations(db: Db, organizationIds: string[]) {
  if (organizationIds.length === 0) return [];
  return db
    .select()
    .from(organizations)
    .where(inArray(organizations.id, organizationIds));
}

export interface UpdateOrganizationInput {
  name?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string;
  email?: string | null;
  phone?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  bankName?: string | null;
  iban?: string | null;
  bic?: string | null;
  currency?: string;
  timezone?: string;
  locale?: string;
  invoicePrefix?: string;
  defaultDueDays?: number;
  autoGenerateEnabled?: boolean;
  autoSendEnabled?: boolean;
  autoSendDay?: number | null;
}

// ORG-002: this only ever updates the live organization row. Sent invoices
// snapshot issuer/org data at generation time (spec Section 21) and are
// never re-read from this table, so they're structurally unaffected.
// Confirmed valid IANA zone the same way it will actually be used (spec
// Section 32's per-organization Intl.DateTimeFormat call in the scheduler)
// rather than trusting free text -- an invalid zone saved here would
// otherwise silently fail every scheduled job for this organization
// forever, with no admin-visible error at all.
function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function updateOrganization(
  db: Db,
  organizationId: string,
  input: UpdateOrganizationInput,
  actorUserId: string
) {
  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    throw new ValidationError(`"${input.timezone}" is not a valid timezone`);
  }

  return db.transaction(async (tx) => {
    const before = await getOrganization(tx, organizationId);

    const autoSendEnabled = input.autoSendEnabled ?? before.autoSendEnabled;
    const autoSendDay =
      input.autoSendDay !== undefined ? input.autoSendDay : before.autoSendDay;
    if (autoSendEnabled && autoSendDay === null) {
      throw new ValidationError(
        "Auto-send day is required when auto-send is enabled"
      );
    }

    const [after] = await tx
      .update(organizations)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId))
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "ORGANIZATION_UPDATED",
      entityType: "organization",
      entityId: organizationId,
      beforeData: before,
      afterData: after,
    });
    return after;
  });
}

export async function listAdminMembers(db: Db, organizationId: string) {
  return db
    .select({
      userId: appUsers.id,
      email: appUsers.emailSnapshot,
      displayName: appUsers.displayName,
      disabledAt: appUsers.disabledAt,
      memberSince: organizationMemberships.createdAt,
    })
    .from(organizationMemberships)
    .innerJoin(appUsers, eq(appUsers.id, organizationMemberships.userId))
    .where(eq(organizationMemberships.organizationId, organizationId));
}

// Provisions a Supabase identity + app_users(ADMIN) row for `email` if one
// doesn't already exist, then grants organization membership. Rejects if
// the email belongs to an existing RESIDENT: v1 has no role-transition path
// (spec Section 2.2 excludes a third/blended role, and promoting a resident
// to admin isn't described anywhere in the spec).
export async function addAdminMembership(
  db: Db,
  organizationId: string,
  email: string,
  actorUserId: string,
  supabaseAdmin: SupabaseAdmin
) {
  const supabaseUser = await findOrCreateSupabaseUser(supabaseAdmin, email);

  return db.transaction(async (tx) => {
    // insert-then-reselect (not select-then-insert): two concurrent calls
    // for the same brand-new email would otherwise both see "no existing
    // row" and both attempt the insert, raising a raw unique-violation
    // instead of the intended idempotent "add admin" outcome. Postgres
    // makes the second INSERT ... ON CONFLICT wait for the first to
    // commit, so the reselect below always sees the row that won.
    await tx
      .insert(appUsers)
      .values({ id: supabaseUser.id, role: "ADMIN", emailSnapshot: email })
      .onConflictDoNothing();
    const [appUser] = await tx
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, supabaseUser.id))
      .limit(1);

    if (appUser!.role !== "ADMIN") {
      throw new ConflictError(
        `${email} is already a resident and cannot also be an admin`
      );
    }

    const [membership] = await tx
      .insert(organizationMemberships)
      .values({ organizationId, userId: supabaseUser.id })
      .onConflictDoNothing()
      .returning();

    if (membership) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "ADMIN_MEMBERSHIP_ADDED",
        entityType: "organization_membership",
        entityId: supabaseUser.id,
        afterData: { email },
      });
    }

    return { userId: supabaseUser.id, email };
  });
}

// Refuses to remove the organization's last admin membership: that would
// permanently lock every admin out (no recovery path exists in v1).
export async function removeAdminMembership(
  db: Db,
  organizationId: string,
  userId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    // Locks every membership row of this org for the duration of the
    // transaction so two concurrent removals can't both read "2 admins
    // remaining" and each remove one, leaving zero (spec: no recovery path).
    const remaining = await tx
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organizationId))
      .for("update");

    if (remaining.length <= 1) {
      throw new ConflictError(
        "Cannot remove the last admin of an organization"
      );
    }

    await tx
      .delete(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId)
        )
      );

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "ADMIN_MEMBERSHIP_REMOVED",
      entityType: "organization_membership",
      entityId: userId,
    });
  });
}
