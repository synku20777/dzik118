// Phase D (Organizations/dwellings) - Audit trail writer (spec Section 31).
// "Audit writes that belong to a financial transaction should be committed
// in the same DB transaction when possible" -- callers pass a transaction
// handle (or the plain db) as `tx`, so this never opens its own connection.
import type { DbOrTx } from "../../db/client";
import { auditLogs } from "../../db/schema/audit";
import { getRequestContext } from "./request-context";

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
  // Set by the middleware for every web request. Scripts and tests that call
  // the domain directly have no context, so both columns stay null there.
  const context = getRequestContext();
  await tx.insert(auditLogs).values({
    requestId: context?.requestId ?? null,
    ipHash: context?.ipHash ?? null,
    organizationId: event.organizationId ?? null,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    beforeData: event.beforeData ?? null,
    afterData: event.afterData ?? null,
  });
}
