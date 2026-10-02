// Phase L (Automation/audit) - admin audit history read model (spec
// Section 9.2 "/admin/o/[orgId]/audit", Section 31). Read-only: writes go
// through src/lib/logging/audit.ts's recordAuditEvent from every other
// domain module.
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { auditLogs } from "../../db/schema/audit";
import { appUsers } from "../../db/schema/auth";

export interface ListAuditLogsOptions {
  action?: string;
  entityType?: string;
  entityId?: string;
  scopeDwellingId?: string;
  actorUserId?: string;
  fromDate?: string;
  toDate?: string;
  timezone?: string;
  limit?: number;
  offset?: number;
}

export async function listAuditLogs(
  db: Db,
  organizationId: string,
  options: ListAuditLogsOptions = {}
) {
  const {
    action,
    entityType,
    entityId,
    scopeDwellingId,
    actorUserId,
    fromDate,
    toDate,
    timezone,
    limit = 50,
    offset = 0,
  } = options;
  const conditions = [eq(auditLogs.organizationId, organizationId)];
  if (action) conditions.push(eq(auditLogs.action, action));
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (entityId) conditions.push(eq(auditLogs.entityId, entityId));
  if (scopeDwellingId)
    conditions.push(eq(auditLogs.scopeDwellingId, scopeDwellingId));
  if (actorUserId) conditions.push(eq(auditLogs.actorUserId, actorUserId));

  const tz = timezone ?? "UTC";
  if (fromDate) {
    conditions.push(
      sql`(${auditLogs.createdAt} at time zone ${tz})::date >= ${fromDate}::date`
    );
  }
  if (toDate) {
    conditions.push(
      sql`(${auditLogs.createdAt} at time zone ${tz})::date <= ${toDate}::date`
    );
  }

  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      scopeDwellingId: auditLogs.scopeDwellingId,
      beforeData: auditLogs.beforeData,
      afterData: auditLogs.afterData,
      createdAt: auditLogs.createdAt,
      requestId: auditLogs.requestId,
      ipHash: auditLogs.ipHash,
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

export async function listDistinctAuditEntityTypes(
  db: Db,
  organizationId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ entityType: auditLogs.entityType })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(auditLogs.entityType);
  return rows.map((r) => r.entityType);
}

export async function listDistinctAuditActors(
  db: Db,
  organizationId: string
): Promise<{ id: string; label: string }[]> {
  const rows = await db
    .selectDistinct({
      id: appUsers.id,
      displayName: appUsers.displayName,
      emailSnapshot: appUsers.emailSnapshot,
    })
    .from(auditLogs)
    .innerJoin(appUsers, eq(appUsers.id, auditLogs.actorUserId))
    .where(eq(auditLogs.organizationId, organizationId));

  return rows
    .map((r) => ({
      id: r.id,
      label: r.displayName ?? r.emailSnapshot,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const CSV_HEADERS = [
  "created_at",
  "actor",
  "action",
  "entity_type",
  "entity_id",
  "before",
  "after",
  "request_id",
  "ip_hash",
];

function csvCell(value: string | null | undefined): string {
  const str = value ?? "";
  const neutralized = /^[\s=+\-@]/.test(str) ? `'${str}` : str;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export async function exportAuditLogsCsv(
  db: Db,
  organizationId: string,
  options: Omit<ListAuditLogsOptions, "limit" | "offset"> = {}
): Promise<string> {
  // ponytail: 5000-row cap; streamed export is the upgrade path.
  const logs = await listAuditLogs(db, organizationId, {
    ...options,
    limit: 5000,
    offset: 0,
  });

  const rows = [
    CSV_HEADERS.map(csvCell).join(","),
    ...logs.map((log) =>
      [
        csvCell(
          log.createdAt instanceof Date
            ? log.createdAt.toISOString()
            : new Date(log.createdAt).toISOString()
        ),
        csvCell(log.actorDisplayName ?? log.actorEmail ?? ""),
        csvCell(log.action),
        csvCell(log.entityType),
        csvCell(log.entityId ?? ""),
        csvCell(log.beforeData != null ? JSON.stringify(log.beforeData) : ""),
        csvCell(log.afterData != null ? JSON.stringify(log.afterData) : ""),
        csvCell(log.requestId ?? ""),
        csvCell(log.ipHash ?? ""),
      ].join(",")
    ),
  ];

  return rows.join("\r\n") + "\r\n";
}
