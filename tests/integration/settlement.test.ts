// ADR 0016 end to end: money covers invoices oldest first by their own
// amount, and the next invoice charges the late days once, on own amounts.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { billingCases } from "../../src/db/schema/billing";
import { invoices } from "../../src/db/schema/invoices";
import { createLateFeePolicy } from "../../src/domain/accounts/settings";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { recordDwellingPayment } from "../../src/domain/payments/direct";
import { recordManualPayment } from "../../src/domain/payments/manual";
import { reversePayment } from "../../src/domain/payments/reversal";
import { createPeriod } from "../../src/domain/periods/periods";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-settlement-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

async function setup(name: string) {
  const org = await createOrganization(
    db,
    {
      name,
      addressLine1: "1 Main St",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    adminId
  );
  const dwelling = await createDwelling(
    db,
    org.id,
    { number: "1", occupantName: "Jane Doe", billingAddress: "1 Test St" },
    adminId
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
    adminId
  );
  // 0.5% a day from the day after the due date, capped at 10%.
  await createLateFeePolicy(db, {
    organizationId: org.id,
    effectiveFrom: "2025-01-01",
    enabled: true,
    dailyRate: "0.5000",
    graceDays: 0,
    maxPenaltyPercent: "10.00",
    stopsAtCap: true,
    actorUserId: adminId,
  });
  const invoice = async (month: number, issue: string, due: string) => {
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month,
        startsOn: `2026-0${month}-01`,
        endsOn: `2026-0${month}-28`,
        invoiceIssueDate: issue,
        invoiceDueDate: due,
      },
      adminId
    );
    const generated = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      adminId
    );
    return prepareInvoice(db, org.id, generated.id, adminId);
  };
  return { org, dwelling, invoice };
}

async function state(invoiceId: string) {
  const [row] = await db
    .select({ paidAt: invoices.paidAt, status: billingCases.status })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(eq(invoices.id, invoiceId));
  return { paid: row.paidAt !== null, status: row.status };
}

describe("payments cover invoices oldest first (ADR 0016)", () => {
  it("a payment of the newer invoice's total pays both; a reversal unpays both", async () => {
    const { org, invoice } = await setup("IT-Settle 1");
    try {
      const jan = await invoice(1, "2026-01-31", "2026-02-10");
      const feb = await invoice(2, "2026-02-28", "2026-03-10");
      // 100 + January's 100 + January's 9.00 late fee.
      expect(feb.amountDue).toBe("209.00");

      const match = await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: feb.id,
          amount: "209.00",
          bookingDate: "2026-03-05",
          reference: "FEB",
          reason: "Transfer",
        },
        adminId
      );
      expect(await state(jan.id)).toEqual({ paid: true, status: "PAID" });
      expect(await state(feb.id)).toEqual({ paid: true, status: "PAID" });

      await reversePayment(db, org.id, match.id, "Bounced", adminId);
      // Never sent, so both go back to Prepared.
      expect(await state(jan.id)).toEqual({ paid: false, status: "PREPARED" });
      expect(await state(feb.id)).toEqual({ paid: false, status: "PREPARED" });
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("a payment named for the newer invoice covers the older one first", async () => {
    const { org, invoice } = await setup("IT-Settle 2");
    try {
      const jan = await invoice(1, "2026-01-31", "2026-02-10");
      const feb = await invoice(2, "2026-02-28", "2026-03-10");
      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: feb.id,
          amount: "100.00",
          bookingDate: "2026-03-05",
          reference: "FEB",
          reason: "Transfer",
        },
        adminId
      );
      expect((await state(jan.id)).paid).toBe(true);
      expect((await state(feb.id)).paid).toBe(false);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("the next invoice charges the late days once, on own amounts only", async () => {
    const { org, invoice } = await setup("IT-Settle 3");
    try {
      // January is due Feb 10 and late Feb 11 - Feb 28 on the February
      // invoice: 100 x 0.5% x 18 = 9.00.
      await invoice(1, "2026-01-31", "2026-02-10");
      const feb = await invoice(2, "2026-02-28", "2026-03-10");
      expect(feb.lateFeeApplied).toBe("9.00");

      // January paid on Mar 5. March charges its Mar 1 - Mar 4 days once
      // (100 x 0.5% x 4 = 2.00, total 11.00 capped at 10.00, so 1.00), and
      // February's own 100 (not its 9.00 fee) for Mar 11 - Mar 31: 21 days
      // = 10.50, capped at 10.00.
      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: feb.id,
          amount: "100.00",
          bookingDate: "2026-03-05",
          reference: "JAN",
          reason: "Transfer",
        },
        adminId
      );
      const mar = await invoice(3, "2026-03-31", "2026-04-10");
      expect(mar.lateFeeApplied).toBe("11.00");
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("an invoice a credit already covers is Paid when it is prepared", async () => {
    const { org, dwelling, invoice } = await setup("IT-Settle 4");
    try {
      await recordDwellingPayment(
        db,
        org.id,
        {
          dwellingId: dwelling.id,
          amount: "150.00",
          bookingDate: "2026-01-10",
          method: "BANK",
          payerName: "Jane Doe",
          reference: "ADVANCE",
          reason: "Advance payment",
        },
        adminId
      );
      const jan = await invoice(1, "2026-01-31", "2026-02-10");
      expect(jan.amountDue).toBe("0.00");
      expect(jan.paidAt).not.toBeNull();
      expect(await state(jan.id)).toEqual({ paid: true, status: "PAID" });
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });
});
