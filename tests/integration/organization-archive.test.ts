// ADR 0009: organization archive. An archived organization is read-only for
// admins, closed for residents, and its invoice links stop working. Restore
// undoes all of it.
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { appUsers } from "../../src/db/schema/auth";
import { auditLogs } from "../../src/db/schema/audit";
import { dwellingAccess } from "../../src/db/schema/dwellings";
import { loadAuthContext } from "../../src/domain/authorization/context";
import {
  requireActiveOrganization,
  requireOrganizationAccess,
} from "../../src/domain/authorization/guards";
import {
  createInvoiceAccessToken,
  resolveInvoiceAccessToken,
} from "../../src/domain/billing/invoice-tokens";
import { generateInvoice } from "../../src/domain/billing/generation";
import { createRule } from "../../src/domain/billing/rules";
import { ConflictError, ValidationError } from "../../src/domain/errors";
import { messages } from "../../src/db/schema/messaging";
import {
  createConversation,
  markConversationRead,
  reply,
} from "../../src/domain/messaging/conversations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import {
  archiveOrganization,
  createOrganization,
  restoreOrganization,
} from "../../src/domain/organizations/organizations";
import { createPeriod } from "../../src/domain/periods/periods";

let db: Db;
let adminId: string;
let residentId: string;
let dualId: string;
let orgA: { id: string };
let orgB: { id: string };
let dwellingA: { id: string };
let dwellingB: { id: string };
let invoiceId: string;
const residentEmail = "it-arch-resident@example.com";
const dualEmail = "it-arch-dual@example.com";
const secret = "it-arch-token-secret";

async function auditCount(action: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(eq(auditLogs.organizationId, orgA.id), eq(auditLogs.action, action))
    );
  return rows.length;
}

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-arch-admin@example.com");
  residentId = randomUUID();
  dualId = randomUUID();
  await db.insert(appUsers).values([
    { id: residentId, role: "RESIDENT", emailSnapshot: residentEmail },
    { id: dualId, role: "RESIDENT", emailSnapshot: dualEmail },
  ]);

  orgA = await createOrganization(
    db,
    { name: "IT-ARCH A", addressLine1: "Addr A" },
    adminId
  );
  orgB = await createOrganization(
    db,
    { name: "IT-ARCH B", addressLine1: "Addr B" },
    adminId
  );
  dwellingA = await createDwelling(
    db,
    orgA.id,
    { number: "A1", occupantName: "Resident A1" },
    adminId
  );
  dwellingB = await createDwelling(
    db,
    orgB.id,
    { number: "B1", occupantName: "Resident B1" },
    adminId
  );
  await db.insert(dwellingAccess).values([
    { dwellingId: dwellingA.id, userId: residentId },
    { dwellingId: dwellingA.id, userId: dualId },
    { dwellingId: dwellingB.id, userId: dualId },
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
    dwellingA.id,
    adminId
  );
  invoiceId = invoice.id;
});

afterAll(async () => {
  for (const org of [orgA, orgB]) {
    if (org) await cleanupOrganization(db, org.id);
  }
  await db.$client.query("delete from app_users where id = any($1)", [
    [residentId, dualId],
  ]);
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

describe("organization archive", () => {
  it("needs a reason", async () => {
    await expect(
      archiveOrganization(db, orgA.id, "   ", adminId)
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      archiveOrganization(db, orgA.id, "x".repeat(501), adminId)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("works on a live organization", async () => {
    const auth = await loadAuthContext(
      db,
      adminId,
      "it-arch-admin@example.com"
    );
    expect(auth?.archivedOrganizationIds).toEqual([]);
    const token = await createInvoiceAccessToken(
      db,
      orgA.id,
      invoiceId,
      secret,
      null,
      adminId
    );
    expect((await resolveInvoiceAccessToken(db, token, secret)).invoiceId).toBe(
      invoiceId
    );
    (globalThis as { __archToken?: string }).__archToken = token;
  });

  it("archive closes writes, residents, and links; restore reopens them", async () => {
    const token = (globalThis as { __archToken?: string }).__archToken!;
    await archiveOrganization(db, orgA.id, "Contract ended", adminId);
    // Second call changes nothing and writes no second audit row.
    await archiveOrganization(db, orgA.id, "Contract ended", adminId);
    expect(await auditCount("ORGANIZATION_ARCHIVED")).toBe(1);

    // Admin: read stays, write is refused.
    const admin = await loadAuthContext(
      db,
      adminId,
      "it-arch-admin@example.com"
    );
    expect(admin?.archivedOrganizationIds).toContain(orgA.id);
    requireOrganizationAccess(admin, orgA.id);
    expect(() => requireActiveOrganization(admin, orgA.id)).toThrow(
      ConflictError
    );
    expect(() => requireActiveOrganization(admin, orgB.id)).not.toThrow();

    // Resident: locked out.
    const resident = await loadAuthContext(db, residentId, residentEmail);
    expect(resident?.dwellingIds).toEqual([]);
    expect(resident?.closedDwellingCount).toBe(1);

    // Person in two organizations keeps the open one.
    const dual = await loadAuthContext(db, dualId, dualEmail);
    expect(dual?.dwellingIds).toEqual([dwellingB.id]);
    expect(dual?.closedDwellingCount).toBe(1);

    // Old invoice link stops working.
    await expect(resolveInvoiceAccessToken(db, token, secret)).rejects.toThrow(
      "Invalid or expired invoice link"
    );

    // An admin cannot reply in an archived organization.
    const conversation = await createConversation(
      db,
      dwellingA.id,
      "Subject",
      "Hello",
      adminId,
      "ADMIN"
    );
    await expect(
      reply(db, conversation.id, "Hi", admin!, "ADMIN")
    ).rejects.toBeInstanceOf(ConflictError);

    // Opening the inbox of an archived organization changes nothing.
    await markConversationRead(db, orgA.id, conversation.id);
    const unreadCount = async () =>
      (
        await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversation.id),
              isNull(messages.readAt)
            )
          )
      ).length;
    expect(await unreadCount()).toBe(1);

    await restoreOrganization(db, orgA.id, adminId);
    await restoreOrganization(db, orgA.id, adminId);
    await markConversationRead(db, orgA.id, conversation.id);
    expect(await unreadCount()).toBe(0);
    expect(await auditCount("ORGANIZATION_RESTORED")).toBe(1);

    const restored = await loadAuthContext(db, residentId, residentEmail);
    expect(restored?.dwellingIds).toEqual([dwellingA.id]);
    expect(restored?.closedDwellingCount).toBe(0);
    expect((await resolveInvoiceAccessToken(db, token, secret)).invoiceId).toBe(
      invoiceId
    );
    const adminAgain = await loadAuthContext(
      db,
      adminId,
      "it-arch-admin@example.com"
    );
    await expect(
      reply(db, conversation.id, "Hi", adminAgain!, "ADMIN")
    ).resolves.toBeDefined();
  });
});
