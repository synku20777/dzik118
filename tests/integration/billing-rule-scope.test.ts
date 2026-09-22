// Recurring tariff applicability (ONE_TO_ALL/ONE_TO_MANY/ONE_TO_ONE) --
// domain-layer integration tests. Requires a real Postgres reachable via
// DATABASE_URL.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import { billingCases } from "../../src/db/schema/billing";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createMeter } from "../../src/domain/organizations/meters";
import { createPeriod } from "../../src/domain/periods/periods";
import {
  ConflictError,
  ValidationError,
  createRule,
  getApplicableRulesForDwelling,
  getAssignedRuleIdsForDwelling,
  getRuleAssignedDwellingIds,
  setDwellingRuleParticipation,
  updateRule,
} from "../../src/domain/billing/rules";
import {
  generateInvoice,
  getInvoice,
} from "../../src/domain/billing/generation";

let db: Db;
let seedAdminId: string;

async function getCaseForDwelling(
  organizationId: string,
  dwellingId: string,
  periodId: string
) {
  const [row] = await db
    .select()
    .from(billingCases)
    .where(
      and(
        eq(billingCases.organizationId, organizationId),
        eq(billingCases.dwellingId, dwellingId),
        eq(billingCases.periodId, periodId)
      )
    )
    .limit(1);
  return row ?? null;
}

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-scope-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

// A billing_case row for a (dwelling, period) pair is created by
// createPeriod for whichever dwellings already exist at that moment
// (src/domain/periods/periods.ts) -- there is no equivalent hook on
// dwelling creation. Every test that needs a real billing_case (invoice
// generation, case readiness) must therefore create its dwellings BEFORE
// calling createPeriodFor, same ordering convention as billing.test.ts's
// setupOrgAndPeriod.
const PERIOD_RANGE = { startsOn: "2026-05-01", endsOn: "2026-05-31" };

async function createOrg(name: string) {
  return createOrganization(db, { name, addressLine1: "Addr 1" }, seedAdminId);
}

async function createPeriodFor(organizationId: string) {
  return createPeriod(
    db,
    organizationId,
    {
      year: 2026,
      month: 5,
      startsOn: PERIOD_RANGE.startsOn,
      endsOn: PERIOD_RANGE.endsOn,
      invoiceIssueDate: "2026-05-31",
      invoiceDueDate: "2026-06-14",
    },
    seedAdminId
  );
}

describe("billing rule applicability scope", () => {
  it("ONE_TO_ALL applies to a dwelling created before AND after the rule", async () => {
    const org = await createOrg("Scope Org 1");
    const period = PERIOD_RANGE;
    const before = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Management fee",
        code: "mgmt",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2026-01-01",
      },
      seedAdminId
    );
    const after = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const rulesForBefore = await getApplicableRulesForDwelling(
      db,
      org.id,
      before.id,
      period
    );
    const rulesForAfter = await getApplicableRulesForDwelling(
      db,
      org.id,
      after.id,
      period
    );
    expect(rulesForBefore.map((r) => r.code)).toContain("mgmt");
    expect(rulesForAfter.map((r) => r.code)).toContain("mgmt");
    await cleanupOrg(org.id);
  });

  it("ONE_TO_MANY applies only to explicitly selected dwellings, never a new one", async () => {
    const org = await createOrg("Scope Org 2");
    const period = PERIOD_RANGE;
    const selected = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const notSelected = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Board parking",
        code: "board_parking",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "5.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [selected.id],
      },
      seedAdminId
    );
    const futureDwelling = await createDwelling(
      db,
      org.id,
      { number: "3", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const selectedRules = await getApplicableRulesForDwelling(
      db,
      org.id,
      selected.id,
      period
    );
    const notSelectedRules = await getApplicableRulesForDwelling(
      db,
      org.id,
      notSelected.id,
      period
    );
    const futureRules = await getApplicableRulesForDwelling(
      db,
      org.id,
      futureDwelling.id,
      period
    );
    expect(selectedRules.map((r) => r.id)).toContain(rule.id);
    expect(notSelectedRules.map((r) => r.id)).not.toContain(rule.id);
    expect(futureRules.map((r) => r.id)).not.toContain(rule.id);
    await cleanupOrg(org.id);
  });

  it("ONE_TO_ONE rejects zero or multiple dwellings, accepts exactly one", async () => {
    const org = await createOrg("Scope Org 3");
    const d1 = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const d2 = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    await expect(
      createRule(
        db,
        org.id,
        {
          name: "Parking A",
          code: "parking_a",
          calculationType: "FIXED",
          unit: "month",
          unitPrice: "15.00",
          effectiveFrom: "2026-01-01",
          applicationScope: "ONE_TO_ONE",
          dwellingIds: [],
        },
        seedAdminId
      )
    ).rejects.toThrow(ValidationError);
    await expect(
      createRule(
        db,
        org.id,
        {
          name: "Parking A",
          code: "parking_a",
          calculationType: "FIXED",
          unit: "month",
          unitPrice: "15.00",
          effectiveFrom: "2026-01-01",
          applicationScope: "ONE_TO_ONE",
          dwellingIds: [d1.id, d2.id],
        },
        seedAdminId
      )
    ).rejects.toThrow(ValidationError);
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Parking A",
        code: "parking_a",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "15.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_ONE",
        dwellingIds: [d1.id],
      },
      seedAdminId
    );
    expect(rule.applicationScope).toBe("ONE_TO_ONE");
    await cleanupOrg(org.id);
  });

  it("rejects a dwelling assignment from a different organization", async () => {
    const org1 = await createOrg("Scope Org 4a");
    const org2 = await createOrg("Scope Org 4b");
    const foreignDwelling = await createDwelling(
      db,
      org2.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    await expect(
      createRule(
        db,
        org1.id,
        {
          name: "Cross-org rule",
          code: "cross_org",
          calculationType: "FIXED",
          unit: "month",
          unitPrice: "5.00",
          effectiveFrom: "2026-01-01",
          applicationScope: "ONE_TO_ONE",
          dwellingIds: [foreignDwelling.id],
        },
        seedAdminId
      )
    ).rejects.toThrow(ValidationError);
    await cleanupOrg(org1.id);
    await cleanupOrg(org2.id);
  });

  it("dwelling-side participation toggling never silently reassigns a ONE_TO_ONE rule", async () => {
    const org = await createOrg("Scope Org 5");
    const owner = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const other = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Reserved spot",
        code: "reserved_spot",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "20.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_ONE",
        dwellingIds: [owner.id],
      },
      seedAdminId
    );
    await expect(
      setDwellingRuleParticipation(db, org.id, other.id, [rule.id], seedAdminId)
    ).rejects.toThrow(ConflictError);
    // The rule must still belong only to its original owner.
    const stillOnOwner = await getApplicableRulesForDwelling(
      db,
      org.id,
      owner.id,
      PERIOD_RANGE
    );
    expect(stillOnOwner.map((r) => r.id)).toContain(rule.id);
    await cleanupOrg(org.id);
  });

  it("switching an existing ONE_TO_MANY rule to ONE_TO_ONE re-validates cardinality", async () => {
    const org = await createOrg("Scope Org 6");
    const d1 = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const d2 = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Storage",
        code: "storage",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "3.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [d1.id, d2.id],
      },
      seedAdminId
    );
    await expect(
      updateRule(
        db,
        org.id,
        rule.id,
        { applicationScope: "ONE_TO_ONE" },
        seedAdminId
      )
    ).rejects.toThrow(ValidationError);
    const updated = await updateRule(
      db,
      org.id,
      rule.id,
      { applicationScope: "ONE_TO_ONE", dwellingIds: [d1.id] },
      seedAdminId
    );
    expect(updated.applicationScope).toBe("ONE_TO_ONE");
    await cleanupOrg(org.id);
  });

  it("switching ONE_TO_MANY to ONE_TO_ALL clears its old assignments even when the caller sends no dwellingIds", async () => {
    // Mirrors the drawer's real submission shape for "All dwellings": the
    // browser never sends an empty multi-value field, so this update omits
    // dwellingIds entirely -- the fix must still clear the 2 existing rows.
    const org = await createOrg("Scope Org 12");
    const d1 = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const d2 = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Bike room",
        code: "bike_room",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "4.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [d1.id, d2.id],
      },
      seedAdminId
    );
    const updated = await updateRule(
      db,
      org.id,
      rule.id,
      { applicationScope: "ONE_TO_ALL" },
      seedAdminId
    );
    expect(updated.applicationScope).toBe("ONE_TO_ALL");
    expect(await getRuleAssignedDwellingIds(db, rule.id)).toEqual([]);
    await cleanupOrg(org.id);
  });

  it("a ONE_TO_MANY tariff can never be saved with zero dwellings, on create or update", async () => {
    const org = await createOrg("Scope Org 13");
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    await expect(
      createRule(
        db,
        org.id,
        {
          name: "Empty selection",
          code: "empty_selection",
          calculationType: "FIXED",
          unit: "month",
          unitPrice: "1.00",
          effectiveFrom: "2026-01-01",
          applicationScope: "ONE_TO_MANY",
          dwellingIds: [],
        },
        seedAdminId
      )
    ).rejects.toThrow(ValidationError);

    const rule = await createRule(
      db,
      org.id,
      {
        name: "Storage 3",
        code: "storage_3",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "1.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [dwelling.id],
      },
      seedAdminId
    );
    // "Clear selection, then Save" (no dwellingIds sent, scope unchanged)
    // must be rejected, not silently keep the old assignment.
    await expect(
      updateRule(
        db,
        org.id,
        rule.id,
        { applicationScope: "ONE_TO_MANY" },
        seedAdminId
      )
    ).rejects.toThrow(ValidationError);
    expect(await getRuleAssignedDwellingIds(db, rule.id)).toEqual([
      dwelling.id,
    ]);
    await cleanupOrg(org.id);
  });

  it("a meter reading is not required when the only tariff for that meter type doesn't apply to this dwelling", async () => {
    const org = await createOrg("Scope Org 14");
    const withRule = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const withoutRule = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    await createMeter(
      db,
      org.id,
      withRule.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );
    await createMeter(
      db,
      org.id,
      withoutRule.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );
    const period = await createPeriodFor(org.id);
    await createRule(
      db,
      org.id,
      {
        name: "Cold water",
        code: "cold_water_scoped",
        calculationType: "METER_CONSUMPTION",
        meterType: "COLD_WATER",
        unit: "m3",
        unitPrice: "2.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_ONE",
        dwellingIds: [withRule.id],
      },
      seedAdminId
    );
    const withRuleCase = await getCaseForDwelling(
      org.id,
      withRule.id,
      period.id
    );
    const withoutRuleCase = await getCaseForDwelling(
      org.id,
      withoutRule.id,
      period.id
    );
    expect(
      (withRuleCase?.missingData as unknown[] | undefined)?.length
    ).toBeGreaterThan(0);
    // The dwelling whose cold-water tariff doesn't apply to it must not be
    // blocked on a reading invoice generation will never use.
    expect(withoutRuleCase?.missingData).toEqual([]);
    await cleanupOrg(org.id);
  });

  it("a zero-price tariff creates cleanly and its invoice line stays visible", async () => {
    const org = await createOrg("Scope Org 7");
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const period = await createPeriodFor(org.id);
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Free amenity",
        code: "free_amenity",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "0",
        effectiveFrom: "2026-01-01",
      },
      seedAdminId
    );
    expect(rule.unitPrice).toBe("0.0000");
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const { lines } = await getInvoice(db, org.id, invoice.id);
    const freeLine = lines.find((l) => l.billingRuleId === rule.id);
    expect(freeLine).toBeDefined();
    expect(freeLine!.netAmount).toBe("0.00");
    await cleanupOrg(org.id);
  });

  it("invoice generation only bills a dwelling for rules that apply to it", async () => {
    const org = await createOrg("Scope Org 8");
    const apt1 = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const apt2 = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    await createDwelling(
      db,
      org.id,
      { number: "3", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const period = await createPeriodFor(org.id);
    const allRule = await createRule(
      db,
      org.id,
      {
        name: "Mgmt",
        code: "mgmt2",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2026-01-01",
      },
      seedAdminId
    );
    const manyRule = await createRule(
      db,
      org.id,
      {
        name: "Storage 2",
        code: "storage2",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "3.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [apt1.id],
      },
      seedAdminId
    );
    const oneRule = await createRule(
      db,
      org.id,
      {
        name: "Reserved 2",
        code: "reserved2",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "20.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_ONE",
        dwellingIds: [apt2.id],
      },
      seedAdminId
    );

    const invoice1 = await generateInvoice(
      db,
      org.id,
      period.id,
      apt1.id,
      seedAdminId
    );
    const { lines: lines1 } = await getInvoice(db, org.id, invoice1.id);
    const codes1 = lines1.map((l) => l.billingRuleId);
    expect(codes1).toContain(allRule.id);
    expect(codes1).toContain(manyRule.id);
    expect(codes1).not.toContain(oneRule.id);

    const invoice2 = await generateInvoice(
      db,
      org.id,
      period.id,
      apt2.id,
      seedAdminId
    );
    const { lines: lines2 } = await getInvoice(db, org.id, invoice2.id);
    const codes2 = lines2.map((l) => l.billingRuleId);
    expect(codes2).toContain(allRule.id);
    expect(codes2).not.toContain(manyRule.id);
    expect(codes2).toContain(oneRule.id);

    await cleanupOrg(org.id);
  });

  it("dwelling-side unassign can never orphan a ONE_TO_ONE rule to zero dwellings", async () => {
    const org = await createOrg("Scope Org 10");
    const owner = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Reserved spot 2",
        code: "reserved_spot_2",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "20.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_ONE",
        dwellingIds: [owner.id],
      },
      seedAdminId
    );
    // Unchecking its own one-to-one tariff must be rejected, not silently
    // leave the rule with zero dwellings.
    await expect(
      setDwellingRuleParticipation(db, org.id, owner.id, [], seedAdminId)
    ).rejects.toThrow(ConflictError);
    const stillAssigned = await getApplicableRulesForDwelling(
      db,
      org.id,
      owner.id,
      PERIOD_RANGE
    );
    expect(stillAssigned.map((r) => r.id)).toContain(rule.id);
    await cleanupOrg(org.id);
  });

  it("saving unrelated dwelling checkboxes never unassigns a disabled scoped rule", async () => {
    const org = await createOrg("Scope Org 11");
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const otherEligible = await createRule(
      db,
      org.id,
      {
        name: "Bike storage",
        code: "bike_storage",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "2.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [dwelling.id],
      },
      seedAdminId
    );
    const disabledRule = await createRule(
      db,
      org.id,
      {
        name: "Legacy storage",
        code: "legacy_storage",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "1.00",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [dwelling.id],
        enabled: false,
      },
      seedAdminId
    );
    // Re-submit only the still-eligible rule (the disabled one is never
    // rendered as a checkbox, so a real form submit would never include it
    // either) -- the disabled rule's assignment must survive untouched.
    await setDwellingRuleParticipation(
      db,
      org.id,
      dwelling.id,
      [otherEligible.id],
      seedAdminId
    );
    const assignedIds = await getAssignedRuleIdsForDwelling(db, dwelling.id);
    expect(assignedIds.has(otherEligible.id)).toBe(true);
    expect(assignedIds.has(disabledRule.id)).toBe(true);
    await cleanupOrg(org.id);
  });

  it("a ONE_TO_ONE manual rule only requires input from its assigned dwelling", async () => {
    const org = await createOrg("Scope Org 9");
    const target = await createDwelling(
      db,
      org.id,
      { number: "1", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const other = await createDwelling(
      db,
      org.id,
      { number: "2", areaM2: "10", residentCount: 1 },
      seedAdminId
    );
    const period = await createPeriodFor(org.id);
    await createRule(
      db,
      org.id,
      {
        name: "Special assessment",
        code: "special_assessment",
        calculationType: "MANUAL_AMOUNT",
        unit: "charge",
        effectiveFrom: "2026-01-01",
        applicationScope: "ONE_TO_ONE",
        dwellingIds: [target.id],
      },
      seedAdminId
    );
    const otherCase = await getCaseForDwelling(org.id, other.id, period.id);
    const targetCase = await getCaseForDwelling(org.id, target.id, period.id);
    expect(otherCase?.missingData).toEqual([]);
    expect(
      (targetCase?.missingData as unknown[] | undefined)?.length
    ).toBeGreaterThan(0);
    await cleanupOrg(org.id);
  });
});
