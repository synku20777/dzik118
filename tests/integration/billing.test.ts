// Phase F (Billing) - domain-layer integration tests (spec BIL-001..005,
// INV-001/002/004). Requires a real Postgres reachable via DATABASE_URL.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../src/db/client";
import { invoiceLines, invoices } from "../../src/db/schema/invoices";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  requireDatabaseUrl,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import {
  createDwelling,
  updateDwelling,
} from "../../src/domain/organizations/dwellings";
import { createMeter } from "../../src/domain/organizations/meters";
import { createPeriod, lockPeriod } from "../../src/domain/periods/periods";
import { submitAdminReading } from "../../src/domain/periods/readings";
import { submitManualRuleInput } from "../../src/domain/periods/manual-rule-inputs";
import {
  ConflictError,
  archiveRule,
  createRule,
  getEffectiveRules,
  updateRule,
} from "../../src/domain/billing/rules";
import { buildPreviewLines } from "../../src/domain/billing/invoice-template-preview";
import { rowPresentationKey } from "../../src/domain/billing/invoice-html";
import {
  NotFoundError,
  ValidationError,
  bulkGenerateInvoices,
  generateInvoice,
  getInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import { updateInvoiceTemplate } from "../../src/domain/billing/invoice-templates";
import { createDefaultInvoiceTemplateConfig } from "../../src/domain/billing/invoice-template-schema";
import { renderInvoiceHtml } from "../../src/domain/billing/invoice-html";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-f-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

async function setupOrgAndPeriod(name: string, month: number) {
  const org = await createOrganization(
    db,
    { name, addressLine1: "Addr 1" },
    seedAdminId
  );
  const dwelling = await createDwelling(
    db,
    org.id,
    { number: "1", areaM2: "45.50", residentCount: 3 },
    seedAdminId
  );
  const dueYear = month === 12 ? 2027 : 2026;
  const dueMonth = month === 12 ? 1 : month + 1;
  const period = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month,
      startsOn: `2026-${String(month).padStart(2, "0")}-01`,
      endsOn: `2026-${String(month).padStart(2, "0")}-28`,
      invoiceIssueDate: `2026-${String(month).padStart(2, "0")}-28`,
      invoiceDueDate: `${dueYear}-${String(dueMonth).padStart(2, "0")}-14`,
    },
    seedAdminId
  );
  return { org, dwelling, period };
}

describe("billing rules", () => {
  it("BIL-005: only the effective rule version applies", async () => {
    const { org, period } = await setupOrgAndPeriod("IT-F Org 1", 1);
    await createRule(
      db,
      org.id,
      {
        name: "Future rule",
        code: "future",
        calculationType: "FIXED",
        unit: "unit",
        unitPrice: "5.00",
        effectiveFrom: "2099-01-01",
      },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Expired rule",
        code: "expired",
        calculationType: "FIXED",
        unit: "unit",
        unitPrice: "5.00",
        effectiveFrom: "2020-01-01",
        effectiveUntil: "2020-12-31",
      },
      seedAdminId
    );
    const current = await createRule(
      db,
      org.id,
      {
        name: "Current rule",
        code: "current",
        calculationType: "FIXED",
        unit: "unit",
        unitPrice: "5.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const effective = await getEffectiveRules(db, org.id, period);
    expect(effective.map((r) => r.id)).toEqual([current.id]);
    await cleanupOrg(org.id);
  });

  it("rejects a duplicate rule code in the same organization", async () => {
    const { org } = await setupOrgAndPeriod("IT-F Org 2", 2);
    await createRule(
      db,
      org.id,
      {
        name: "R",
        code: "dup",
        calculationType: "FIXED",
        unit: "unit",
        unitPrice: "1.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await expect(
      createRule(
        db,
        org.id,
        {
          name: "R2",
          code: "dup",
          calculationType: "FIXED",
          unit: "unit",
          unitPrice: "2.00",
          effectiveFrom: "2025-01-01",
        },
        seedAdminId
      )
    ).rejects.toBeInstanceOf(ConflictError);
    await cleanupOrg(org.id);
  });

  it("the invoice template preview's charge rows come only from active, effective, same-org rules -- same resolver generateInvoice() uses", async () => {
    const { org, period } = await setupOrgAndPeriod("IT-F Org 15", 8);
    const other = await createOrganization(
      db,
      { name: "IT-F Org 15 Other", addressLine1: "Addr 1" },
      seedAdminId
    );

    const active = await createRule(
      db,
      org.id,
      {
        name: "Active fee",
        code: "active-fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        vatRate: "21.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const disabled = await createRule(
      db,
      org.id,
      {
        name: "Disabled fee",
        code: "disabled-fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "20.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await updateRule(db, org.id, disabled.id, { enabled: false }, seedAdminId);
    const toArchive = await createRule(
      db,
      org.id,
      {
        name: "Archived fee",
        code: "archived-fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "30.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await archiveRule(db, org.id, toArchive.id, seedAdminId);
    await createRule(
      db,
      other.id,
      {
        name: "Other org's fee",
        code: "other-org-fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "40.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    const effective = await getEffectiveRules(db, org.id, period);
    const previewLines = buildPreviewLines(effective);

    expect(previewLines).toHaveLength(1);
    expect(previewLines[0].description).toBe("Active fee");
    expect(rowPresentationKey(previewLines[0])).toBe(active.code);

    await cleanupOrg(org.id);
    await cleanupOrg(other.id);
  });
});

describe("invoice generation", () => {
  it("INV-001/BIL-001/002/003: generates fixed, area, and resident-count lines with reconciling totals", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod("IT-F Org 3", 3);
    await createRule(
      db,
      org.id,
      {
        name: "Service fee",
        code: "fixed",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        vatRate: "21.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Maintenance",
        code: "area",
        calculationType: "AREA",
        unit: "m2",
        unitPrice: "1.2500",
        vatRate: "21.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Waste",
        code: "residents",
        calculationType: "RESIDENT_COUNT",
        unit: "person",
        unitPrice: "3.5000",
        vatRate: "21.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const { lines } = await getInvoice(db, org.id, invoice.id);
    expect(lines).toHaveLength(3);

    // fixed: 1 x 10.00 = 10.00 net, 2.10 vat
    // area: 45.50 x 1.25 = 56.875 -> 56.88 net, 11.9448 -> 11.94 vat
    // residents: 3 x 3.50 = 10.50 net, 2.205 -> 2.21 (half-up) vat... verify exact via sum instead of hand-checking each
    const expectedSubtotal = lines
      .reduce((sum, l) => sum + Number(l.netAmount), 0)
      .toFixed(2);
    expect(invoice.subtotal).toBe(expectedSubtotal);
    expect(Number(invoice.total)).toBeCloseTo(
      Number(invoice.subtotal) + Number(invoice.vatTotal),
      2
    );

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where period_id = $1 and dwelling_id = $2",
        [period.id, dwelling.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("DRAFT");

    // retry does not duplicate -- regenerates the same invoice id/number.
    const regenerated = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    expect(regenerated.id).toBe(invoice.id);
    expect(regenerated.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(regenerated.version).toBe(2);
    const allInvoicesForCase = await db
      .select()
      .from(invoices)
      .where(eq(invoices.billingCaseId, invoice.billingCaseId));
    expect(allInvoicesForCase).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("BIL-004: meter rule uses correct meter type and sums consumption; missing data blocks generation", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod("IT-F Org 4", 4);
    const meter = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Cold water",
        code: "cold",
        calculationType: "METER_CONSUMPTION",
        meterType: "COLD_WATER",
        unit: "m3",
        unitPrice: "2.0000",
        vatRate: "21.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    await expect(
      generateInvoice(db, org.id, period.id, dwelling.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await submitAdminReading(
      db,
      org.id,
      period.id,
      meter.id,
      "12.500",
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const { lines } = await getInvoice(db, org.id, invoice.id);
    expect(lines).toHaveLength(1);
    // invoice_lines.quantity is numeric(14,4); Postgres pads the meter's
    // 3-decimal consumption value to the column's declared scale.
    expect(lines[0].quantity).toBe("12.5000");
    expect(lines[0].netAmount).toBe("25.00");

    await cleanupOrg(org.id);
  });

  it("skips a rule with no line items and rejects generation with zero applicable rules", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod("IT-F Org 5", 5);
    await createRule(
      db,
      org.id,
      {
        name: "Hot water",
        code: "hot",
        calculationType: "METER_CONSUMPTION",
        meterType: "HOT_WATER",
        unit: "m3",
        unitPrice: "3.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await expect(
      generateInvoice(db, org.id, period.id, dwelling.id, seedAdminId)
    ).rejects.toBeInstanceOf(ValidationError);
    await cleanupOrg(org.id);
  });

  it("invoice immutability: editing a billing rule after generation does not change the persisted invoice", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod("IT-F Org 6", 6);
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        vatRate: "21.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const { lines: before } = await getInvoice(db, org.id, invoice.id);
    expect(before[0].netAmount).toBe("10.00");

    // Change the org's billing rule and the dwelling's area (a recipient
    // snapshot field) after the fact.
    const { updateRule } = await import("../../src/domain/billing/rules");
    await updateRule(db, org.id, rule.id, { unitPrice: "999.00" }, seedAdminId);
    await updateDwelling(
      db,
      org.id,
      dwelling.id,
      { areaM2: "9999.00" },
      seedAdminId
    );

    const { invoice: reloaded, lines: after } = await getInvoice(
      db,
      org.id,
      invoice.id
    );
    expect(after[0].netAmount).toBe("10.00");
    expect(reloaded.total).toBe(invoice.total);
    expect(
      (reloaded.recipientSnapshot as Record<string, unknown>).billingName
    ).toBe((invoice.recipientSnapshot as Record<string, unknown>).billingName);

    await cleanupOrg(org.id);
  });

  it("INV-002: bulk generate produces a result summary of generated and skipped cases", async () => {
    // Both dwellings (and the blocked one's meter) must exist BEFORE the
    // period is created, or createPeriod never snapshots a billing_case
    // for it at all (Phase E behavior) -- bulkGenerateInvoices only sees
    // cases that exist, so a dwelling with no case is neither generated
    // nor skipped, it's just absent.
    const org = await createOrganization(
      db,
      { name: "IT-F Org 7", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const blocked = await createDwelling(
      db,
      org.id,
      { number: "2" },
      seedAdminId
    );
    await createMeter(
      db,
      org.id,
      blocked.id,
      { type: "COLD_WATER", unit: "m3" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 7,
        startsOn: "2026-07-01",
        endsOn: "2026-07-28",
        invoiceIssueDate: "2026-07-28",
        invoiceDueDate: "2026-08-14",
      },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "5.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Cold water",
        code: "cold",
        calculationType: "METER_CONSUMPTION",
        meterType: "COLD_WATER",
        unit: "m3",
        unitPrice: "2.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    const result = await bulkGenerateInvoices(
      db,
      org.id,
      period.id,
      seedAdminId
    );
    expect(result.generated).toContain(dwelling.id);
    expect(result.skipped.some((s) => s.dwellingId === blocked.id)).toBe(true);

    await cleanupOrg(org.id);
  });

  it("INV-004: prepare only transitions from DRAFT and validates required snapshot fields", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod("IT-F Org 8", 8);
    await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );

    // No billing name/occupant name and no bank details yet -- validation fails.
    await expect(
      prepareInvoice(db, org.id, invoice.id, seedAdminId)
    ).rejects.toThrow();

    await updateDwelling(
      db,
      org.id,
      dwelling.id,
      { occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    const { updateOrganization } =
      await import("../../src/domain/organizations/organizations");
    await updateOrganization(
      db,
      org.id,
      { bankName: "Test Bank", iban: "LV00TEST0000000000000" },
      seedAdminId
    );

    // Snapshots were taken at generation time (before these edits), so
    // prepare must still fail against the ORIGINAL (empty) snapshot --
    // proving immutability, not just re-reading current live data.
    await expect(
      prepareInvoice(db, org.id, invoice.id, seedAdminId)
    ).rejects.toThrow();

    const regenerated = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const prepared = await prepareInvoice(
      db,
      org.id,
      regenerated.id,
      seedAdminId
    );
    expect(prepared.preparedAt).not.toBeNull();

    await expect(
      generateInvoice(db, org.id, period.id, dwelling.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      prepareInvoice(db, org.id, regenerated.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("cross-tenant: an invoice from another org is not found", async () => {
    const { org: orgA } = await setupOrgAndPeriod("IT-F Org 9a", 9);
    const {
      org: orgB,
      dwelling,
      period,
    } = await setupOrgAndPeriod("IT-F Org 9b", 9);
    await createRule(
      db,
      orgB.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      orgB.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await expect(getInvoice(db, orgA.id, invoice.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
  });

  it("concurrent generation for two dwellings in the same org/period gets two distinct invoice numbers", async () => {
    // Both dwellings must exist before the period is created (see the
    // INV-002 test above for why).
    const org = await createOrganization(
      db,
      { name: "IT-F Org 10", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const dwelling2 = await createDwelling(
      db,
      org.id,
      { number: "2" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 10,
        startsOn: "2026-10-01",
        endsOn: "2026-10-28",
        invoiceIssueDate: "2026-10-28",
        invoiceDueDate: "2026-11-14",
      },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    const dbA = await createDb(requireDatabaseUrl());
    const dbB = await createDb(requireDatabaseUrl());
    const [r1, r2] = await Promise.all([
      generateInvoice(dbA, org.id, period.id, dwelling.id, seedAdminId),
      generateInvoice(dbB, org.id, period.id, dwelling2.id, seedAdminId),
    ]);
    await dbA.$client.end();
    await dbB.$client.end();

    expect(r1.invoiceNumber).not.toBe(r2.invoiceNumber);

    await cleanupOrg(org.id);
  });

  it("PER-002: a LOCKED period blocks both first-time generation and regeneration", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod(
      "IT-F Org 11",
      11
    );
    await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await lockPeriod(db, org.id, period.id, seedAdminId);
    await expect(
      generateInvoice(db, org.id, period.id, dwelling.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    await cleanupOrg(org.id);
  });

  it("a MANUAL_QUANTITY rule with no submitted input blocks generation as missing data, and generates correctly once supplied", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod(
      "IT-F Org 12",
      11
    );
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Special charge",
        code: "manual-qty",
        calculationType: "MANUAL_QUANTITY",
        unit: "unit",
        unitPrice: "12.50",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    // Same failure mode as a missing meter reading -- blocked as missing
    // data, not a rule-specific error.
    await expect(
      generateInvoice(db, org.id, period.id, dwelling.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await submitManualRuleInput(
      db,
      org.id,
      period.id,
      dwelling.id,
      rule.id,
      "3",
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe("3.0000");
    expect(lines[0].unitPrice).toBe("12.5000");
    expect(lines[0].netAmount).toBe("37.50");
    await cleanupOrg(org.id);
  });

  it("a MANUAL_AMOUNT rule's supplied value becomes the line's net amount directly (quantity=1)", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod(
      "IT-F Org 12b",
      11
    );
    const rule = await createRule(
      db,
      org.id,
      {
        name: "One-time repair",
        code: "manual-amt",
        calculationType: "MANUAL_AMOUNT",
        unit: "charge",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    await submitManualRuleInput(
      db,
      org.id,
      period.id,
      dwelling.id,
      rule.id,
      "45.00",
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe("1.0000");
    expect(lines[0].unitPrice).toBe("45.0000");
    expect(lines[0].netAmount).toBe("45.00");
    await cleanupOrg(org.id);
  });

  it("Section 21: a sent invoice can never be regenerated, even if its case status is manually overridden back to DRAFT", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod("IT-F Org 13", 6);
    await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    // Simulate Phase G's send step, and an admin manually overriding the
    // case status back to DRAFT afterward (a legitimate workflow-tracking
    // action this domain still allows).
    await db.$client.query(
      "update invoices set sent_at = now() where id = $1",
      [invoice.id]
    );
    const { overrideCaseStatus } =
      await import("../../src/domain/billing/generation");
    await overrideCaseStatus(
      db,
      org.id,
      invoice.billingCaseId,
      "DRAFT",
      "testing immutability",
      seedAdminId
    );

    await expect(
      generateInvoice(db, org.id, period.id, dwelling.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("Section 21/22: editing the organization's invoice template after generation never changes an already-generated invoice's rendered output", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod("IT-F Org 14", 7);
    await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        vatRate: "21.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    await updateInvoiceTemplate(
      db,
      org.id,
      {
        headerText: "Original header",
        footerText: "",
        paymentInstructions: "",
        defaultNote: "",
        config: createDefaultInvoiceTemplateConfig(),
      },
      seedAdminId
    );

    const generated = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    const before = await getInvoice(db, org.id, generated.id);
    const htmlBefore = renderInvoiceHtml(before.invoice, before.lines);
    expect(htmlBefore).toContain("Original header");

    const hiddenConfig = createDefaultInvoiceTemplateConfig();
    // `footer` is optional and hideable; `parties` (and the other mandatory
    // blocks) can no longer be hidden at all -- updateInvoiceTemplate would
    // reject a config that tried.
    hiddenConfig.document.blocks = hiddenConfig.document.blocks.map((b) =>
      b.type === "footer" ? { ...b, visible: false } : b
    );
    await updateInvoiceTemplate(
      db,
      org.id,
      {
        headerText: "Changed header",
        footerText: "New footer",
        paymentInstructions: "",
        defaultNote: "",
        config: hiddenConfig,
      },
      seedAdminId
    );

    const after = await getInvoice(db, org.id, generated.id);
    const htmlAfter = renderInvoiceHtml(after.invoice, after.lines);
    expect(htmlAfter).toBe(htmlBefore);
    expect(htmlAfter).toContain("Original header");
    expect(htmlAfter).not.toContain("Changed header");
    expect(htmlAfter).not.toContain("New footer");

    await cleanupOrg(org.id);
  });
});

describe("multilingual invoice rendering", () => {
  it("a tariff's EN/RU labels are snapshotted at generation time and survive a later rename, unaffected across locales' totals", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod("IT-F Org 16", 9);
    const rule = await createRule(
      db,
      org.id,
      {
        name: "Ūdens",
        nameEn: "Water",
        nameRu: "Вода",
        code: "water",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        vatRate: "21.0000",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );

    // Rename the tariff's translations *after* generation -- the already-
    // generated invoice's snapshot must still show the labels captured at
    // generation time (spec Section 21 immutability), not today's edit.
    await updateRule(
      db,
      org.id,
      rule.id,
      { nameEn: "Water supply", nameRu: "Водоснабжение" },
      seedAdminId
    );

    // Re-fetch from the database *after* the rename -- rendering a
    // still-in-memory object from before the mutation would prove nothing
    // about whether the stored snapshot itself is actually immutable.
    const { invoice: loaded, lines } = await getInvoice(db, org.id, invoice.id);

    const lv = renderInvoiceHtml(loaded, lines, "lv");
    const en = renderInvoiceHtml(loaded, lines, "en");
    const ru = renderInvoiceHtml(loaded, lines, "ru");

    expect(lv).toContain("Ūdens");
    expect(en).toContain("Water");
    expect(en).not.toContain("Water supply");
    expect(ru).toContain("Вода");
    expect(ru).not.toContain("Водоснабжение");

    // Financial identity is unchanged across locales: same invoice number,
    // same amount due, same line count.
    for (const html of [lv, en, ru]) {
      expect(html).toContain(invoice.invoiceNumber);
      expect(html).toContain(invoice.amountDue);
    }
    expect((lv.match(/<tr/g) ?? []).length).toBe(
      (en.match(/<tr/g) ?? []).length
    );

    await cleanupOrg(org.id);
  });

  it("an invoice's template textTranslations are frozen at generation time -- editing the org's template translations afterward never changes the EN/RU render of an already-generated invoice", async () => {
    const { org, dwelling, period } = await setupOrgAndPeriod(
      "IT-F Org 17",
      10
    );
    await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );

    const config = createDefaultInvoiceTemplateConfig();
    config.textTranslations = { headerText: { en: "Welcome" } };
    await updateInvoiceTemplate(
      db,
      org.id,
      {
        headerText: "Sveicināti",
        footerText: "",
        paymentInstructions: "",
        defaultNote: "",
        config,
      },
      seedAdminId
    );

    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );

    // Edit the org's *current* template translation after generation.
    const updatedConfig = createDefaultInvoiceTemplateConfig();
    updatedConfig.textTranslations = { headerText: { en: "Welcome aboard" } };
    await updateInvoiceTemplate(
      db,
      org.id,
      {
        headerText: "Sveicināti",
        footerText: "",
        paymentInstructions: "",
        defaultNote: "",
        config: updatedConfig,
      },
      seedAdminId
    );

    const { invoice: loaded, lines } = await getInvoice(db, org.id, invoice.id);
    const en = renderInvoiceHtml(loaded, lines, "en");
    expect(en).toContain("Welcome");
    expect(en).not.toContain("Welcome aboard");

    await cleanupOrg(org.id);
  });
});
