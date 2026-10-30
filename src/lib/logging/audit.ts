// Phase D (Organizations/dwellings) - Audit trail writer (spec Section 31).
// "Audit writes that belong to a financial transaction should be committed
// in the same DB transaction when possible" -- callers pass a transaction
// handle (or the plain db) as `tx`, so this never opens its own connection.
import type { DbOrTx } from "../../db/client";
import { auditLogs } from "../../db/schema/audit";
import { getRequestContext } from "./request-context";

export interface AuditEventInput {
  organizationId?: string | null;
  scopeDwellingId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
}

function auditRow(event: AuditEventInput) {
  // Set by the middleware for every web request. Scripts and tests that call
  // the domain directly have no context, so both columns stay null there.
  const context = getRequestContext();
  const scopeDwellingId =
    event.scopeDwellingId !== undefined
      ? event.scopeDwellingId
      : event.entityType === "dwelling" && event.entityId
        ? event.entityId
        : null;

  return {
    requestId: context?.requestId ?? null,
    ipHash: context?.ipHash ?? null,
    organizationId: event.organizationId ?? null,
    scopeDwellingId: scopeDwellingId ?? null,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    beforeData: event.beforeData ?? null,
    afterData: event.afterData ?? null,
  };
}

export async function recordAuditEvent(tx: DbOrTx, event: AuditEventInput) {
  await tx.insert(auditLogs).values(auditRow(event));
}

// Many events in a few statements, for imports. Same rows as recordAuditEvent,
// in the caller's transaction.
export async function recordAuditEvents(tx: DbOrTx, events: AuditEventInput[]) {
  for (let i = 0; i < events.length; i += 500) {
    await tx.insert(auditLogs).values(events.slice(i, i + 500).map(auditRow));
  }
}
