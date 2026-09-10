// Phase D (Organizations/dwellings) - Audit trail writer (spec Section 31).
// "Audit writes that belong to a financial transaction should be committed
// in the same DB transaction when possible" -- callers pass a transaction
// handle (or the plain db) as `tx`, so this never opens its own connection.
import type { DbOrTx } from "../../db/client";
import { auditLogs } from "../../db/schema/audit";

export interface AuditEventInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
}

export async function recordAuditEvent(tx: DbOrTx, event: AuditEventInput) {
  await tx.insert(auditLogs).values({
    organizationId: event.organizationId ?? null,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    beforeData: event.beforeData ?? null,
    afterData: event.afterData ?? null,
  });
}
