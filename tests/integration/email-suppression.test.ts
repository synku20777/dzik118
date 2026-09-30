// Bounce and complaint handling (ADR 0008).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import {
  assertEmailNotSuppressed,
  isEmailSuppressed,
  listSuppressedEmails,
  removeSuppression,
  suppressEmail,
} from "../../src/domain/email/suppression";
import { ConflictError, NotFoundError } from "../../src/domain/errors";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-suppression-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

// An organization with one emailed invoice. `sentTo` is the delivery address.
async function setup(name: string, sentTo: string) {
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
      billingEmail: sentTo,
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
    "insert into invoice_deliveries (organization_id, invoice_id, method, destination_email, provider, status) values ($1, $2, 'EMAIL', $3, 'test', 'SENT')",
    [org.id, invoice.id, sentTo]
  );
  return org;
}

describe("email suppression", () => {
  it("suppresses for every organization that emailed the address, once", async () => {
    const orgA = await setup("IT-Supp-A", "shared@example.com");
    const orgB = await setup("IT-Supp-B", "Shared@Example.com");
    const orgC = await setup("IT-Supp-C", "other@example.com");
    try {
      const added = await suppressEmail(db, {
        email: "SHARED@example.com",
        reason: "BOUNCE",
        detail: "Permanent bounce: General",
      });
      expect(added).toBe(2);
      expect(await isEmailSuppressed(db, orgA.id, "Shared@example.com")).toBe(
        true
      );
      expect(await isEmailSuppressed(db, orgB.id, "shared@example.com")).toBe(
        true
      );
      expect(await isEmailSuppressed(db, orgC.id, "shared@example.com")).toBe(
        false
      );

      // A repeated event adds nothing and writes no second audit row.
      expect(
        await suppressEmail(db, {
          email: "shared@example.com",
          reason: "BOUNCE",
          detail: "again",
        })
      ).toBe(0);
      const { rows } = await db.$client.query(
        "select count(*)::int as n from audit_logs where organization_id = $1 and action = 'EMAIL_SUPPRESSED'",
        [orgA.id]
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await cleanupOrganization(db, orgA.id);
      await cleanupOrganization(db, orgB.id);
      await cleanupOrganization(db, orgC.id);
    }
  });

  it("ignores an address that no organization has emailed", async () => {
    const org = await setup("IT-Supp-D", "known@example.com");
    try {
      expect(
        await suppressEmail(db, {
          email: "stranger@example.com",
          reason: "COMPLAINT",
          detail: "Complaint",
        })
      ).toBe(0);
      expect(await listSuppressedEmails(db, org.id)).toHaveLength(0);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("blocks sending until the address is removed from the list", async () => {
    const org = await setup("IT-Supp-E", "blocked@example.com");
    const other = await setup("IT-Supp-F", "blocked@example.com");
    try {
      await suppressEmail(db, {
        email: "blocked@example.com",
        reason: "COMPLAINT",
        detail: "Complaint: abuse",
      });
      await expect(
        assertEmailNotSuppressed(db, org.id, "Blocked@Example.com")
      ).rejects.toBeInstanceOf(ConflictError);

      const [entry] = await listSuppressedEmails(db, org.id);
      expect(entry.reason).toBe("COMPLAINT");

      // Another organization cannot remove this organization's entry.
      await expect(
        removeSuppression(db, other.id, entry.id, seedAdminId)
      ).rejects.toBeInstanceOf(NotFoundError);

      await removeSuppression(db, org.id, entry.id, seedAdminId);
      await expect(
        assertEmailNotSuppressed(db, org.id, "blocked@example.com")
      ).resolves.toBeUndefined();
      // The other organization is still blocked.
      expect(await isEmailSuppressed(db, other.id, "blocked@example.com")).toBe(
        true
      );
      const { rows } = await db.$client.query(
        "select count(*)::int as n from audit_logs where organization_id = $1 and action = 'EMAIL_SUPPRESSION_REMOVED'",
        [org.id]
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await cleanupOrganization(db, org.id);
      await cleanupOrganization(db, other.id);
    }
  });
});
