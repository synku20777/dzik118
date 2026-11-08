// The read-only money-flow views: the payment trail, the account ledger and
// the month's payment totals (ADR 0003, 0006). Requires a real Postgres
// reachable via DATABASE_URL.
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
import { accountEntries } from "../../src/db/schema/accounts";
import { bankTransactions } from "../../src/db/schema/payments";
import { NotFoundError } from "../../src/domain/errors";
import {
  matchTransactionToInvoice,
  recordManualPayment,
  updateUnmatchedTransaction,
} from "../../src/domain/payments/manual";
import { listPaymentMatches } from "../../src/domain/payments/matching";
import { reversePayment } from "../../src/domain/payments/reversal";
import {
  getPaymentFlowTotals,
  getPaymentTrail,
  getReceivables,
  listLedgerEntries,
} from "../../src/domain/payments/trail";
import {
  buildPaymentSplit,
  buildTrailEvents,
} from "../../src/domain/payments/trail-view";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-payment-trail-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

const newOrg = (name: string) =>
  createOrganization(
    db,
    {
      name,
      addressLine1: "Addr 1",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    adminId
  );

// A prepared 50.00 invoice.
async function preparedInvoice(orgId: string, dwellingId: string) {
  const period = await createPeriod(
    db,
    orgId,
    {
      year: 2026,
      month: 1,
      startsOn: "2026-01-01",
      endsOn: "2026-01-28",
      invoiceIssueDate: "2026-01-28",
      invoiceDueDate: "2026-02-14",
    },
    adminId
  );
  await createRule(
    db,
    orgId,
    {
      name: "Fee",
      code: "fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "50.00",
      effectiveFrom: "2025-01-01",
    },
    adminId
  );
  const draft = await generateInvoice(
    db,
    orgId,
    period.id,
    dwellingId,
    adminId
  );
  return prepareInvoice(db, orgId, draft.id, adminId);
}

// Prepared 50.00 invoices for several dwellings of one period.
async function preparedInvoices(orgId: string, dwellingIds: string[]) {
  const period = await createPeriod(
    db,
    orgId,
    {
      year: 2026,
      month: 1,
      startsOn: "2026-01-01",
      endsOn: "2026-01-28",
      invoiceIssueDate: "2026-01-28",
      invoiceDueDate: "2026-02-14",
    },
    adminId
  );
  await createRule(
    db,
    orgId,
    {
      name: "Fee",
      code: "fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "50.00",
      effectiveFrom: "2025-01-01",
    },
    adminId
  );
  const out = [];
  for (const dwellingId of dwellingIds) {
    const draft = await generateInvoice(
      db,
      orgId,
      period.id,
      dwellingId,
      adminId
    );
    out.push(await prepareInvoice(db, orgId, draft.id, adminId));
  }
  return out;
}

describe("payment trail and ledger", () => {
  it("tells the whole story of an overpayment, then its reversal", async () => {
    const org = await newOrg("IT-Trail A");
    const other = await newOrg("IT-Trail B");
    try {
      const d = await createDwelling(
        db,
        org.id,
        { number: "7", occupantName: "Jane Doe", billingAddress: "1 Test St" },
        adminId
      );
      const invoice = await preparedInvoice(org.id, d.id);
      expect(await getReceivables(db, org.id, org.currency)).toEqual({
        owed: "50.00",
        dwellingCount: 1,
      });
      const match = await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: invoice.id,
          amount: "60.00",
          bookingDate: "2026-01-20",
          payerName: "Jane Doe",
          reference: "TRAIL-1",
          reason: "Transfer",
        },
        adminId
      );
      const [tx] = await db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.organizationId, org.id));

      // --- the trail after payment
      const trail = await getPaymentTrail(db, org.id, tx.id);
      expect(trail.dwelling?.number).toBe("7");
      expect(trail.allocations).toHaveLength(1);
      expect(trail.allocations[0].amount).toBe("50.00");
      expect(trail.entries).toHaveLength(1);
      const split = buildPaymentSplit(trail);
      expect(split).toMatchObject({
        applied: "50.00",
        credit: "10.00",
        reversed: false,
        posted: true,
      });
      const kinds = buildTrailEvents(trail).map((e) => e.kind);
      expect(kinds[0]).toBe("TYPED_IN");
      expect(kinds).toContain("APPLIED");
      // The confirming admin is on the ledger line, not "unknown".
      const [paymentEntry] = await db
        .select()
        .from(accountEntries)
        .where(eq(accountEntries.bankTransactionId, tx.id));
      expect(paymentEntry.actorUserId).toBe(adminId);

      // An overpaid dwelling is not owed money: credit never offsets another
      // dwelling's debt and never counts as receivable.
      expect(await getReceivables(db, org.id, org.currency)).toEqual({
        owed: "0.00",
        dwellingCount: 0,
      });

      // --- a payment of one building is invisible from another
      await expect(getPaymentTrail(db, other.id, tx.id)).rejects.toThrow(
        NotFoundError
      );
      expect(
        (await listLedgerEntries(db, other.id, { dwellingId: d.id })).entries
      ).toHaveLength(0);

      expect(
        await getPaymentFlowTotals(
          db,
          org.id,
          org.currency,
          "2026-01-01",
          "2026-01-31"
        )
      ).toMatchObject({
        received: "60.00",
        reversed: "0.00",
      });

      // --- reverse it
      await reversePayment(db, org.id, match.id, "Paid twice", adminId);
      expect(await getReceivables(db, org.id, org.currency)).toEqual({
        owed: "50.00",
        dwellingCount: 1,
      });
      const after = await getPaymentTrail(db, org.id, tx.id);
      expect(buildPaymentSplit(after)).toMatchObject({
        reversed: true,
        applied: "0.00",
        credit: "0.00",
      });
      const last = buildTrailEvents(after).at(-1);
      expect(last).toMatchObject({ kind: "REVERSED", reason: "Paid twice" });

      // --- the statement: newest first by effective date, a balance after
      // every line, and a filter never changes a balance. The payment is dated
      // before the invoice, so the balance runs -60, then -10, then 50 once
      // the reversal puts the 60.00 back.
      const statement = await listLedgerEntries(db, org.id, {
        dwellingId: d.id,
        currency: org.currency,
      });
      expect(statement.entries.map((e) => e.type)).toEqual([
        "PAYMENT_REVERSAL",
        "INVOICE_CHARGE",
        "PAYMENT",
      ]);
      expect(statement.entries.map((e) => e.balance)).toEqual([
        "50.00",
        "-10.00",
        "-60.00",
      ]);
      expect(statement.debits).toBe("110.00");
      expect(statement.credits).toBe("60.00");

      const filtered = await listLedgerEntries(db, org.id, {
        dwellingId: d.id,
        types: ["PAYMENT", "PAYMENT_REVERSAL"],
      });
      expect(filtered.entries.map((e) => e.balance)).toEqual([
        "50.00",
        "-60.00",
      ]);
      const limited = await listLedgerEntries(db, org.id, {
        dwellingId: d.id,
        limit: 1,
      });
      expect(limited).toMatchObject({ truncated: true, total: 3 });
      expect(limited.entries).toHaveLength(1);
      // Without a dwelling there is no running balance to mislead.
      const building = await listLedgerEntries(db, org.id);
      expect(building.entries.every((e) => e.balance === null)).toBe(true);

      // --- the month's flow: a payment counts once, at what it is worth now
      const flow = await getPaymentFlowTotals(
        db,
        org.id,
        org.currency,
        "2026-01-01",
        "2026-01-31"
      );
      expect(flow).toMatchObject({
        received: "0.00",
        reversed: "60.00",
      });
      // Correcting the unmatched row afterwards changes its amount, never what
      // the ledger says was posted and reversed.
      await updateUnmatchedTransaction(
        db,
        org.id,
        tx.id,
        {
          amount: "75.00",
          bookingDate: "2026-01-20",
          payerName: "Jane Doe",
          reference: "TRAIL-1",
          reason: "Statement reader dropped a digit",
        },
        adminId
      );
      expect(
        await getPaymentFlowTotals(
          db,
          org.id,
          org.currency,
          "2026-01-01",
          "2026-01-31"
        )
      ).toMatchObject({ received: "0.00", reversed: "60.00" });
      const edited = await getPaymentTrail(db, org.id, tx.id);
      expect(buildPaymentSplit(edited)).toMatchObject({
        reversed: true,
        originalCredit: "10.00",
      });
      expect(
        buildTrailEvents(edited).find((e) => e.kind === "CORRECTED")?.changes
      ).toEqual([{ field: "amount", from: "60.00", to: "75.00" }]);
      // another month's totals do not include it
      expect(
        await getPaymentFlowTotals(
          db,
          org.id,
          org.currency,
          "2026-02-01",
          "2026-02-28"
        )
      ).toMatchObject({ received: "0.00", reversed: "0.00" });
    } finally {
      await cleanupOrganization(db, org.id);
      await cleanupOrganization(db, other.id);
    }
  });

  it("follows a payment that was reversed and matched to another dwelling", async () => {
    const org = await newOrg("IT-Trail C");
    try {
      const a = await createDwelling(
        db,
        org.id,
        { number: "1", occupantName: "Ann", billingAddress: "1 Test St" },
        adminId
      );
      const b = await createDwelling(
        db,
        org.id,
        { number: "2", occupantName: "Bob", billingAddress: "2 Test St" },
        adminId
      );
      const [invoiceA, invoiceB] = await preparedInvoices(org.id, [a.id, b.id]);
      const first = await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: invoiceA.id,
          amount: "50.00",
          bookingDate: "2026-01-20",
          reference: "MOVE-1",
          reason: "Entered against the wrong flat",
        },
        adminId
      );
      const [tx] = await db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.organizationId, org.id));
      await reversePayment(db, org.id, first.id, "Wrong flat", adminId);
      await matchTransactionToInvoice(db, org.id, tx.id, invoiceB.id, adminId);

      const trail = await getPaymentTrail(db, org.id, tx.id);
      // The money is on dwelling 2 now, whatever the first match said.
      expect(trail.dwelling?.number).toBe("2");
      expect(new Set(trail.entries.map((e) => e.dwellingNumber))).toEqual(
        new Set(["1", "2"])
      );
      expect(buildPaymentSplit(trail)).toMatchObject({
        reversed: false,
        applied: "50.00",
        credit: "0.00",
      });
      const kinds = buildTrailEvents(trail).map((e) => e.kind);
      expect(kinds).toContain("REVERSED");
      expect(kinds).toContain("MATCHED");
      expect(kinds.at(-1)).toBe("APPLIED");
      // The month counts the payment once.
      expect(
        await getPaymentFlowTotals(
          db,
          org.id,
          org.currency,
          "2026-01-01",
          "2026-01-31"
        )
      ).toMatchObject({ received: "50.00", reversed: "0.00" });
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("shows what is still open on the invoice after more than one partial payment", async () => {
    const org = await newOrg("IT-Trail D");
    try {
      const d = await createDwelling(
        db,
        org.id,
        { number: "9", occupantName: "Cy", billingAddress: "9 Test St" },
        adminId
      );
      const invoice = await preparedInvoice(org.id, d.id);
      for (const [amount, reference, bookingDate] of [
        ["20.00", "PART-1", "2026-01-20"],
        ["15.00", "PART-2", "2026-01-22"],
      ]) {
        await recordManualPayment(
          db,
          org.id,
          {
            invoiceId: invoice.id,
            amount,
            bookingDate,
            reference,
            reason: "Instalment",
          },
          adminId
        );
      }
      const confirmed = await listPaymentMatches(db, org.id, "CONFIRMED");
      expect(confirmed).toHaveLength(2);
      // 50.00 due, 35.00 paid: 15.00 is open -- not 30.00 or 35.00 as if each
      // payment were the only one.
      expect(confirmed.map((m) => m.remainingAfterAllocation)).toEqual([
        "15.00",
        "15.00",
      ]);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });
});
