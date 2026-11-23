import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import { restoreRule, updateRule } from "../../src/domain/billing/rules";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../src/domain/errors";
import { recordAuditEvent } from "../../src/lib/logging/audit";
import { recalculateCaseReadinessForOrganizationOpenPeriods } from "../../src/domain/periods/case-readiness";

vi.mock("../../src/lib/logging/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("../../src/domain/periods/case-readiness", () => ({
  recalculateCaseReadinessForOrganizationOpenPeriods: vi.fn(),
}));

function database(
  before: { code: string; archivedAt: Date | null } | undefined
) {
  if (before)
    Object.assign(before, {
      calculationType: "FIXED",
      unitPrice: "1.00",
      applicationScope: "ONE_TO_ALL",
    });
  const after = { ...before, archivedAt: null, enabled: false };
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(before ? [before] : []),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([after]),
    then: (resolve: (value: never[]) => unknown) =>
      Promise.resolve([]).then(resolve),
  };
  const tx = { select: vi.fn(() => query), update: vi.fn(() => query) };
  const db = {
    transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(tx)),
  };
  return { db: db as unknown as Db, tx, query, after };
}

beforeEach(() => vi.clearAllMocks());

it.each([{}, { code: "WATER" }])(
  "allows old clients to omit or repeat the stored code: %j",
  async (patch) => {
    const { db, tx, after } = database({ code: "WATER", archivedAt: null });
    await expect(
      updateRule(db, "org", "rule", patch, "actor")
    ).resolves.toEqual(after);
    expect(tx.update).toHaveBeenCalledOnce();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "BILLING_RULE_UPDATED" })
    );
  }
);

describe("billing rule restore and code lock (no database)", () => {
  it("restores disabled, audits the snapshots and recalculates readiness in the transaction", async () => {
    const before = { code: "WATER", archivedAt: new Date() };
    const { db, tx, query, after } = database(before);
    await expect(restoreRule(db, "org", "rule", "actor")).resolves.toEqual(
      after
    );
    expect(query.for).toHaveBeenCalledWith("update");
    expect(query.set).toHaveBeenCalledWith({
      archivedAt: null,
      enabled: false,
      updatedAt: expect.any(Date),
    });
    for (const [condition] of query.where.mock.calls as [SQL][]) {
      expect(new PgDialect().sqlToQuery(condition).params).toEqual([
        "rule",
        "org",
      ]);
    }
    expect(recordAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: "org",
        actorUserId: "actor",
        action: "BILLING_RULE_RESTORED",
        entityType: "billing_rule",
        entityId: "rule",
        beforeData: before,
        afterData: after,
      })
    );
    expect(
      recalculateCaseReadinessForOrganizationOpenPeriods
    ).toHaveBeenCalledWith(tx, "org");
  });

  it("rejects a rule that is not archived without writing", async () => {
    const { db, tx } = database({ code: "WATER", archivedAt: null });
    await expect(
      restoreRule(db, "org", "rule", "actor")
    ).rejects.toBeInstanceOf(ConflictError);
    expect(tx.update).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(
      recalculateCaseReadinessForOrganizationOpenPeriods
    ).not.toHaveBeenCalled();
  });

  it("rejects a missing or out-of-organization rule without writing", async () => {
    const { db, tx } = database(undefined);
    await expect(
      restoreRule(db, "org", "rule", "actor")
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("refuses a code change before any other rule or assignment write", async () => {
    const { db, tx } = database({ code: "WATER", archivedAt: null });
    const result = updateRule(db, "org", "rule", { code: "OTHER" }, "actor");
    await expect(result).rejects.toBeInstanceOf(ValidationError);
    await expect(result).rejects.toThrow(
      "The code cannot be changed after the tariff is created."
    );
    expect(tx.update).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
