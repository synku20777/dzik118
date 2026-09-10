// Phase C (Auth/security) - Authorization invariant (spec Section 8):
// Supabase identity -> app_users record -> role -> membership/access lookup.
// Never authorize by matching email strings alone (spec Section 8).
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { appUsers } from "../../db/schema/auth";
import { dwellingAccess } from "../../db/schema/dwellings";
import { organizationMemberships } from "../../db/schema/organizations";

export interface AdminAuthContext {
  role: "ADMIN";
  userId: string;
  email: string;
  organizationIds: string[];
}

export interface ResidentAuthContext {
  role: "RESIDENT";
  userId: string;
  email: string;
  dwellingIds: string[];
}

export type AuthContext = AdminAuthContext | ResidentAuthContext;

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
  if (currentEmail && appUser.emailSnapshot !== currentEmail) {
    await db
      .update(appUsers)
      .set({ emailSnapshot: currentEmail, updatedAt: new Date() })
      .where(eq(appUsers.id, supabaseUserId));
  }

  if (appUser.role === "ADMIN") {
    const memberships = await db
      .select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, supabaseUserId));
    return {
      role: "ADMIN",
      userId: supabaseUserId,
      email: currentEmail || appUser.emailSnapshot,
      organizationIds: memberships.map((m) => m.organizationId),
    };
  }

  const access = await db
    .select({ dwellingId: dwellingAccess.dwellingId })
    .from(dwellingAccess)
    .where(eq(dwellingAccess.userId, supabaseUserId));
  return {
    role: "RESIDENT",
    userId: supabaseUserId,
    email: currentEmail || appUser.emailSnapshot,
    dwellingIds: access.map((a) => a.dwellingId),
  };
}
