// ADR 0009: personal data export. Checks the scope (only the dwellings the
// person can access), the fields that must never appear, and the audit row.
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
import {
  accountEntries,
  paymentAllocations,
} from "../../src/db/schema/accounts";
import { auditLogs } from "../../src/db/schema/audit";
import { appUsers } from "../../src/db/schema/auth";
import { dwellingAccess } from "../../src/db/schema/dwellings";
import { invoiceAccessTokens, invoices } from "../../src/db/schema/invoices";
import { bankImports, bankTransactions } from "../../src/db/schema/payments";
import { generateInvoice } from "../../src/domain/billing/generation";
import { createInvoiceAccessToken } from "../../src/domain/billing/invoice-tokens";
import { createRule } from "../../src/domain/billing/rules";
import { NotFoundError } from "../../src/domain/errors";
import {
  createConversation,
  reply,
} from "../../src/domain/messaging/conversations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createPeriod } from "../../src/domain/periods/periods";
import { exportPersonData } from "../../src/domain/privacy/person-export";

let db: Db;
let adminId: string;
let personId: string;
let coResidentId: string;
const personEmail = "it-export-person@example.com";
const coEmail = "it-export-co@example.com";
let orgA: { id: string };
let orgB: { id: string };
let dwellingA1: { id: string };
let dwellingA2: { id: string };
let dwellingB1: { id: string };
let tokenHash = "";

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-export-admin@example.com");
  personId = randomUUID();
  coResidentId = randomUUID();
  await db.insert(appUsers).values([
    {
      id: personId,
      role: "RESIDENT",
      emailSnapshot: personEmail,
      displayName: "Pat Person",
    },
    { id: coResidentId, role: "RESIDENT", emailSnapshot: coEmail },
  ]);
  orgA = await createOrganization(
    db,
    { name: "IT-EXP A", addressLine1: "Addr A" },
    adminId
  );
  orgB = await createOrganization(
    db,
    { name: "IT-EXP B", addressLine1: "Addr B" },
    adminId
  );
  dwellingA1 = await createDwelling(
    db,
    orgA.id,
    {
      number: "A1",
      occupantName: "Pat Person",
      billingEmail: coEmail, // another person's address
    },
    adminId
  );
  // The person has no access here.
  dwellingA2 = await createDwelling(
    db,
    orgA.id,
    { number: "A2", occupantName: "Somebody Else", notes: "SECRETNOTE" },
    adminId
  );
  dwellingB1 = await createDwelling(
    db,
    orgB.id,
    { number: "B1", occupantName: "Pat In B" },
    adminId
  );
  await db.insert(dwellingAccess).values([
    { dwellingId: dwellingA1.id, userId: personId },
    { dwellingId: dwellingA1.id, userId: coResidentId },
    { dwellingId: dwellingB1.id, userId: personId },
  ]);

  const period = await createPeriod(
    db,
    orgA.id,
    {
      year: 2026,
      month: 1,
      startsOn: "2026-01-01",
      endsOn: "2026-01-31",
      invoiceIssueDate: "2026-01-31",
      invoiceDueDate: "2026-02-14",
    },
    adminId
  );
  await createRule(
    db,
    orgA.id,
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
  const invoice = await generateInvoice(
    db,
    orgA.id,
    period.id,
    dwellingA1.id,
    adminId
  );
  await db
    .update(invoices)
    .set({ sentAt: new Date() })
    .where(eq(invoices.id, invoice.id));
  const otherInvoice = await generateInvoice(
    db,
    orgA.id,
    period.id,
    dwellingA2.id,
    adminId
  );
  await db
    .update(invoices)
    .set({ sentAt: new Date() })
    .where(eq(invoices.id, otherInvoice.id));

  await createInvoiceAccessToken(
    db,
    orgA.id,
    invoice.id,
    "it-export-secret",
    null,
    adminId
  );
  const [tokenRow] = await db
    .select()
    .from(invoiceAccessTokens)
    .where(eq(invoiceAccessTokens.invoiceId, invoice.id));
  tokenHash = tokenRow.tokenHash;

  const [bankImport] = await db
    .insert(bankImports)
    .values({
      organizationId: orgA.id,
      originalFilename: "it-export.csv",
      fileSha256: randomUUID(),
      importedByUserId: adminId,
      rowCount: 1,
    })
    .returning();
  const [bankTx] = await db
    .insert(bankTransactions)
    .values({
      organizationId: orgA.id,
      bankImportId: bankImport.id,
      bookingDate: "2026-02-01",
      amount: "50.00",
      currency: "EUR",
      payerName: "Pat Person",
      payerAccount: "LV99SECRETACCOUNT",
      reference: "INV paid",
      rawData: { leak: "RAWSECRET" },
      rowNumber: 1,
    })
    .returning();
  await db.insert(paymentAllocations).values({
    organizationId: orgA.id,
    dwellingId: dwellingA1.id,
    bankTransactionId: bankTx.id,
    invoiceId: invoice.id,
    allocatedAmount: "50.00",
    method: "EXACT",
    idempotencyKey: `it-export-${randomUUID()}`,
  });
  await db.insert(accountEntries).values({
    organizationId: orgA.id,
    dwellingId: dwellingA1.id,
    effectiveDate: "2026-01-31",
    type: "INVOICE_CHARGE",
    debit: "50.00",
    credit: "0.00",
    currency: "EUR",
    description: "Invoice charge",
    metadata: { leak: "LEDGERSECRET" },
    idempotencyKey: `it-export-${randomUUID()}`,
  });

  const conversation = await createConversation(
    db,
    dwellingA1.id,
    "Leak in kitchen",
    "Please check",
    personId,
    "RESIDENT"
  );
  await reply(
    db,
    conversation.id,
    "We will come",
    {
      userId: adminId,
      email: "it-export-admin@example.com",
      organizationIds: [orgA.id],
      dwellingIds: [],
    },
    "ADMIN"
  );
});

afterAll(async () => {
  for (const org of [orgA, orgB]) {
    if (org) await cleanupOrganization(db, org.id);
  }
  await db.$client.query("delete from app_users where id = any($1)", [
    [personId, coResidentId],
  ]);
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

describe("exportPersonData", () => {
  it("admin export covers only the person's dwellings in that organization", async () => {
    const data = await exportPersonData(db, {
      userId: personId,
      organizationId: orgA.id,
      actorUserId: adminId,
    });
    expect(data.scope).toBe("ORGANIZATION");
    expect(data.person.email).toBe(personEmail);
    expect(data.dwellings.map((d) => d.number)).toEqual(["A1"]);
    const [dwelling] = data.dwellings;
    expect(dwelling.invoices).toHaveLength(1);
    expect(dwelling.invoices[0].lines.length).toBeGreaterThan(0);
    expect(dwelling.payments).toHaveLength(1);
    expect(dwelling.payments[0].payerName).toBe("Pat Person");
    expect(dwelling.accountEntries).toHaveLength(1);
    expect(dwelling.conversations[0].messages.map((m) => m.from)).toEqual([
      "YOU",
      "ADMIN",
    ]);
  });

  it("never includes forbidden data", async () => {
    const data = await exportPersonData(db, {
      userId: personId,
      organizationId: null,
      actorUserId: personId,
    });
    const json = JSON.stringify(data);
    for (const secret of [
      "LV99SECRETACCOUNT", // payer account
      "RAWSECRET", // raw bank row
      "LEDGERSECRET", // ledger metadata
      "SECRETNOTE", // a dwelling the person cannot access
      "Somebody Else",
      tokenHash,
      coEmail, // another person's address
      "idempotency",
      "requestId",
      "ipHash",
      adminId, // another user's id
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("self export spans every organization of the person", async () => {
    const data = await exportPersonData(db, {
      userId: personId,
      organizationId: null,
      actorUserId: personId,
    });
    expect(data.scope).toBe("SELF");
    expect(data.dwellings.map((d) => d.number).sort()).toEqual(["A1", "B1"]);
  });

  it("refuses a person with no access in the organization, like an unknown person", async () => {
    await expect(
      exportPersonData(db, {
        userId: coResidentId,
        organizationId: orgB.id,
        actorUserId: adminId,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      exportPersonData(db, {
        userId: randomUUID(),
        organizationId: orgA.id,
        actorUserId: adminId,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("writes an audit event per organization", async () => {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "PERSONAL_DATA_EXPORTED"),
          eq(auditLogs.entityId, personId)
        )
      );
    // Earlier tests: 1 admin export (org A) + 2 self exports, each over two
    // organizations.
    expect(rows.length).toBe(5);
    expect(rows.every((r) => r.actorUserId !== null)).toBe(true);
  });
});
