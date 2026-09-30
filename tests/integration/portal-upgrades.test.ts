// ADR 0009: resident portal upgrades. The payment history shows what a
// resident may see and nothing else. The display name is the only profile
// field a person can change.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { auditLogs } from "../../src/db/schema/audit";
import { appUsers } from "../../src/db/schema/auth";
import { billingCases } from "../../src/db/schema/billing";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import { createRule } from "../../src/domain/billing/rules";
import { ValidationError } from "../../src/domain/errors";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { recordManualPayment } from "../../src/domain/payments/manual";
import { listPaymentsForResident } from "../../src/domain/payments/resident-history";
import { reversePayment } from "../../src/domain/payments/reversal";
import { createPeriod } from "../../src/domain/periods/periods";
import {
  getOwnDisplayName,
  updateOwnDisplayName,
} from "../../src/domain/privacy/profile";

let db: Db;
let adminId: string;
let personId: string;
let org: { id: string };
let dwelling: { id: string };
let otherDwelling: { id: string };
let invoice: { id: string; amountDue: string };
let otherInvoice: { id: string; amountDue: string };

async function invoiceFor(dwellingId: string, month: 1 | 2) {
  const mm = `0${month}`;
  const period = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month,
      startsOn: `2026-${mm}-01`,
      endsOn: `2026-${mm}-28`,
      invoiceIssueDate: `2026-${mm}-28`,
      invoiceDueDate: `2026-0${month + 1}-14`,
    },
    adminId
  );
  const generated = await generateInvoice(
    db,
    org.id,
    period.id,
    dwellingId,
    adminId
  );
  return prepareInvoice(db, org.id, generated.id, adminId);
}

async function caseIdOf(invoiceId: string): Promise<string> {
  const { rows } = await db.$client.query(
    "select billing_case_id from invoices where id = $1",
    [invoiceId]
  );
  return rows[0].billing_case_id;
}

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-portal-admin@example.com");
  personId = randomUUID();
  await db.insert(appUsers).values({
    id: personId,
    role: "RESIDENT",
    emailSnapshot: "it-portal-person@example.com",
  });
  org = await createOrganization(
    db,
    {
      name: "IT-PORTAL",
      addressLine1: "Addr",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    adminId
  );
  dwelling = await createDwelling(
    db,
    org.id,
    { number: "1", occupantName: "Pat Person", billingAddress: "1 Test St" },
    adminId
  );
  otherDwelling = await createDwelling(
    db,
    org.id,
    { number: "2", occupantName: "Other Person", billingAddress: "2 Test St" },
    adminId
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
    adminId
  );
  invoice = await invoiceFor(dwelling.id, 1);
  otherInvoice = await invoiceFor(otherDwelling.id, 2);
});

afterAll(async () => {
  await cleanupOrganization(db, org.id);
  await db.$client.query("delete from audit_logs where actor_user_id = $1", [
    personId,
  ]);
  await db.$client.query("delete from app_users where id = $1", [personId]);
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

describe("listPaymentsForResident", () => {
  it("shows a payment, then a reversal as Reversed, without private data", async () => {
    expect(await listPaymentsForResident(db, dwelling.id)).toEqual([]);

    const match = await recordManualPayment(
      db,
      org.id,
      {
        invoiceId: invoice.id,
        amount: invoice.amountDue,
        bookingDate: "2026-01-20",
        payerName: "Secret Payer",
        reference: "SECRETREF",
        reason: "Bank transfer",
      },
      adminId
    );
    await recordManualPayment(
      db,
      org.id,
      {
        invoiceId: otherInvoice.id,
        amount: otherInvoice.amountDue,
        bookingDate: "2026-02-20",
        reference: "OTHERREF",
        reason: "Other dwelling",
      },
      adminId
    );

    const paid = await listPaymentsForResident(db, dwelling.id);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      status: "PAID",
      date: "2026-01-20",
      amount: invoice.amountDue,
      invoiceId: invoice.id,
    });

    await reversePayment(db, org.id, match.id, "SECRETREASON", adminId);
    // A reversed invoice is open again. Keep it visible to the resident, as a
    // sent invoice would be.
    await db
      .update(billingCases)
      .set({ status: "SENT" })
      .where(eq(billingCases.id, await caseIdOf(invoice.id)));

    const rows = await listPaymentsForResident(db, dwelling.id);
    expect(rows.map((r) => r.status)).toEqual(["REVERSED", "PAID"]);
    const json = JSON.stringify(rows);
    for (const secret of [
      "Secret Payer",
      "SECRETREF",
      "SECRETREASON",
      "OTHERREF",
    ]) {
      expect(json).not.toContain(secret);
    }
    // Nothing of the other dwelling.
    expect(rows.every((r) => r.invoiceId === invoice.id)).toBe(true);
  });

  it("hides payments of an invoice the resident cannot see yet", async () => {
    await db
      .update(billingCases)
      .set({ status: "PREPARED" })
      .where(eq(billingCases.id, await caseIdOf(invoice.id)));
    expect(await listPaymentsForResident(db, dwelling.id)).toEqual([]);
  });
});

describe("updateOwnDisplayName", () => {
  it("trims, saves, and writes one audit row per real change", async () => {
    expect(await getOwnDisplayName(db, personId)).toBeNull();
    expect(await updateOwnDisplayName(db, personId, "  Pat Person  ")).toBe(
      "Pat Person"
    );
    expect(await getOwnDisplayName(db, personId)).toBe("Pat Person");
    // Same name again changes nothing.
    await updateOwnDisplayName(db, personId, "Pat Person");
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actorUserId, personId),
          eq(auditLogs.action, "PROFILE_UPDATED")
        )
      );
    expect(rows).toHaveLength(1);
  });

  it("rejects an empty name and a name over 100 characters", async () => {
    await expect(
      updateOwnDisplayName(db, personId, "   ")
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateOwnDisplayName(db, personId, "x".repeat(101))
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await getOwnDisplayName(db, personId)).toBe("Pat Person");
  });
});
