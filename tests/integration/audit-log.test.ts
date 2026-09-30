import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  requireDatabaseUrl,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { recordAuditEvent } from "../../src/lib/logging/audit";
import { runWithRequestContext } from "../../src/lib/logging/request-context";
import {
  exportAuditLogsCsv,
  listAuditLogs,
  listDistinctAuditActors,
  listDistinctAuditEntityTypes,
} from "../../src/domain/audit/audit-log";

let db: Db;
let seedAdminId: string;
const seedAdminEmail = "it-audit-admin@example.com";

beforeAll(async () => {
  requireDatabaseUrl();
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, seedAdminEmail);
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

describe("audit log domain", () => {
  it("filters audit logs by entity type, actor, and date range", async () => {
    const org = await createOrganization(
      db,
      { name: "Audit Log Test Org", addressLine1: "Brīvības iela 1" },
      seedAdminId
    );

    try {
      await recordAuditEvent(db, {
        organizationId: org.id,
        actorUserId: seedAdminId,
        action: "INVOICE_GENERATED",
        entityType: "invoice",
      });
      await recordAuditEvent(db, {
        organizationId: org.id,
        actorUserId: seedAdminId,
        action: "INVOICE_SENT",
        entityType: "invoice",
      });
      await recordAuditEvent(db, {
        organizationId: org.id,
        actorUserId: seedAdminId,
        action: "DWELLING_CREATED",
        entityType: "dwelling",
      });

      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const yesterdayDate = new Date(now);
      yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
      const yesterday = yesterdayDate.toISOString().slice(0, 10);

      const invoiceLogs = await listAuditLogs(db, org.id, {
        entityType: "invoice",
      });
      expect(invoiceLogs).toHaveLength(2);
      expect(invoiceLogs.every((l) => l.entityType === "invoice")).toBe(true);

      const actorLogs = await listAuditLogs(db, org.id, {
        actorUserId: seedAdminId,
      });
      expect(actorLogs.length).toBeGreaterThanOrEqual(3);
      expect(actorLogs.every((l) => l.actorEmail === seedAdminEmail)).toBe(
        true
      );

      const todayLogs = await listAuditLogs(db, org.id, {
        fromDate: today,
        toDate: today,
        timezone: "UTC",
      });
      expect(todayLogs.length).toBeGreaterThanOrEqual(3);

      const yesterdayLogs = await listAuditLogs(db, org.id, {
        toDate: yesterday,
        timezone: "UTC",
      });
      expect(yesterdayLogs).toHaveLength(0);

      const distinctTypes = await listDistinctAuditEntityTypes(db, org.id);
      expect(distinctTypes).toEqual(["dwelling", "invoice", "organization"]);

      const distinctActors = await listDistinctAuditActors(db, org.id);
      expect(distinctActors).toEqual([
        { id: seedAdminId, label: seedAdminEmail },
      ]);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("exports audit logs to CSV with formula injection neutralized and quotes escaped", async () => {
    const org = await createOrganization(
      db,
      { name: "Audit Log CSV Export Org", addressLine1: "Brīvības iela 2" },
      seedAdminId
    );

    try {
      await recordAuditEvent(db, {
        organizationId: org.id,
        actorUserId: seedAdminId,
        action: "TEST_FORMULA",
        entityType: '=HYPERLINK("x")',
        afterData: { note: '=HYPERLINK("x")' },
      });
      await recordAuditEvent(db, {
        organizationId: org.id,
        actorUserId: seedAdminId,
        action: "TEST_STANDARD",
        entityType: "dwelling",
        afterData: { note: 'regular "quote"' },
      });

      const events = await listAuditLogs(db, org.id);
      const csv = await exportAuditLogsCsv(db, org.id);

      const lines = csv.trimEnd().split("\r\n");
      expect(lines[0]).toBe(
        '"created_at","actor","action","entity_type","entity_id","before","after","request_id","ip_hash"'
      );
      expect(lines.slice(1)).toHaveLength(events.length);
      expect(csv).toContain('"\'=HYPERLINK(""x"")"');
      expect(csv).toContain('""x""');
      expect(csv).toContain('\\""quote\\""');
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("stores the request ID and IP hash from the request context", async () => {
    const org = await createOrganization(
      db,
      { name: "Audit Context Org", addressLine1: "Brīvības iela 3" },
      seedAdminId
    );
    try {
      await runWithRequestContext(
        { requestId: "req_test_123", ipHash: "a".repeat(64) },
        () =>
          recordAuditEvent(db, {
            organizationId: org.id,
            actorUserId: seedAdminId,
            action: "WITH_CONTEXT",
            entityType: "invoice",
          })
      );
      await recordAuditEvent(db, {
        organizationId: org.id,
        actorUserId: seedAdminId,
        action: "WITHOUT_CONTEXT",
        entityType: "invoice",
      });

      const logs = await listAuditLogs(db, org.id, { entityType: "invoice" });
      const withContext = logs.find((l) => l.action === "WITH_CONTEXT");
      const without = logs.find((l) => l.action === "WITHOUT_CONTEXT");
      expect(withContext?.requestId).toBe("req_test_123");
      expect(withContext?.ipHash).toBe("a".repeat(64));
      expect(without?.requestId).toBeNull();
      expect(without?.ipHash).toBeNull();

      const csv = await exportAuditLogsCsv(db, org.id);
      const [header] = csv.split("\r\n");
      expect(header).toContain('"request_id","ip_hash"');
      expect(csv).toContain('"req_test_123"');
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });
});
