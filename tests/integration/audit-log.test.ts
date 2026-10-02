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
import { createDwelling } from "../../src/domain/organizations/dwellings";
import {
  archiveMeter,
  createMeter,
  updateMeter,
} from "../../src/domain/organizations/meters";
import { createDwellingAccountAdjustment } from "../../src/domain/accounts/adjustments";
import {
  createConversation,
  reply,
  resolveConversation,
} from "../../src/domain/messaging/conversations";
import { createPeriod } from "../../src/domain/periods/periods";
import { submitAdminReading } from "../../src/domain/periods/readings";
import { generateInvoice } from "../../src/domain/billing/generation";
import { createRule } from "../../src/domain/billing/rules";

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

  it("scopes audit history by dwelling across mixed entity types, propagating domain events and isolating dwellings and orgs", async () => {
    const orgA = await createOrganization(
      db,
      { name: "Audit Scope Org A", addressLine1: "Org A St 1" },
      seedAdminId
    );
    const orgB = await createOrganization(
      db,
      { name: "Audit Scope Org B", addressLine1: "Org B St 1" },
      seedAdminId
    );

    try {
      // Create dwellings in Org A
      const dwellingA1 = await createDwelling(
        db,
        orgA.id,
        { number: "A101" },
        seedAdminId
      );
      const dwellingA2 = await createDwelling(
        db,
        orgA.id,
        { number: "A102" },
        seedAdminId
      );

      // Create dwelling in Org B
      const dwellingB1 = await createDwelling(
        db,
        orgB.id,
        { number: "B101" },
        seedAdminId
      );

      // --- Events for dwellingA1 ---
      // 1. Meter lifecycle (create, update, archive)
      const meter1 = await createMeter(
        db,
        orgA.id,
        dwellingA1.id,
        { serialNumber: "MTR-A101", type: "ELECTRICITY", unit: "kWh" },
        seedAdminId
      );
      await updateMeter(
        db,
        orgA.id,
        meter1.id,
        { serialNumber: "MTR-A101-V2" },
        seedAdminId
      );

      // Open a period and submit reading
      const period = await createPeriod(
        db,
        orgA.id,
        {
          year: 2026,
          month: 3,
          startsOn: "2026-03-01",
          endsOn: "2026-03-31",
          readingDeadline: "2026-04-05",
          invoiceIssueDate: "2026-04-06",
          invoiceDueDate: "2026-04-20",
        },
        seedAdminId
      );

      await submitAdminReading(
        db,
        orgA.id,
        period.id,
        meter1.id,
        "100.500",
        seedAdminId
      );

      await createRule(
        db,
        orgA.id,
        {
          name: "Fixed tariff",
          code: "FIXED",
          calculationType: "FIXED",
          unit: "month",
          unitPrice: "10.00",
          effectiveFrom: "2026-03-01",
        },
        seedAdminId
      );
      const invoice = await generateInvoice(
        db,
        orgA.id,
        period.id,
        dwellingA1.id,
        seedAdminId
      );
      await archiveMeter(db, orgA.id, meter1.id, seedAdminId);

      // 2. Account adjustment
      await createDwellingAccountAdjustment(db, {
        organizationId: orgA.id,
        dwellingId: dwellingA1.id,
        direction: "CREDIT",
        currency: "EUR",
        amount: "25.00",
        effectiveDate: "2026-03-15",
        reason: "Test adjustment",
        actorUserId: seedAdminId,
      });

      // 3. Conversation lifecycle
      const conv = await createConversation(
        db,
        dwellingA1.id,
        "Window broken",
        "Please fix",
        seedAdminId,
        "ADMIN"
      );
      const adminCtx = {
        userId: seedAdminId,
        email: seedAdminEmail,
        organizationIds: [orgA.id],
        dwellingIds: [],
      };
      await reply(db, conv.id, "Technician assigned", adminCtx, "ADMIN");
      await resolveConversation(db, orgA.id, conv.id, seedAdminId);

      // --- Events for dwellingA2 ---
      const meter2 = await createMeter(
        db,
        orgA.id,
        dwellingA2.id,
        { serialNumber: "MTR-A102", type: "COLD_WATER", unit: "m3" },
        seedAdminId
      );
      await createDwellingAccountAdjustment(db, {
        organizationId: orgA.id,
        dwellingId: dwellingA2.id,
        direction: "CHARGE",
        currency: "EUR",
        amount: "15.00",
        effectiveDate: "2026-03-15",
        reason: "A2 adjustment",
        actorUserId: seedAdminId,
      });

      // --- Unscoped org-wide event in Org A ---
      await recordAuditEvent(db, {
        organizationId: orgA.id,
        actorUserId: seedAdminId,
        action: "ORGANIZATION_UPDATED",
        entityType: "organization",
        entityId: orgA.id,
      });

      // --- Assertions for dwellingA1 ---
      const logsA1 = await listAuditLogs(db, orgA.id, {
        scopeDwellingId: dwellingA1.id,
      });

      expect(logsA1.length).toBeGreaterThanOrEqual(8);
      // Verify every log belongs to dwellingA1
      expect(logsA1.every((log) => log.scopeDwellingId === dwellingA1.id)).toBe(
        true
      );

      const actionsA1 = logsA1.map((log) => log.action);
      expect(actionsA1).toContain("DWELLING_CREATED");
      expect(actionsA1).toContain("METER_CREATED");
      expect(actionsA1).toContain("METER_UPDATED");
      expect(actionsA1).toContain("METER_READING_CREATED");
      expect(actionsA1).toContain("METER_ARCHIVED");
      expect(actionsA1).toContain("ACCOUNT_ADJUSTMENT_CREATED");
      expect(actionsA1).toContain("CONVERSATION_CREATED");
      expect(actionsA1).toContain("MESSAGE_SENT");
      expect(actionsA1).toContain("CONVERSATION_RESOLVED");
      expect(actionsA1).toContain("INVOICE_GENERATED");
      expect(
        logsA1.find((log) => log.entityId === invoice.id)?.entityType
      ).toBe("invoice");

      // Verify mixed entity types are present
      const entityTypesA1 = new Set(logsA1.map((l) => l.entityType));
      expect(entityTypesA1.has("dwelling")).toBe(true);
      expect(entityTypesA1.has("meter")).toBe(true);
      expect(entityTypesA1.has("meter_reading")).toBe(true);
      expect(entityTypesA1.has("account_entry")).toBe(true);
      expect(entityTypesA1.has("conversation")).toBe(true);
      expect(entityTypesA1.has("message")).toBe(true);

      // Isolation: None of dwellingA2's entities/actions or org-wide events appear in dwellingA1 logs
      expect(logsA1.some((l) => l.entityId === meter2.id)).toBe(false);
      expect(actionsA1).not.toContain("ORGANIZATION_UPDATED");

      // --- Assertions for dwellingA2 ---
      const logsA2 = await listAuditLogs(db, orgA.id, {
        scopeDwellingId: dwellingA2.id,
      });
      expect(logsA2.every((log) => log.scopeDwellingId === dwellingA2.id)).toBe(
        true
      );
      const actionsA2 = logsA2.map((log) => log.action);
      expect(actionsA2).toContain("DWELLING_CREATED");
      expect(actionsA2).toContain("METER_CREATED");
      expect(actionsA2).toContain("ACCOUNT_ADJUSTMENT_CREATED");
      expect(logsA2.some((l) => l.entityId === meter1.id)).toBe(false);

      // --- Isolation across organizations ---
      // Querying dwellingA1 under orgB returns nothing
      const logsWrongOrg = await listAuditLogs(db, orgB.id, {
        scopeDwellingId: dwellingA1.id,
      });
      expect(logsWrongOrg).toHaveLength(0);

      // Querying dwellingB1 under orgB returns only dwellingB1's event
      const logsB1 = await listAuditLogs(db, orgB.id, {
        scopeDwellingId: dwellingB1.id,
      });
      expect(logsB1.every((log) => log.scopeDwellingId === dwellingB1.id)).toBe(
        true
      );
      expect(logsB1.map((l) => l.action)).toContain("DWELLING_CREATED");
    } finally {
      await cleanupOrganization(db, orgA.id);
      await cleanupOrganization(db, orgB.id);
    }
  });
});
