// Payments posted straight to a dwelling account, cash, and the edit of an
// unmatched row (ADR 0014). Requires a real Postgres reachable via DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
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
import { auditLogs } from "../../src/db/schema/audit";
import { invoices } from "../../src/db/schema/invoices";
import {
  bankImports,
  bankTransactions,
  paymentMatches,
} from "../../src/db/schema/payments";
import {
  getDwellingAccountBalance,
  getProtectedOpeningDebt,
  postAccountEntry,
} from "../../src/domain/accounts/ledger";
import {
  CREDIT_USED_MESSAGE,
  OPEN_INVOICE_MESSAGE,
  listDwellingPayments,
  recordDwellingPayment,
  reverseDwellingPayment,
} from "../../src/domain/payments/direct";
import {
  confirmMatch,
  listUnmatchedTransactions,
} from "../../src/domain/payments/matching";
import {
  PAYMENT_ALREADY_RECORDED_MESSAGE,
  matchTransactionToInvoice,
  recordManualPayment,
  updateUnmatchedTransaction,
} from "../../src/domain/payments/manual";
import { reversePayment } from "../../src/domain/payments/reversal";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../src/domain/errors";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-direct-payment-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

async function newOrg(name: string) {
  return createOrganization(
    db,
    {
      name,
      addressLine1: "Addr 1",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    adminId
  );
}

function dwelling(orgId: string, number: string) {
  return createDwelling(
    db,
    orgId,
    { number, occupantName: "Jane Doe", billingAddress: "1 Test St" },
    adminId
  );
}

// A 50.00 monthly charge; returns a DRAFT invoice (not prepared).
async function draftInvoice(orgId: string, dwellingId: string, month: number) {
  const mm = String(month).padStart(2, "0");
  const period = await createPeriod(
    db,
    orgId,
    {
      year: 2026,
      month,
      startsOn: `2026-${mm}-01`,
      endsOn: `2026-${mm}-28`,
      invoiceIssueDate: `2026-${mm}-28`,
      invoiceDueDate: `2026-${String(Math.min(month + 1, 12)).padStart(2, "0")}-14`,
    },
    adminId
  );
  const first = month === 1;
  if (first) {
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
  }
  return generateInvoice(db, orgId, period.id, dwellingId, adminId);
}

const base = {
  amount: "40.00",
  bookingDate: "2026-01-10",
  method: "BANK" as const,
  payerName: "Jane Doe",
  reference: "ADVANCE-1",
  reason: "Advance payment, no invoice yet",
};

describe("Payment posted to a dwelling account (ADR 0014)", () => {
  it("credits the account, is not unmatched, shows in the list and audit", async () => {
    const org = await newOrg("IT-Direct A");
    const d = await dwelling(org.id, "1");
    try {
      const tx = await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id },
        adminId
      );
      expect(tx.appliedDwellingId).toBe(d.id);
      expect(await getDwellingAccountBalance(db, org.id, d.id, "EUR")).toBe(
        "-40.00"
      );
      expect(await listUnmatchedTransactions(db, org.id)).toHaveLength(0);
      const listed = await listDwellingPayments(db, org.id, d.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ amount: "40.00", reversed: false });
      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, org.id),
            eq(auditLogs.action, "DWELLING_PAYMENT_RECORDED")
          )
        );
      expect(audit).toHaveLength(1);
      // Matching it to an invoice would credit the money twice.
      await expect(
        matchTransactionToInvoice(
          db,
          org.id,
          tx.id,
          "00000000-0000-0000-0000-000000000000",
          adminId
        )
      ).rejects.toThrow(ConflictError);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("is refused while the dwelling has an open invoice, allowed after it is paid", async () => {
    const org = await newOrg("IT-Direct B");
    const d = await dwelling(org.id, "1");
    try {
      const draft = await draftInvoice(org.id, d.id, 1);
      // A draft invoice is not open: preparation will see the credit.
      await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id, reference: "R-DRAFT" },
        adminId
      );
      const prepared = await prepareInvoice(db, org.id, draft.id, adminId);
      // The 40.00 credit was used once, on this invoice.
      expect(prepared.previousCreditApplied).toBe("40.00");
      expect(prepared.amountDue).toBe("10.00");

      await expect(
        recordDwellingPayment(
          db,
          org.id,
          { ...base, dwellingId: d.id, reference: "R-OPEN" },
          adminId
        )
      ).rejects.toThrow(OPEN_INVOICE_MESSAGE);

      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: prepared.id,
          amount: "10.00",
          bookingDate: "2026-01-20",
          reference: "R-PAY",
          reason: "Transfer",
        },
        adminId
      );
      await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id, reference: "R-AFTER" },
        adminId
      );
      expect(await getDwellingAccountBalance(db, org.id, d.id, "EUR")).toBe(
        "-40.00"
      );
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("a payment on a migrated opening debt settles it first, a reversal restores it", async () => {
    const org = await newOrg("IT-Direct C");
    const d = await dwelling(org.id, "1");
    try {
      await postAccountEntry(db, {
        organizationId: org.id,
        dwellingId: d.id,
        effectiveDate: "2026-01-01",
        type: "OPENING_BALANCE",
        debit: "100.00",
        credit: "0.00",
        currency: "EUR",
        description: "Opening balance",
        metadata: { migrationImportId: "00000000-0000-0000-0000-0000000000aa" },
        idempotencyKey: `it-direct-opening:${d.id}`,
      });
      expect(await getProtectedOpeningDebt(db, org.id, d.id, "EUR")).toBe(
        "100.00"
      );
      const tx = await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id },
        adminId
      );
      expect(await getDwellingAccountBalance(db, org.id, d.id, "EUR")).toBe(
        "60.00"
      );
      expect(await getProtectedOpeningDebt(db, org.id, d.id, "EUR")).toBe(
        "60.00"
      );

      await reverseDwellingPayment(
        db,
        org.id,
        tx.id,
        "Wrong dwelling",
        adminId
      );
      expect(await getDwellingAccountBalance(db, org.id, d.id, "EUR")).toBe(
        "100.00"
      );
      expect(await getProtectedOpeningDebt(db, org.id, d.id, "EUR")).toBe(
        "100.00"
      );
      // A second reversal posts nothing.
      await reverseDwellingPayment(db, org.id, tx.id, "Again", adminId);
      const reversals = await db
        .select()
        .from(accountEntries)
        .where(
          and(
            eq(accountEntries.organizationId, org.id),
            eq(accountEntries.type, "PAYMENT_REVERSAL")
          )
        );
      expect(reversals).toHaveLength(1);
      const listed = await listDwellingPayments(db, org.id, d.id);
      expect(listed[0].reversed).toBe(true);
      // A reversed direct payment does not come back as unmatched: enter the
      // payment again for the right dwelling.
      expect(await listUnmatchedTransactions(db, org.id)).toHaveLength(0);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("refuses a reversal when a later invoice used the credit", async () => {
    const org = await newOrg("IT-Direct D");
    const d = await dwelling(org.id, "1");
    try {
      const tx = await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id },
        adminId
      );
      const draft = await draftInvoice(org.id, d.id, 1);
      await prepareInvoice(db, org.id, draft.id, adminId);
      await expect(
        reverseDwellingPayment(db, org.id, tx.id, "Oops", adminId)
      ).rejects.toThrow(CREDIT_USED_MESSAGE);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("only a direct payment can be reversed here; an invoice payment keeps its own reversal", async () => {
    const org = await newOrg("IT-Direct E");
    const d = await dwelling(org.id, "1");
    try {
      const draft = await draftInvoice(org.id, d.id, 1);
      const prepared = await prepareInvoice(db, org.id, draft.id, adminId);
      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: prepared.id,
          amount: "50.00",
          bookingDate: "2026-01-20",
          reference: "R-1",
          reason: "Transfer",
        },
        adminId
      );
      const [row] = await db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.organizationId, org.id));
      await expect(
        reverseDwellingPayment(db, org.id, row.id, "x", adminId)
      ).rejects.toThrow(ConflictError);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("cash: reference is optional, same-day same-amount cash is allowed, a repeated form is not", async () => {
    const org = await newOrg("IT-Direct F");
    const d = await dwelling(org.id, "1");
    try {
      const cash = {
        dwellingId: d.id,
        amount: "20.00",
        bookingDate: "2026-01-10",
        method: "CASH" as const,
        reason: "Cash at the office",
      };
      const submission = "11111111-1111-4111-8111-111111111111";
      const first = await recordDwellingPayment(
        db,
        org.id,
        { ...cash, submissionId: submission },
        adminId
      );
      expect(first.paymentMethod).toBe("CASH");
      expect(first.reference).toBeNull();
      await recordDwellingPayment(
        db,
        org.id,
        { ...cash, submissionId: "22222222-2222-4222-8222-222222222222" },
        adminId
      );
      await expect(
        recordDwellingPayment(
          db,
          org.id,
          { ...cash, submissionId: submission },
          adminId
        )
      ).rejects.toThrow(PAYMENT_ALREADY_RECORDED_MESSAGE);
      expect(await getDwellingAccountBalance(db, org.id, d.id, "EUR")).toBe(
        "-40.00"
      );
      const [entry] = await db
        .select()
        .from(accountEntries)
        .where(eq(accountEntries.bankTransactionId, first.id));
      expect(entry.description).toMatch(/^Cash payment/);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("bank: needs a reference and refuses the same reference, amount and date", async () => {
    const org = await newOrg("IT-Direct G");
    const d = await dwelling(org.id, "1");
    try {
      await expect(
        recordDwellingPayment(
          db,
          org.id,
          { ...base, dwellingId: d.id, reference: "" },
          adminId
        )
      ).rejects.toThrow(ValidationError);
      await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id },
        adminId
      );
      await expect(
        recordDwellingPayment(
          db,
          org.id,
          { ...base, dwellingId: d.id },
          adminId
        )
      ).rejects.toThrow(ConflictError);
      // The refused attempt left no half-written rows behind.
      expect(
        await db
          .select()
          .from(bankImports)
          .where(eq(bankImports.organizationId, org.id))
      ).toHaveLength(1);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("a bank payment reversed off one dwelling can be entered again for the right one", async () => {
    const org = await newOrg("IT-Direct R");
    const wrong = await dwelling(org.id, "1");
    const right = await dwelling(org.id, "2");
    try {
      const tx = await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: wrong.id },
        adminId
      );
      // Still a repeat while it stands.
      await expect(
        recordDwellingPayment(
          db,
          org.id,
          { ...base, dwellingId: right.id },
          adminId
        )
      ).rejects.toThrow(ConflictError);
      await reverseDwellingPayment(
        db,
        org.id,
        tx.id,
        "Wrong dwelling",
        adminId
      );
      await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: right.id },
        adminId
      );
      expect(await getDwellingAccountBalance(db, org.id, wrong.id, "EUR")).toBe(
        "0.00"
      );
      expect(await getDwellingAccountBalance(db, org.id, right.id, "EUR")).toBe(
        "-40.00"
      );
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("refuses an amount the column cannot hold", async () => {
    const org = await newOrg("IT-Direct S");
    const d = await dwelling(org.id, "1");
    try {
      await expect(
        recordDwellingPayment(
          db,
          org.id,
          { ...base, dwellingId: d.id, amount: "1000000000000.00" },
          adminId
        )
      ).rejects.toThrow(ValidationError);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("an invoice payment can be cash", async () => {
    const org = await newOrg("IT-Direct H");
    const d = await dwelling(org.id, "1");
    try {
      const draft = await draftInvoice(org.id, d.id, 1);
      const prepared = await prepareInvoice(db, org.id, draft.id, adminId);
      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: prepared.id,
          amount: "50.00",
          bookingDate: "2026-01-20",
          reason: "Cash at the office",
          method: "CASH",
        },
        adminId
      );
      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, prepared.id));
      expect(inv.paidAt).not.toBeNull();
      const [entry] = await db
        .select()
        .from(accountEntries)
        .where(
          and(
            eq(accountEntries.organizationId, org.id),
            eq(accountEntries.type, "PAYMENT")
          )
        );
      expect(entry.description).toMatch(/^Cash payment/);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("one organization cannot post to another's dwelling", async () => {
    const a = await newOrg("IT-Direct I1");
    const b = await newOrg("IT-Direct I2");
    const db1 = await dwelling(b.id, "1");
    try {
      await expect(
        recordDwellingPayment(
          db,
          a.id,
          { ...base, dwellingId: db1.id },
          adminId
        )
      ).rejects.toThrow(NotFoundError);
      expect(await getDwellingAccountBalance(db, b.id, db1.id, "EUR")).toBe(
        "0.00"
      );
    } finally {
      await cleanupOrganization(db, a.id);
      await cleanupOrganization(db, b.id);
    }
  });

  it("takes the dwelling lock, so it cannot slip between a preparation's checks", async () => {
    const org = await newOrg("IT-Direct J");
    const d = await dwelling(org.id, "1");
    const other = await createIntegrationDb();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      const holder = other.transaction(async (tx) => {
        await tx.execute(
          sql`select id from dwellings where id = ${d.id} for no key update`
        );
        locked();
        await held;
      });
      await lockTaken;
      let finished = false;
      const payment = recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id },
        adminId
      ).then((r) => {
        finished = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(finished).toBe(false);
      release();
      await holder;
      await payment;
      expect(finished).toBe(true);
    } finally {
      await other.$client.end();
      await cleanupOrganization(db, org.id);
    }
  });

  it("a payment racing a preparation never counts twice", async () => {
    for (let i = 0; i < 3; i++) {
      const org = await newOrg(`IT-Direct K${i}`);
      const d = await dwelling(org.id, "1");
      try {
        const draft = await draftInvoice(org.id, d.id, 1);
        const other = await createIntegrationDb();
        const [paid, prepared] = await Promise.allSettled([
          recordDwellingPayment(
            db,
            org.id,
            { ...base, dwellingId: d.id },
            adminId
          ),
          prepareInvoice(other, org.id, draft.id, adminId),
        ]);
        await other.$client.end();
        expect(prepared.status).toBe("fulfilled");
        const credit = (
          prepared as PromiseFulfilledResult<{ previousCreditApplied: string }>
        ).value.previousCreditApplied;
        if (paid.status === "fulfilled") {
          // The preparation saw the payment, or the payment ran first.
          expect(credit).toBe("40.00");
        } else {
          // Refused because the invoice was prepared first: nothing posted.
          expect(credit).toBe("0.00");
          expect(await getDwellingAccountBalance(db, org.id, d.id, "EUR")).toBe(
            "50.00"
          );
        }
      } finally {
        await cleanupOrganization(db, org.id);
      }
    }
  });
});

describe("Edit of an unmatched bank row (ADR 0014)", () => {
  async function importedRow(orgId: string) {
    const [imp] = await db
      .insert(bankImports)
      .values({
        organizationId: orgId,
        originalFilename: "statement.csv",
        fileSha256: `it-${orgId}`,
        importedByUserId: adminId,
        rowCount: 1,
      })
      .returning();
    const [row] = await db
      .insert(bankTransactions)
      .values({
        organizationId: orgId,
        bankImportId: imp.id,
        bookingDate: "2026-01-05",
        amount: "12.00",
        currency: "EUR",
        payerName: "J DOE",
        reference: "garbled",
        rawData: { original: "row" },
        rowNumber: 1,
      })
      .returning();
    return row;
  }

  const edit = {
    amount: "50.00",
    bookingDate: "2026-01-06",
    payerName: "Jane Doe",
    reference: "INV-1",
    reason: "Parser read the amount wrongly",
  };

  it("changes the row, keeps the raw data, audits before and after", async () => {
    const org = await newOrg("IT-Edit A");
    try {
      const row = await importedRow(org.id);
      const after = await updateUnmatchedTransaction(
        db,
        org.id,
        row.id,
        edit,
        adminId
      );
      expect(after).toMatchObject({
        amount: "50.00",
        bookingDate: "2026-01-06",
        payerName: "Jane Doe",
        reference: "INV-1",
        currency: "EUR",
      });
      expect(after.rawData).toEqual({ original: "row" });
      const [log] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, org.id),
            eq(auditLogs.action, "BANK_TRANSACTION_EDITED")
          )
        );
      expect(log.beforeData).toMatchObject({
        amount: "12.00",
        reference: "garbled",
      });
      expect(log.afterData).toMatchObject({
        amount: "50.00",
        reason: edit.reason,
      });
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("refuses an edit that turns a bank row into a repeat, and a reference that is erased", async () => {
    const org = await newOrg("IT-Edit C");
    try {
      const a = await importedRow(org.id);
      // A second statement row.
      const [imp] = await db
        .insert(bankImports)
        .values({
          organizationId: org.id,
          originalFilename: "statement-2.csv",
          fileSha256: `it-2-${org.id}`,
          importedByUserId: adminId,
          rowCount: 1,
        })
        .returning();
      const [b] = await db
        .insert(bankTransactions)
        .values({
          organizationId: org.id,
          bankImportId: imp.id,
          bookingDate: "2026-01-05",
          amount: "12.00",
          currency: "EUR",
          payerName: "J DOE",
          reference: "garbled",
          rawData: {},
          rowNumber: 1,
        })
        .returning();
      // a and b are identical statement rows. Editing the payer only is fine.
      await updateUnmatchedTransaction(
        db,
        org.id,
        b.id,
        {
          amount: "12.00",
          bookingDate: "2026-01-05",
          payerName: "Jane Doe",
          reference: "garbled",
          reason: "Name",
        },
        adminId
      );
      // a becomes a payment that b already is.
      await updateUnmatchedTransaction(
        db,
        org.id,
        a.id,
        { ...edit, reference: "INV-1" },
        adminId
      );
      await expect(
        updateUnmatchedTransaction(
          db,
          org.id,
          b.id,
          { ...edit, reference: " inv-1 " },
          adminId
        )
      ).rejects.toThrow(ConflictError);
      // A reference the statement gave cannot be blanked.
      await expect(
        updateUnmatchedTransaction(
          db,
          org.id,
          b.id,
          { ...edit, reference: "" },
          adminId
        )
      ).rejects.toThrow(ValidationError);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("confirmMatch refuses a payment already posted to a dwelling", async () => {
    const org = await newOrg("IT-Edit D");
    const d = await dwelling(org.id, "1");
    try {
      const draft = await draftInvoice(org.id, d.id, 1);
      const prepared = await prepareInvoice(db, org.id, draft.id, adminId);
      // Posting to the dwelling is refused while the invoice is open, so
      // pay it off first, then post, then force a stale proposed match.
      await recordManualPayment(
        db,
        org.id,
        {
          invoiceId: prepared.id,
          amount: "50.00",
          bookingDate: "2026-01-20",
          reference: "PAID",
          reason: "Transfer",
        },
        adminId
      );
      const direct = await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id },
        adminId
      );
      const [match] = await db
        .insert(paymentMatches)
        .values({
          organizationId: org.id,
          bankTransactionId: direct.id,
          invoiceId: prepared.id,
          matchType: "MANUAL",
          resultType: "EXACT",
          proposedAllocationAmount: "40.00",
          status: "PROPOSED",
        })
        .returning();
      await expect(confirmMatch(db, org.id, match.id, adminId)).rejects.toThrow(
        ConflictError
      );
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("refuses a matched row, a row posted to a dwelling, a bad value and another organization", async () => {
    const org = await newOrg("IT-Edit B");
    const other = await newOrg("IT-Edit B2");
    const d = await dwelling(org.id, "1");
    try {
      const direct = await recordDwellingPayment(
        db,
        org.id,
        { ...base, dwellingId: d.id },
        adminId
      );
      await expect(
        updateUnmatchedTransaction(db, org.id, direct.id, edit, adminId)
      ).rejects.toThrow(ConflictError);

      const row = await importedRow(org.id);
      await expect(
        updateUnmatchedTransaction(
          db,
          org.id,
          row.id,
          { ...edit, amount: "0" },
          adminId
        )
      ).rejects.toThrow(ValidationError);
      await expect(
        updateUnmatchedTransaction(
          db,
          org.id,
          row.id,
          { ...edit, bookingDate: "2999-01-01" },
          adminId
        )
      ).rejects.toThrow(ValidationError);
      await expect(
        updateUnmatchedTransaction(db, other.id, row.id, edit, adminId)
      ).rejects.toThrow(NotFoundError);

      // Matched to an invoice: money moved, so the row is locked.
      const draft = await draftInvoice(org.id, d.id, 1);
      const prepared = await prepareInvoice(db, org.id, draft.id, adminId);
      await matchTransactionToInvoice(db, org.id, row.id, prepared.id, adminId);
      await expect(
        updateUnmatchedTransaction(db, org.id, row.id, edit, adminId)
      ).rejects.toThrow(ConflictError);

      // After the match is reversed it is unmatched again, and editable.
      const [match] = await db
        .select()
        .from(paymentMatches)
        .where(eq(paymentMatches.bankTransactionId, row.id));
      await reversePayment(db, org.id, match.id, "Wrong invoice", adminId);
      await updateUnmatchedTransaction(db, org.id, row.id, edit, adminId);
    } finally {
      await cleanupOrganization(db, org.id);
      await cleanupOrganization(db, other.id);
    }
  });
});
