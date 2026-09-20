import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { appUsers } from "../../db/schema/auth";
import { dwellingAccess, dwellings, meters } from "../../db/schema/dwellings";
import { mutationReceipts } from "../../db/schema/mutation-receipts";
import { ConflictError } from "../errors";

export type ReceiptEntityType = "dwelling" | "meter" | "resident-access";

export interface ReceiptIdentity {
  organizationId: string;
  clientMutationId: string;
  operation: string;
  entityType: ReceiptEntityType;
  scopeId?: string;
}

export async function claimMutationReceipt(tx: Tx, identity: ReceiptIdentity) {
  const [claimed] = await tx
    .insert(mutationReceipts)
    .values({ ...identity, scopeId: identity.scopeId ?? null })
    .onConflictDoNothing()
    .returning();
  if (claimed) return { replayed: false as const, receipt: claimed };

  const [existing] = await tx
    .select()
    .from(mutationReceipts)
    .where(
      and(
        eq(mutationReceipts.organizationId, identity.organizationId),
        eq(mutationReceipts.clientMutationId, identity.clientMutationId)
      )
    )
    .limit(1);
  if (
    !existing ||
    existing.operation !== identity.operation ||
    existing.entityType !== identity.entityType ||
    existing.scopeId !== (identity.scopeId ?? null)
  ) {
    throw new ConflictError("This request key was already used");
  }
  return { replayed: true as const, receipt: existing };
}

export async function completeMutationReceipt(
  tx: Tx,
  identity: ReceiptIdentity,
  entityId: string
) {
  await tx
    .update(mutationReceipts)
    .set({ entityId })
    .where(
      and(
        eq(mutationReceipts.organizationId, identity.organizationId),
        eq(mutationReceipts.clientMutationId, identity.clientMutationId)
      )
    );
}

export type MutationLookupResult =
  | { state: "missing" }
  | {
      state: "committed";
      operation: string;
      entityType: ReceiptEntityType;
      scopeId: string | null;
      entity: Record<string, unknown> | null;
    };

export async function lookupMutationReceipt(
  db: Db,
  organizationId: string,
  clientMutationId: string
): Promise<MutationLookupResult> {
  const [receipt] = await db
    .select()
    .from(mutationReceipts)
    .where(
      and(
        eq(mutationReceipts.organizationId, organizationId),
        eq(mutationReceipts.clientMutationId, clientMutationId)
      )
    )
    .limit(1);
  if (!receipt) return { state: "missing" };

  let entity: Record<string, unknown> | null = null;
  if (receipt.entityId && receipt.entityType === "dwelling") {
    [entity = null] = await db
      .select()
      .from(dwellings)
      .where(
        and(
          eq(dwellings.organizationId, organizationId),
          eq(dwellings.id, receipt.entityId)
        )
      )
      .limit(1);
  } else if (receipt.entityId && receipt.entityType === "meter") {
    [entity = null] = await db
      .select()
      .from(meters)
      .where(
        and(
          eq(meters.organizationId, organizationId),
          eq(meters.id, receipt.entityId)
        )
      )
      .limit(1);
  } else if (
    receipt.entityId &&
    receipt.scopeId &&
    receipt.entityType === "resident-access"
  ) {
    [entity = null] = await db
      .select({
        userId: appUsers.id,
        email: appUsers.emailSnapshot,
        displayName: appUsers.displayName,
      })
      .from(dwellingAccess)
      .innerJoin(appUsers, eq(appUsers.id, dwellingAccess.userId))
      .innerJoin(dwellings, eq(dwellings.id, dwellingAccess.dwellingId))
      .where(
        and(
          eq(dwellings.organizationId, organizationId),
          eq(dwellingAccess.dwellingId, receipt.scopeId),
          eq(dwellingAccess.userId, receipt.entityId)
        )
      )
      .limit(1);
  }

  return {
    state: "committed",
    operation: receipt.operation,
    entityType: receipt.entityType as ReceiptEntityType,
    scopeId: receipt.scopeId,
    entity,
  };
}
