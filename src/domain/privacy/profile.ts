// A person changes their own display name (ADR 0009). The email address stays
// fixed: sign-in, the suppressed list, and invoice link revocation all look a
// person up by email, so an admin re-invites a person who needs a new address.
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { appUsers } from "../../db/schema/auth";
import { recordAuditEvent } from "../../lib/logging/audit";
import { NotFoundError, ValidationError } from "../errors";

export const DISPLAY_NAME_MESSAGE = "Enter a name of 1 to 100 characters.";

export async function getOwnDisplayName(
  db: Db,
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ displayName: appUsers.displayName })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return row?.displayName ?? null;
}

export async function updateOwnDisplayName(
  db: Db,
  userId: string,
  displayName: string
) {
  const name = displayName.trim();
  if (name.length < 1 || name.length > 100) {
    throw new ValidationError(DISPLAY_NAME_MESSAGE);
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ displayName: appUsers.displayName })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .for("update")
      .limit(1);
    if (!before) throw new NotFoundError("Person not found");
    if (before.displayName === name) return name;
    await tx
      .update(appUsers)
      .set({ displayName: name, updatedAt: new Date() })
      .where(eq(appUsers.id, userId));
    // No organization: the change belongs to the person, not to one
    // organization, so it stays out of every organization's audit page.
    await recordAuditEvent(tx, {
      actorUserId: userId,
      action: "PROFILE_UPDATED",
      entityType: "app_user",
      entityId: userId,
      beforeData: { displayName: before.displayName },
      afterData: { displayName: name },
    });
    return name;
  });
}
