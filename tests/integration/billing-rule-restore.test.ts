// Restoring an archived tariff and the code lock, against a real Postgres
// (DATABASE_URL). Each test makes its own organization and removes it.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import { auditLogs } from "../../src/db/schema/audit";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  archiveRule,
  createRule,
  getEffectiveRules,
  restoreRule,
  setRuleEnabled,
  updateRule,
} from "../../src/domain/billing/rules";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-rule-restore-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

async function orgWithRule(name: string) {
  const org = await createOrganization(
    db,
    { name, addressLine1: "Addr 1" },
    adminId
  );
  const rule = await createRule(
    db,
    org.id,
    {
      name: "Water",
      code: "WATER",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "1.00",
      effectiveFrom: "2026-01-01",
    },
    adminId
  );
  return { org, rule };
}

describe("restoring an archived tariff", () => {
  it("comes back disabled, keeps its code and is audited", async () => {
    const { org, rule } = await orgWithRule("Restore Org 1");
    try {
      await archiveRule(db, org.id, rule.id, adminId);
      const restored = await restoreRule(db, org.id, rule.id, adminId);
      expect(restored.archivedAt).toBeNull();
      expect(restored.enabled).toBe(false);
      expect(restored.code).toBe("WATER");
      // Disabled, so it bills nothing until it is enabled again.
      const period = { startsOn: "2026-05-01", endsOn: "2026-05-31" };
      expect(
        (await getEffectiveRules(db, org.id, period)).map((r) => r.id)
      ).not.toContain(rule.id);
      const audit = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, org.id),
            eq(auditLogs.action, "BILLING_RULE_RESTORED")
          )
        );
      expect(audit).toHaveLength(1);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("refuses a tariff that is not archived, and one from another organization", async () => {
    const a = await orgWithRule("Restore Org 2");
    const b = await orgWithRule("Restore Org 3");
    try {
      await expect(
        restoreRule(db, a.org.id, a.rule.id, adminId)
      ).rejects.toBeInstanceOf(ConflictError);
      await archiveRule(db, b.org.id, b.rule.id, adminId);
      await expect(
        restoreRule(db, a.org.id, b.rule.id, adminId)
      ).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await cleanupOrganization(db, a.org.id);
      await cleanupOrganization(db, b.org.id);
    }
  });
});

describe("turning a tariff off and on", () => {
  it("toggles with one audit row per change, no row for a no-op, and refuses archived tariffs", async () => {
    const { org, rule } = await orgWithRule("Toggle Org");
    const auditCount = async () =>
      (
        await db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(eq(auditLogs.organizationId, org.id))
      ).length;
    try {
      const before = await auditCount();
      const off = await setRuleEnabled(db, org.id, rule.id, false, adminId);
      expect(off.enabled).toBe(false);
      // Every other field is untouched.
      expect(off.unitPrice).toBe(rule.unitPrice);
      expect(off.code).toBe("WATER");
      expect(await auditCount()).toBe(before + 1);
      await setRuleEnabled(db, org.id, rule.id, false, adminId);
      expect(await auditCount()).toBe(before + 1);
      const on = await setRuleEnabled(db, org.id, rule.id, true, adminId);
      expect(on.enabled).toBe(true);
      await archiveRule(db, org.id, rule.id, adminId);
      await expect(
        setRuleEnabled(db, org.id, rule.id, true, adminId)
      ).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });
});

describe("the tariff code", () => {
  it("cannot change after creation; repeating it or leaving it out still saves", async () => {
    const { org, rule } = await orgWithRule("Code Lock Org");
    try {
      await expect(
        updateRule(db, org.id, rule.id, { code: "WATER_2" }, adminId)
      ).rejects.toBeInstanceOf(ValidationError);
      const same = await updateRule(
        db,
        org.id,
        rule.id,
        { code: "WATER", unitPrice: "1.20" },
        adminId
      );
      expect(same.unitPrice).toBe("1.2000");
      const omitted = await updateRule(
        db,
        org.id,
        rule.id,
        { unitPrice: "1.30" },
        adminId
      );
      expect(omitted.code).toBe("WATER");
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });
});
