// Phase J (Payments) - Manual payment entry and matching (ADR 0006, Scope Q).
// Requires a real Postgres reachable via DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/client";
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
import { auditLogs } from "../../src/db/schema/audit";
import { billingCases } from "../../src/db/schema/billing";
import { invoices } from "../../src/db/schema/invoices";
import { bankTransactions, paymentMatches } from "../../src/db/schema/payments";
import { importBankCsv } from "../../src/domain/payments/bank-import";
import {
  confirmMatch,
  listUnmatchedTransactions,
  proposeExactMatches,
} from "../../src/domain/payments/matching";
import {
  listOpenInvoicesForPayment,
  matchTransactionToInvoice,
  recordManualPayment,
} from "../../src/domain/payments/manual";
import { reversePayment } from "../../src/domain/payments/reversal";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../src/domain/errors";
import { addExact, subtractExact } from "../../src/lib/decimal2";
import {
  getDwellingAccountBalance,
  getInvoiceAllocatedAmount,
} from "../../src/domain/accounts/ledger";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-manual-payment-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

async function setupOrgWithInvoice(name: string, month: number) {
  const org = await createOrganization(
    db,
    {
      name,
      addressLine1: "Addr 1",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    seedAdminId
  );
  const dwelling = await createDwelling(
    db,
    org.id,
    { number: "1", occupantName: "Jane Doe", billingAddress: "1 Test St" },
    seedAdminId
  );
  const period = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month,
      startsOn: `2026-${String(month).padStart(2, "0")}-01`,
      endsOn: `2026-${String(month).padStart(2, "0")}-28`,
      invoiceIssueDate: `2026-${String(month).padStart(2, "0")}-28`,
      invoiceDueDate: `2026-${String(Math.min(month + 1, 12)).padStart(2, "0")}-14`,
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
      unitPrice: "50.00",
      effectiveFrom: "2025-01-01",
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
  const invoice = await prepareInvoice(db, org.id, generated.id, seedAdminId);
  return { org, dwelling, period, invoice };
}

describe("Manual payment entry and matching (Scope Q)", () => {
  it("records a manual payment with exact remaining amount, marking invoice and case PAID", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-Manual-A", 1);
    try {
      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: invoice.id,
          amount: invoice.amountDue,
          bookingDate: "2026-01-20",
          payerName: "Jane Doe",
          reference: "INV-001-MANUAL",
          reason: "Direct bank transfer",
        },
        seedAdminId
      );

      const [updatedInvoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoice.id));
      expect(updatedInvoice.paidAt).not.toBeNull();

      const [updatedCase] = await db
        .select()
        .from(billingCases)
        .where(eq(billingCases.id, invoice.billingCaseId));
      expect(updatedCase.status).toBe("PAID");

      const [txn] = await db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.organizationId, org.id));
      expect(
        (txn.rawData as { source?: string; reason?: string })?.source
      ).toBe("manual");
      expect(
        (txn.rawData as { source?: string; reason?: string })?.reason
      ).toBe("Direct bank transfer");

      const [match] = await db
        .select()
        .from(paymentMatches)
        .where(eq(paymentMatches.organizationId, org.id));
      expect(match.status).toBe("CONFIRMED");
      expect(match.matchType).toBe("MANUAL");

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, org.id));
      const actions = auditRows.map((r) => r.action);
      expect(actions).toContain("MANUAL_PAYMENT_RECORDED");
      expect(actions).toContain("PAYMENT_MATCH_CONFIRMED");
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("leaves invoice open after a partial manual payment, and second payment pays the rest", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-Manual-B", 1);
    try {
      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: invoice.id,
          amount: "20.00",
          bookingDate: "2026-01-20",
          reference: "INV-PART-1",
          reason: "Part 1",
        },
        seedAdminId
      );

      const [invoiceAfterPart1] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoice.id));
      expect(invoiceAfterPart1.paidAt).toBeNull();

      const [caseAfterPart1] = await db
        .select()
        .from(billingCases)
        .where(eq(billingCases.id, invoice.billingCaseId));
      expect(caseAfterPart1.status).not.toBe("PAID");

      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: invoice.id,
          amount: "30.00",
          bookingDate: "2026-01-21",
          reference: "INV-PART-2",
          reason: "Part 2",
        },
        seedAdminId
      );

      const [invoiceAfterPart2] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoice.id));
      expect(invoiceAfterPart2.paidAt).not.toBeNull();

      const [caseAfterPart2] = await db
        .select()
        .from(billingCases)
        .where(eq(billingCases.id, invoice.billingCaseId));
      expect(caseAfterPart2.status).toBe("PAID");
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("rejects duplicate payment with same reference (case and spaces), amount, and date", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-Manual-C", 1);
    try {
      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: invoice.id,
          amount: "25.00",
          bookingDate: "2026-01-20",
          reference: "Ref-123",
          reason: "First attempt",
        },
        seedAdminId
      );

      const txnCountBefore = (
        await db
          .select()
          .from(bankTransactions)
          .where(eq(bankTransactions.organizationId, org.id))
      ).length;

      await expect(
        recordManualPayment(
          db,
          org.id,
          {
            invoiceId: invoice.id,
            amount: "25.00",
            bookingDate: "2026-01-20",
            reference: "  ref-123  ",
            reason: "Duplicate attempt",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ConflictError);

      const txnCountAfter = (
        await db
          .select()
          .from(bankTransactions)
          .where(eq(bankTransactions.organizationId, org.id))
      ).length;
      expect(txnCountAfter).toBe(txnCountBefore);
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("validates input: amount, reference, reason, booking date in future", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-Manual-D", 1);
    try {
      await expect(
        recordManualPayment(
          db,
          org.id,
          {
            invoiceId: invoice.id,
            amount: "0",
            bookingDate: "2026-01-20",
            reference: "REF-1",
            reason: "Valid reason",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordManualPayment(
          db,
          org.id,
          {
            invoiceId: invoice.id,
            amount: "abc",
            bookingDate: "2026-01-20",
            reference: "REF-1",
            reason: "Valid reason",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordManualPayment(
          db,
          org.id,
          {
            invoiceId: invoice.id,
            amount: "1.234",
            bookingDate: "2026-01-20",
            reference: "REF-1",
            reason: "Valid reason",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordManualPayment(
          db,
          org.id,
          {
            invoiceId: invoice.id,
            amount: "10.00",
            bookingDate: "2026-01-20",
            reference: "   ",
            reason: "Valid reason",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordManualPayment(
          db,
          org.id,
          {
            invoiceId: invoice.id,
            amount: "10.00",
            bookingDate: "2026-01-20",
            reference: "REF-1",
            reason: "   ",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordManualPayment(
          db,
          org.id,
          {
            invoiceId: invoice.id,
            amount: "10.00",
            bookingDate: "2099-01-01",
            reference: "REF-1",
            reason: "Valid reason",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("rejects wrong-organization invoice id with NotFoundError and DRAFT invoice with ConflictError", async () => {
    const { org, dwelling, invoice } = await setupOrgWithInvoice(
      "IT-Manual-E",
      1
    );
    const otherOrg = await createOrganization(
      db,
      { name: "IT-Manual-E-Other", addressLine1: "Addr 2" },
      seedAdminId
    );
    try {
      await expect(
        recordManualPayment(
          db,
          otherOrg.id,
          {
            invoiceId: invoice.id,
            amount: "50.00",
            bookingDate: "2026-01-20",
            reference: "REF-WRONG-ORG",
            reason: "Reason",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(NotFoundError);

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
      const draftInvoice = await generateInvoice(
        db,
        org.id,
        period2.id,
        dwelling.id,
        seedAdminId
      );

      await expect(
        recordManualPayment(
          db,
          org.id,
          {
            invoiceId: draftInvoice.id,
            amount: "50.00",
            bookingDate: "2026-01-20",
            reference: "REF-DRAFT",
            reason: "Reason",
          },
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await cleanupOrg(org.id);
      await cleanupOrg(otherOrg.id);
    }
  });

  it("matches an unmatched transaction to an invoice, and rejects matching it again", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-Manual-F", 1);
    try {
      const csv = [
        "booking_date,amount,currency,reference",
        `2026-01-20,${invoice.amountDue},${invoice.currency},UNMATCHED-REF-99999`,
      ].join("\n");
      const importResult = await importBankCsv(
        db,
        org.id,
        "unmatched.csv",
        csv,
        seedAdminId
      );

      await proposeExactMatches(
        db,
        org.id,
        importResult.bankImport.id,
        seedAdminId
      );

      const unmatched = await listUnmatchedTransactions(db, org.id);
      expect(unmatched.length).toBe(1);
      const transactionId = unmatched[0].id;

      await matchTransactionToInvoice(
        db,
        org.id,
        transactionId,
        invoice.id,
        seedAdminId
      );

      const [paidInvoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoice.id));
      expect(paidInvoice.paidAt).not.toBeNull();

      const [paidCase] = await db
        .select()
        .from(billingCases)
        .where(eq(billingCases.id, invoice.billingCaseId));
      expect(paidCase.status).toBe("PAID");

      await expect(
        matchTransactionToInvoice(
          db,
          org.id,
          transactionId,
          invoice.id,
          seedAdminId
        )
      ).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("handles reversal then re-match to a different invoice, enforces reversed-from-this-invoice rule, and maintains dwelling ledger balance", async () => {
    const {
      org,
      dwelling,
      invoice: invoiceA,
    } = await setupOrgWithInvoice("IT-Manual-G", 1);
    try {
      const periodB = await createPeriod(
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
      const generatedB = await generateInvoice(
        db,
        org.id,
        periodB.id,
        dwelling.id,
        seedAdminId
      );
      const invoiceB = await prepareInvoice(
        db,
        org.id,
        generatedB.id,
        seedAdminId
      );

      const matchA = await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: invoiceA.id,
          amount: invoiceA.amountDue,
          bookingDate: "2026-01-20",
          reference: "PAY-A",
          reason: "Payment for A",
        },
        seedAdminId
      );
      const transactionId = matchA.bankTransactionId;

      const [paidA] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceA.id));
      expect(paidA.paidAt).not.toBeNull();

      await reversePayment(
        db,
        org.id,
        matchA.id,
        "Paid wrong invoice",
        seedAdminId
      );

      const [unpaidA] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceA.id));
      expect(unpaidA.paidAt).toBeNull();

      await expect(
        matchTransactionToInvoice(
          db,
          org.id,
          transactionId,
          invoiceA.id,
          seedAdminId
        )
      ).rejects.toThrow(
        "This payment was reversed from this invoice. Choose a different invoice"
      );

      await matchTransactionToInvoice(
        db,
        org.id,
        transactionId,
        invoiceB.id,
        seedAdminId
      );

      const [paidB] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceB.id));
      // B carries A's unpaid debt forward, so A's amount only part-pays B.
      expect(paidB.paidAt).toBeNull();
      expect(await getInvoiceAllocatedAmount(db, org.id, invoiceB.id)).toBe(
        matchA.proposedAllocationAmount
      );

      const [stillUnpaidA] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceA.id));
      expect(stillUnpaidA.paidAt).toBeNull();

      const balance = await getDwellingAccountBalance(
        db,
        org.id,
        dwelling.id,
        invoiceA.currency
      );
      const expectedBalance = subtractExact(
        addExact(invoiceA.currentCharges, invoiceB.currentCharges),
        matchA.proposedAllocationAmount
      );
      expect(balance).toBe(expectedBalance);
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("does not apply one bank payment to two invoices", async () => {
    const {
      org,
      dwelling,
      invoice: invoiceA,
    } = await setupOrgWithInvoice("IT-Manual-I", 1);
    try {
      const periodB = await createPeriod(
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
      const generatedB = await generateInvoice(
        db,
        org.id,
        periodB.id,
        dwelling.id,
        seedAdminId
      );
      const invoiceB = await prepareInvoice(
        db,
        org.id,
        generatedB.id,
        seedAdminId
      );
      const first = await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: invoiceA.id,
          amount: "5.00",
          bookingDate: "2026-01-20",
          reference: "PAY-TWICE",
          reason: "First",
        },
        seedAdminId
      );
      const {
        rows: [second],
      } = await db.$client.query(
        `insert into payment_matches (organization_id, bank_transaction_id, invoice_id, match_type, result_type, proposed_allocation_amount, status)
         values ($1, $2, $3, 'MANUAL', 'PARTIAL', '5.00', 'PROPOSED') returning id`,
        [org.id, first.bankTransactionId, invoiceB.id]
      );
      await expect(
        confirmMatch(db, org.id, second.id, seedAdminId)
      ).rejects.toThrow("This payment is already applied to another invoice");
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("creates one payment when two identical manual entries arrive together", async () => {
    const { org, invoice } = await setupOrgWithInvoice("IT-Manual-J", 1);
    const dbA = await createIntegrationDb();
    const dbB = await createIntegrationDb();
    try {
      const input = {
        invoiceId: invoice.id,
        amount: "5.00",
        bookingDate: "2026-01-20",
        reference: "PAY-RACE",
        reason: "Race",
      };
      const results = await Promise.allSettled([
        recordManualPayment(dbA, org.id, input, seedAdminId),
        recordManualPayment(dbB, org.id, input, seedAdminId),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as
        PromiseRejectedResult | undefined;
      expect(rejected?.reason).toBeInstanceOf(ConflictError);
    } finally {
      await dbA.$client.end();
      await dbB.$client.end();
      await cleanupOrg(org.id);
    }
  });
  it("listOpenInvoicesForPayment returns only open invoices with remaining > 0, reflecting partial payments", async () => {
    const {
      org,
      dwelling,
      invoice: inv1,
    } = await setupOrgWithInvoice("IT-Manual-H", 1);
    try {
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
      const gen2 = await generateInvoice(
        db,
        org.id,
        period2.id,
        dwelling.id,
        seedAdminId
      );
      const inv2 = await prepareInvoice(db, org.id, gen2.id, seedAdminId);

      const list1 = await listOpenInvoicesForPayment(db, org.id);
      expect(list1.length).toBe(2);
      const item1 = list1.find((i) => i.id === inv1.id);
      expect(item1?.remaining).toBe(inv1.amountDue);
      expect(item1?.dwellingNumber).toBe(dwelling.number);

      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: inv1.id,
          amount: "20.00",
          bookingDate: "2026-01-20",
          reference: "PARTIAL-1",
          reason: "Partial pay",
        },
        seedAdminId
      );

      const list2 = await listOpenInvoicesForPayment(db, org.id);
      expect(list2.length).toBe(2);
      const item1Partial = list2.find((i) => i.id === inv1.id);
      expect(item1Partial?.remaining).toBe("30.00");

      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: inv1.id,
          amount: "30.00",
          bookingDate: "2026-01-21",
          reference: "PARTIAL-2",
          reason: "Remaining pay",
        },
        seedAdminId
      );

      const list3 = await listOpenInvoicesForPayment(db, org.id);
      expect(list3.length).toBe(1);
      expect(list3[0].id).toBe(inv2.id);
      expect(list3[0].remaining).toBe(inv2.amountDue);
    } finally {
      await cleanupOrg(org.id);
    }
  });
});
