import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { lateFeePolicies } from "../../db/schema/accounts";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError } from "../errors";

export async function getLatestLateFeePolicy(db: Db, organizationId: string) {
  const [policy] = await db
    .select()
    .from(lateFeePolicies)
    .where(eq(lateFeePolicies.organizationId, organizationId))
    .orderBy(desc(lateFeePolicies.effectiveFrom))
    .limit(1);
  return policy ?? null;
}

export async function createLateFeePolicy(
  db: Db,
  input: {
    organizationId: string;
    effectiveFrom: string;
    enabled: boolean;
    dailyRate: string;
    graceDays: number;
    maxPenaltyPercent: string;
    stopsAtCap: boolean;
    actorUserId: string;
  }
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: lateFeePolicies.id })
      .from(lateFeePolicies)
      .where(
        and(
          eq(lateFeePolicies.organizationId, input.organizationId),
          eq(lateFeePolicies.effectiveFrom, input.effectiveFrom)
        )
      )
      .limit(1);
    if (existing) {
      throw new ConflictError(
        "A late-fee policy already exists for this effective date"
      );
    }
    const [policy] = await tx.insert(lateFeePolicies).values(input).returning();
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "LATE_FEE_POLICY_CREATED",
      entityType: "late_fee_policy",
      entityId: policy.id,
      afterData: policy,
    });
    return policy;
  });
}
