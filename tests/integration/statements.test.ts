// Domain-layer integration tests for src/domain/accounts/statements.ts
// (resolveStatementFinancials, buildBalanceSnapshot, buildPenaltySnapshot).
// Requires a real Postgres reachable via DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createPeriod } from "../../src/domain/periods/periods";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import { createLateFeePolicy } from "../../src/domain/accounts/settings";
import { createDwellingAccountAdjustment } from "../../src/domain/accounts/adjustments";
import {
  buildBalanceSnapshot,
  buildPenaltySnapshot,
  resolveStatementFinancials,
} from "../../src/domain/accounts/statements";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-statements-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

describe("statement financials and snapshots", () => {
  it("no prior balance, no policy: amountDue equals currentCharges + manualAdjustment (never below 0.00), previousOutstanding is 0.00", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Stmt Org 1",
        addressLine1: "1 Main St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "101", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );

    const financials = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "100.00",
      manualAdjustment: "15.00",
    });

    expect(financials.accountBalance).toBe("0.00");
    expect(financials.policy).toBeNull();
    expect(financials.oldestUnpaid).toBeUndefined();
    expect(financials.balance.previousOutstanding).toBe("0.00");
    expect(financials.balance.previousCreditApplied).toBe("0.00");
    expect(financials.balance.lateFee).toBe("0.00");
    expect(financials.balance.manualAdjustment).toBe("15.00");
    expect(financials.balance.currentCharges).toBe("100.00");
    expect(financials.balance.amountDue).toBe("115.00");
    expect(financials.balance.remainingCredit).toBe("0.00");

    await cleanupOrg(org.id);
  });

  it("dwelling with a prior unpaid invoice: previousOutstanding reflects it and oldestUnpaid is that invoice", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Stmt Org 2",
        addressLine1: "2 Main St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "201", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Maintenance",
        code: "maint",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "85.00",
        effectiveFrom: "2026-01-01",
      },
      seedAdminId
    );
    const period1 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        invoiceIssueDate: "2026-01-31",
        invoiceDueDate: "2026-02-14",
      },
      seedAdminId
    );
    const invoice1 = await generateInvoice(
      db,
      org.id,
      period1.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice1.id, seedAdminId);

    const financials = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "100.00",
      manualAdjustment: "0.00",
    });

    expect(financials.oldestUnpaid).toBeDefined();
    expect(financials.oldestUnpaid?.invoiceNumber).toBe(invoice1.invoiceNumber);
    expect(financials.oldestUnpaid?.dueDate).toBe("2026-02-14");
    expect(financials.accountBalance).toBe("85.00");
    expect(financials.balance.previousOutstanding).toBe("85.00");
    expect(financials.balance.amountDue).toBe("185.00");
    expect(financials.balance.previousCreditApplied).toBe("0.00");
    expect(financials.balance.remainingCredit).toBe("0.00");

    await cleanupOrg(org.id);
  });

  it("multiple prior unpaid invoices: oldestUnpaid identifies the earliest overdue invoice and previousOutstanding aggregates unpaid charges", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Stmt Org 3",
        addressLine1: "3 Main St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "301", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Maintenance",
        code: "maint",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "50.00",
        effectiveFrom: "2026-01-01",
      },
      seedAdminId
    );
    const period1 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        invoiceIssueDate: "2026-01-31",
        invoiceDueDate: "2026-02-14",
      },
      seedAdminId
    );
    const invoice1 = await generateInvoice(
      db,
      org.id,
      period1.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice1.id, seedAdminId);

    const period2 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 2,
        startsOn: "2026-02-01",
        endsOn: "2026-02-28",
        invoiceIssueDate: "2026-02-28",
        invoiceDueDate: "2026-03-14",
      },
      seedAdminId
    );
    const invoice2 = await generateInvoice(
      db,
      org.id,
      period2.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice2.id, seedAdminId);

    const financials = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "60.00",
      manualAdjustment: "0.00",
    });

    expect(financials.oldestUnpaid?.invoiceNumber).toBe(invoice1.invoiceNumber);
    expect(financials.oldestUnpaid?.dueDate).toBe("2026-02-14");
    expect(financials.accountBalance).toBe("100.00");
    expect(financials.balance.previousOutstanding).toBe("100.00");
    expect(financials.balance.amountDue).toBe("160.00");

    await cleanupOrg(org.id);
  });

  it("dwelling with credit (overpayment or credit adjustment): previousCreditApplied reduces amountDue and remainingCredit shows the unused part; amountDue never goes negative", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Stmt Org 4",
        addressLine1: "4 Main St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "401", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );

    await createDwellingAccountAdjustment(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      amount: "150.00",
      direction: "CREDIT",
      effectiveDate: "2026-03-01",
      reason: "Prepayment credit",
      actorUserId: seedAdminId,
    });

    // Credit exceeds current charges: amountDue reaches 0.00 and unused part remains
    const financials = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "100.00",
      manualAdjustment: "0.00",
    });

    expect(financials.accountBalance).toBe("-150.00");
    expect(financials.balance.previousOutstanding).toBe("0.00");
    expect(financials.balance.previousCreditApplied).toBe("100.00");
    expect(financials.balance.amountDue).toBe("0.00");
    expect(financials.balance.remainingCredit).toBe("50.00");

    // Partial credit application: current charges exceed available credit
    const partialFinancials = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "200.00",
      manualAdjustment: "0.00",
    });

    expect(partialFinancials.balance.previousCreditApplied).toBe("150.00");
    expect(partialFinancials.balance.amountDue).toBe("50.00");
    expect(partialFinancials.balance.remainingCredit).toBe("0.00");

    await cleanupOrg(org.id);
  });

  it("a negative manualAdjustment lowers amountDue, and a large negative one is clamped at 0.00", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Stmt Org 5",
        addressLine1: "5 Main St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "501", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );

    // Negative adjustment lowering amountDue
    const finReduced = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "100.00",
      manualAdjustment: "-35.00",
    });
    expect(finReduced.balance.amountDue).toBe("65.00");
    expect(finReduced.balance.remainingCredit).toBe("0.00");

    // Large negative adjustment clamped at 0.00
    const finClamped = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "100.00",
      manualAdjustment: "-140.00",
    });
    expect(finClamped.balance.amountDue).toBe("0.00");
    expect(finClamped.balance.remainingCredit).toBe("40.00");

    await cleanupOrg(org.id);
  });

  it("late fee enabled and the prior invoice overdue: lateFee.appliedAmount is greater than 0.00, and it is capped by maxPenaltyPercent when the daily rate would exceed the cap (stopsAtCap true)", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Stmt Org 6",
        addressLine1: "6 Main St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "601", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Maintenance",
        code: "maint",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "100.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const period1 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        invoiceIssueDate: "2026-01-31",
        invoiceDueDate: "2026-02-14",
      },
      seedAdminId
    );
    const invoice1 = await generateInvoice(
      db,
      org.id,
      period1.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice1.id, seedAdminId);

    await createLateFeePolicy(db, {
      organizationId: org.id,
      effectiveFrom: "2025-01-01",
      enabled: true,
      dailyRate: "0.5000",
      graceDays: 5,
      maxPenaltyPercent: "10.00",
      stopsAtCap: true,
      actorUserId: seedAdminId,
    });

    // 1. Moderate overdue where rawAmount < capAmount:
    // dueDate = 2026-02-14, graceDays = 5, firstPenaltyDate = 2026-02-20.
    // issueDate = 2026-02-22 -> 3 overdue days (Feb 20, 21, 22).
    // rawAmount = 100.00 * 0.5% * 3 = 1.50. capAmount = 10.00.
    const finModerate = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-02-22",
      currentCharges: "100.00",
      manualAdjustment: "0.00",
    });
    expect(finModerate.lateFee.appliedAmount).toBe("1.50");
    expect(finModerate.lateFee.rawAmount).toBe("1.50");
    expect(finModerate.lateFee.capAmount).toBe("10.00");
    expect(Number(finModerate.lateFee.appliedAmount)).toBeGreaterThan(0);

    // 2. Extended overdue where daily rate accrual exceeds cap:
    // issueDate = 2026-03-31 -> 40 overdue days (9 in Feb + 31 in Mar).
    // rawAmount = 100.00 * 0.5% * 40 = 20.00.
    // Cap is 10.00, stopsAtCap is true -> appliedAmount capped at 10.00.
    const finCapped = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "100.00",
      manualAdjustment: "0.00",
    });
    expect(finCapped.lateFee.rawAmount).toBe("20.00");
    expect(finCapped.lateFee.capAmount).toBe("10.00");
    expect(finCapped.lateFee.appliedAmount).toBe("10.00");
    expect(finCapped.lateFee.stopsAtCap).toBe(true);
    expect(finCapped.balance.lateFee).toBe("10.00");
    expect(finCapped.balance.amountDue).toBe("210.00"); // 100.00 current + 100.00 prev + 10.00 late fee

    await cleanupOrg(org.id);
  });

  it("buildBalanceSnapshot and buildPenaltySnapshot return the documented keys with values that match the financials they were built from", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-Stmt Org 7",
        addressLine1: "7 Main St",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "701", occupantName: "Jane Doe", billingAddress: "1 Test St" },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Rent",
        code: "rent",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "200.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const period1 = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        invoiceIssueDate: "2026-01-31",
        invoiceDueDate: "2026-02-14",
      },
      seedAdminId
    );
    const invoice1 = await generateInvoice(
      db,
      org.id,
      period1.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice1.id, seedAdminId);

    const policy = await createLateFeePolicy(db, {
      organizationId: org.id,
      effectiveFrom: "2025-01-01",
      enabled: true,
      dailyRate: "0.1000",
      graceDays: 0,
      maxPenaltyPercent: "15.00",
      stopsAtCap: true,
      actorUserId: seedAdminId,
    });

    const financials = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2026-03-31",
      currentCharges: "150.00",
      manualAdjustment: "10.00",
    });

    const balanceSnapshot = buildBalanceSnapshot(financials);
    expect(balanceSnapshot).toEqual({
      accountBalance: "200.00",
      previousOutstanding: "200.00",
      previousCreditApplied: "0.00",
      remainingCredit: "0.00",
      sourceInvoice: invoice1.invoiceNumber,
    });

    const penaltySnapshot = buildPenaltySnapshot(financials);
    expect(penaltySnapshot).toEqual({
      policyId: policy.id,
      enabled: true,
      dailyRate: "0.100000",
      graceDays: 0,
      maxPenaltyPercent: "15.0000",
      stopsAtCap: true,
      eligiblePrincipal: "200.00",
      firstPenaltyDate: "2026-02-15",
      overdueDays: 45,
      rawAmount: "9.00", // 200 * 0.1% * 45 = 9.00
      capAmount: "30.00", // 200 * 15% = 30.00
    });

    // Also verify when policy is absent
    const noPolicyFinancials = await resolveStatementFinancials(db, {
      organizationId: org.id,
      dwellingId: dwelling.id,
      currency: "EUR",
      issueDate: "2020-01-01",
      currentCharges: "150.00",
      manualAdjustment: "0.00",
    });
    const noPolicySnapshot = buildPenaltySnapshot(noPolicyFinancials);
    expect(noPolicySnapshot.policyId).toBeNull();
    expect(noPolicySnapshot.enabled).toBe(false);
    expect(noPolicySnapshot.firstPenaltyDate).toBeNull();
    expect(noPolicySnapshot.overdueDays).toBe(0);
    expect(noPolicySnapshot.rawAmount).toBe("0.00");

    await cleanupOrg(org.id);
  });
});
