// Phase C (Auth/security) - Authorization invariant (spec Section 8):
// Supabase identity -> app_users record -> membership/access lookup. Never
// authorize by matching email strings alone (spec Section 8).
//
// A person can hold admin capability (organization_memberships rows),
// resident capability (dwelling_access rows), both, or neither -- the two
// are independent, not mutually exclusive (see docs/decisions/0006 or the
// commit introducing this). app_users.role only ever records which
// capability was granted first; it is never read for authorization.
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { appUsers } from "../../db/schema/auth";
import { dwellingAccess, dwellings } from "../../db/schema/dwellings";
import {
  organizationMemberships,
  organizations,
} from "../../db/schema/organizations";

export interface AuthContext {
  userId: string;
  email: string;
  organizationIds: string[]; // admin capability; empty if none
  // Resident capability; empty if none. A dwelling of an archived
  // organization is NOT listed: its residents are locked out (ADR 0009).
  dwellingIds: string[];
  // The organizations in `organizationIds` that are archived. An admin keeps
  // read access there, and every write is refused (requireActiveOrganization).
  // Optional so a hand-built context in a test means "nothing archived".
  archivedOrganizationIds?: string[];
  // How many dwellings the person lost because their organization is
  // archived. Only used to show the "organization is closed" page instead of
  // a plain "no access".
  closedDwellingCount?: number;
}

// Returns null for: no app_users row (resident not yet provisioned, spec
// Section 15.1), or a disabled account (spec Section 15.3).
export async function loadAuthContext(
  db: Db,
  supabaseUserId: string,
  currentEmail: string
): Promise<AuthContext | null> {
  const [appUser] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.id, supabaseUserId))
    .limit(1);

  if (!appUser || appUser.disabledAt) {
    return null;
  }

  // Keep the snapshot in sync when the Supabase auth email changes (spec
  // Section 12). email_snapshot is never used as an authorization key.
  // Stored in lowercase: sign-in and password reset look the address up in
  // lowercase, so a mixed-case value from Supabase must not undo that.
  const normalizedEmail = currentEmail.trim().toLowerCase();
  if (normalizedEmail && appUser.emailSnapshot !== normalizedEmail) {
    await db
      .update(appUsers)
      .set({ emailSnapshot: normalizedEmail, updatedAt: new Date() })
      .where(eq(appUsers.id, supabaseUserId));
  }

  const [memberships, access] = await Promise.all([
    db
      .select({
        organizationId: organizationMemberships.organizationId,
        archivedAt: organizations.archivedAt,
      })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMemberships.organizationId)
      )
      .where(eq(organizationMemberships.userId, supabaseUserId)),
    db
      .select({
        dwellingId: dwellingAccess.dwellingId,
        archivedAt: organizations.archivedAt,
      })
      .from(dwellingAccess)
      .innerJoin(dwellings, eq(dwellings.id, dwellingAccess.dwellingId))
      .innerJoin(organizations, eq(organizations.id, dwellings.organizationId))
      .where(eq(dwellingAccess.userId, supabaseUserId)),
  ]);

  return {
    userId: supabaseUserId,
    email: currentEmail || appUser.emailSnapshot,
    organizationIds: memberships.map((m) => m.organizationId),
    archivedOrganizationIds: memberships
      .filter((m) => m.archivedAt)
      .map((m) => m.organizationId),
    dwellingIds: access.filter((a) => !a.archivedAt).map((a) => a.dwellingId),
    closedDwellingCount: access.filter((a) => a.archivedAt).length,
  };
}

// Cheaper than loadAuthContext for the auth endpoints that only need to
// know "does this user id have admin capability" -- password-only sign-in
// (request-link.ts), admin password reset (request-reset.ts, confirm.ts,
// set-password.ts, reset-password.astro).
export async function hasAdminCapability(
  db: Db,
  userId: string
): Promise<boolean> {
  const [row] = await db
    .select({ organizationId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, userId))
    .limit(1);
  return !!row;
}
