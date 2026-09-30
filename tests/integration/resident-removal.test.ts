// Removing a resident closes the dwelling's invoice links only when the
// resident owns the billing email address.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import {
  createDwelling,
  removeResidentAccess,
} from "../../src/domain/organizations/dwellings";
import { createPeriod } from "../../src/domain/periods/periods";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";

let db: Db;
let seedAdminId: string;
const extraUserIds: string[] = [];

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(
    db,
    "it-resident-removal-admin@example.com"
  );
});

afterAll(async () => {
  for (const id of extraUserIds) await deleteTestAdmin(db, id);
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

async function setup(name: string, billingEmail: string) {
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
    {
      number: "1",
      occupantName: "Jane Doe",
      billingAddress: "1 Test St",
      billingEmail,
    },
    seedAdminId
  );
  const period = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month: 1,
      startsOn: "2026-01-01",
      endsOn: "2026-01-28",
      invoiceIssueDate: "2026-01-28",
      invoiceDueDate: "2026-02-14",
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
  await db.$client.query(
    "insert into invoice_access_tokens (organization_id, invoice_id, token_hash) values ($1, $2, $3)",
    [org.id, invoice.id, `hash-${randomUUID()}`]
  );
  await db.$client.query(
    "insert into invoice_deliveries (organization_id, invoice_id, method, destination_email, provider, status) values ($1, $2, 'EMAIL', $3, 'test', 'SENT')",
    [org.id, invoice.id, billingEmail]
  );
  return { org, dwelling, invoice };
}

async function addResident(dwellingId: string, email: string) {
  const id = randomUUID();
  extraUserIds.push(id);
  await db.$client.query(
    "insert into app_users (id, role, email_snapshot) values ($1, 'RESIDENT', $2)",
    [id, email]
  );
  await db.$client.query(
    "insert into dwelling_access (dwelling_id, user_id) values ($1, $2)",
    [dwellingId, id]
  );
  return id;
}

async function activeTokens(invoiceId: string) {
  const { rows } = await db.$client.query(
    "select count(*)::int as n from invoice_access_tokens where invoice_id = $1 and revoked_at is null",
    [invoiceId]
  );
  return rows[0].n as number;
}

describe("removeResidentAccess and invoice links", () => {
  it("closes the links when the resident owns the billing email", async () => {
    const { org, dwelling, invoice } = await setup(
      "IT-Removal-A",
      "owner@example.com"
    );
    try {
      const userId = await addResident(dwelling.id, "Owner@Example.com");
      expect(await activeTokens(invoice.id)).toBe(1);
      await removeResidentAccess(db, org.id, dwelling.id, userId, seedAdminId);
      expect(await activeTokens(invoice.id)).toBe(0);
      const { rows } = await db.$client.query(
        "select count(*)::int as n from audit_logs where organization_id = $1 and action = 'INVOICE_ACCESS_TOKENS_REVOKED_ON_REMOVAL'",
        [org.id]
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("does not depend on the dwelling's current billing email", async () => {
    const { org, dwelling, invoice } = await setup(
      "IT-Removal-C",
      "owner@example.com"
    );
    try {
      await db.$client.query(
        "update dwellings set billing_email = 'someone-else@example.com' where id = $1",
        [dwelling.id]
      );
      const userId = await addResident(dwelling.id, "owner@example.com");
      await removeResidentAccess(db, org.id, dwelling.id, userId, seedAdminId);
      expect(await activeTokens(invoice.id)).toBe(0);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("a repeated removal changes nothing and writes no second audit row", async () => {
    const { org, dwelling } = await setup("IT-Removal-D", "owner@example.com");
    try {
      const userId = await addResident(dwelling.id, "owner@example.com");
      await removeResidentAccess(db, org.id, dwelling.id, userId, seedAdminId);
      await removeResidentAccess(db, org.id, dwelling.id, userId, seedAdminId);
      const { rows } = await db.$client.query(
        "select count(*)::int as n from audit_logs where organization_id = $1 and action = 'DWELLING_ACCESS_REMOVED'",
        [org.id]
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("keeps the links when another person owns the billing email", async () => {
    const { org, dwelling, invoice } = await setup(
      "IT-Removal-B",
      "owner@example.com"
    );
    try {
      const userId = await addResident(dwelling.id, "roommate@example.com");
      await removeResidentAccess(db, org.id, dwelling.id, userId, seedAdminId);
      expect(await activeTokens(invoice.id)).toBe(1);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });
});
