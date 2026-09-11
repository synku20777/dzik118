// Phase L (Automation/audit) - admin audit history read model (spec
// Section 9.2 "/admin/o/[orgId]/audit", Section 31). Read-only: writes go
// through src/lib/logging/audit.ts's recordAuditEvent from every other
// domain module.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { auditLogs } from "../../db/schema/audit";
import { appUsers } from "../../db/schema/auth";

export interface ListAuditLogsOptions {
  action?: string;
  entityType?: string;
  limit?: number;
  offset?: number;
}

export async function listAuditLogs(
  db: Db,
  organizationId: string,
  options: ListAuditLogsOptions = {}
) {
  const { action, entityType, limit = 50, offset = 0 } = options;
  const conditions = [eq(auditLogs.organizationId, organizationId)];
  if (action) conditions.push(eq(auditLogs.action, action));
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));

  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      beforeData: auditLogs.beforeData,
      afterData: auditLogs.afterData,
      createdAt: auditLogs.createdAt,
      actorEmail: appUsers.emailSnapshot,
      actorDisplayName: appUsers.displayName,
    })
    .from(auditLogs)
    .leftJoin(appUsers, eq(appUsers.id, auditLogs.actorUserId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

// Powers the action-type filter dropdown -- every distinct action this
// organization's audit log actually has, not spec Section 31's full
// hardcoded list (a young organization won't have triggered most of them).
export async function listDistinctAuditActions(
  db: Db,
  organizationId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(auditLogs.action);
  return rows.map((r) => r.action);
}
