import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import { setRuleEnabled } from "../../src/domain/billing/rules";
import { ConflictError, NotFoundError } from "../../src/domain/errors";
import { recordAuditEvent } from "../../src/lib/logging/audit";
import { recalculateCaseReadinessForOrganizationOpenPeriods } from "../../src/domain/periods/case-readiness";

vi.mock("../../src/lib/logging/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("../../src/domain/periods/case-readiness", () => ({
  recalculateCaseReadinessForOrganizationOpenPeriods: vi.fn(),
}));

function database(
  before: { archivedAt: Date | null; enabled: boolean } | undefined
) {
  const rule = before && {
    ...before,
    id: "rule",
    nameEn: "Name",
    nameRu: "Имя",
    description: "Keep me",
    code: "WATER",
    calculationType: "FIXED",
    unitPrice: "1.00",
    vatRate: "21",
    applicationScope: "ONE_TO_ALL",
    effectiveUntil: "2030-01-01",
  };
  const after = { ...rule, enabled: !rule?.enabled };
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rule ? [rule] : []),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([after]),
    then: (resolve: (value: never[]) => unknown) =>
      Promise.resolve([]).then(resolve),
  };
  const tx = {
    select: vi.fn(() => query),
    update: vi.fn(() => query),
    transaction: vi.fn(
      async (run: (tx: unknown) => unknown): Promise<unknown> => run(tx)
    ),
  };
  const db = {
    transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(tx)),
  };
  return { db: db as unknown as Db, tx, query, rule, after };
}

beforeEach(() => vi.clearAllMocks());

it.each([
  [true, "Restore the tariff before turning it on."],
  [false, "Archived tariffs cannot be changed."],
] as const)(
  "refuses changing an archived tariff to %s without writes",
  async (enabled, message) => {
    const { db, tx } = database({ archivedAt: new Date(), enabled: false });
    const result = setRuleEnabled(db, "org", "rule", enabled, "actor");
    await expect(result).rejects.toBeInstanceOf(ConflictError);
    await expect(result).rejects.toThrow(message);
    expect(tx.update).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  }
);

it.each([true, false])(
  "leaves an unchanged %s tariff and its audit untouched",
  async (enabled) => {
    const { db, tx, rule } = database({ archivedAt: null, enabled });
    await expect(
      setRuleEnabled(db, "org", "rule", enabled, "actor")
    ).resolves.toBe(rule);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.transaction).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(
      recalculateCaseReadinessForOrganizationOpenPeriods
    ).not.toHaveBeenCalled();
  }
);

it.each([true, false])(
  "delegates a change to %s to the shared update, preserving other fields and auditing/readiness",
  async (enabled) => {
    const { db, tx, query, rule, after } = database({
      archivedAt: null,
      enabled: !enabled,
    });
    await expect(
      setRuleEnabled(db, "org", "rule", enabled, "actor")
    ).resolves.toEqual(after);
    expect(query.for).toHaveBeenCalledWith("update");
    expect(tx.transaction).toHaveBeenCalledOnce();
    expect(tx.update).toHaveBeenCalledOnce();
    expect(query.set).toHaveBeenCalledWith({
      enabled,
      updatedAt: expect.any(Date),
    });
    const conditions = query.where.mock.calls as [SQL][];
    expect(new PgDialect().sqlToQuery(conditions[0][0]).params).toEqual([
      "rule",
      "org",
    ]);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: "org",
        actorUserId: "actor",
        action: "BILLING_RULE_UPDATED",
        beforeData: { ...rule, dwellingIds: [] },
        afterData: { ...after, dwellingIds: [] },
      })
    );
    expect(
      recalculateCaseReadinessForOrganizationOpenPeriods
    ).toHaveBeenCalledWith(tx, "org");
  }
);

it("rejects a missing or foreign-organization rule without writing", async () => {
  const { db, tx } = database(undefined);
  await expect(
    setRuleEnabled(db, "org", "rule", true, "actor")
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(tx.update).not.toHaveBeenCalled();
});
