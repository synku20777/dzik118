// Phase K (Messaging) - domain-layer integration tests (spec Section
// 13.19, 35 MSG-001/002). Requires a real Postgres reachable via
// DATABASE_URL.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { appUsers } from "../../src/db/schema/auth";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createPeriod } from "../../src/domain/periods/periods";
import { createMeter } from "../../src/domain/organizations/meters";
import { submitAdminReading } from "../../src/domain/periods/readings";
import { exportReadingsCsv } from "../../src/domain/periods/readings-export";
import { NotFoundError } from "../../src/domain/errors";
import type { AuthContext } from "../../src/domain/authorization/context";
import {
  createConversation,
  getConversationForAdmin,
  listConversationsForOrganization,
  listConversationsWithMessagesForDwelling,
  listMessagesForConversation,
  reply,
  resolveConversation,
} from "../../src/domain/messaging/conversations";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-k-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

async function seedResident(email: string): Promise<string> {
  const id = randomUUID();
  await db
    .insert(appUsers)
    .values({ id, role: "RESIDENT", emailSnapshot: email });
  return id;
}

function deleteAppUser(id: string) {
  return db.$client.query("delete from app_users where id = $1", [id]);
}

function residentAuth(userId: string, dwellingId: string): AuthContext {
  return {
    role: "RESIDENT",
    userId,
    email: "resident@example.com",
    dwellingIds: [dwellingId],
  };
}

function adminAuth(userId: string, organizationId: string): AuthContext {
  return {
    role: "ADMIN",
    userId,
    email: "admin@example.com",
    organizationIds: [organizationId],
  };
}

describe("conversations", () => {
  it("MSG-001: a resident can create a conversation for their dwelling, starting NEW", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org Create", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const residentId = await seedResident("it-k-resident-create@example.com");

    const conversation = await createConversation(
      db,
      dwelling.id,
      "Leaky faucet",
      "The kitchen faucet is leaking.",
      residentId
    );
    expect(conversation.status).toBe("NEW");
    expect(conversation.organizationId).toBe(org.id);

    const msgs = await listMessagesForConversation(db, conversation.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe("The kitchen faucet is leaking.");
    expect(msgs[0].senderUserId).toBe(residentId);

    await cleanupOrg(org.id);
    await deleteAppUser(residentId);
  });

  it("MSG-002: reply from either the owning resident or the org admin moves NEW to OPEN", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org Reply", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const residentId = await seedResident("it-k-resident-reply@example.com");
    const conversation = await createConversation(
      db,
      dwelling.id,
      "Question",
      "Hello?",
      residentId
    );

    const adminReply = await reply(
      db,
      conversation.id,
      "We're looking into it.",
      adminAuth(seedAdminId, org.id)
    );
    expect(adminReply.senderUserId).toBe(seedAdminId);

    const updated = await getConversationForAdmin(db, org.id, conversation.id);
    expect(updated.status).toBe("OPEN");

    await reply(
      db,
      conversation.id,
      "Thanks!",
      residentAuth(residentId, dwelling.id)
    );
    const msgs = await listMessagesForConversation(db, conversation.id);
    expect(msgs).toHaveLength(3);

    await cleanupOrg(org.id);
    await deleteAppUser(residentId);
  });

  it("SEC-002: a resident cannot reply to a conversation on a dwelling that is not theirs", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org CrossResident", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwellingA = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      org.id,
      { number: "2" },
      seedAdminId
    );
    const residentId = await seedResident(
      "it-k-resident-crossresident@example.com"
    );
    const conversation = await createConversation(
      db,
      dwellingA.id,
      "Subject",
      "Body",
      residentId
    );

    await expect(
      reply(
        db,
        conversation.id,
        "I shouldn't be able to do this",
        residentAuth(residentId, dwellingB.id)
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    await cleanupOrg(org.id);
    await deleteAppUser(residentId);
  });

  it("SEC-001: an admin from a different organization cannot reply to this conversation", async () => {
    const orgA = await createOrganization(
      db,
      { name: "IT-K Org CrossTenantA", addressLine1: "Addr 1" },
      seedAdminId
    );
    const orgB = await createOrganization(
      db,
      { name: "IT-K Org CrossTenantB", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      orgA.id,
      { number: "1" },
      seedAdminId
    );
    const residentId = await seedResident(
      "it-k-resident-crosstenant@example.com"
    );
    const conversation = await createConversation(
      db,
      dwelling.id,
      "Subject",
      "Body",
      residentId
    );

    await expect(
      reply(
        db,
        conversation.id,
        "I shouldn't be able to do this",
        adminAuth(seedAdminId, orgB.id)
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
    await deleteAppUser(residentId);
  });

  it("MSG-002: resolving is admin-driven, idempotent, tenant-scoped, and does not reopen on a later reply", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org Resolve", addressLine1: "Addr 1" },
      seedAdminId
    );
    const otherOrg = await createOrganization(
      db,
      { name: "IT-K Org ResolveOther", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const residentId = await seedResident("it-k-resident-resolve@example.com");
    const conversation = await createConversation(
      db,
      dwelling.id,
      "Subject",
      "Body",
      residentId
    );

    await expect(
      resolveConversation(db, otherOrg.id, conversation.id, seedAdminId)
    ).rejects.toBeInstanceOf(NotFoundError);

    const resolved = await resolveConversation(
      db,
      org.id,
      conversation.id,
      seedAdminId
    );
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedAt).not.toBeNull();

    const resolvedAgain = await resolveConversation(
      db,
      org.id,
      conversation.id,
      seedAdminId
    );
    expect(resolvedAgain.resolvedAt).toEqual(resolved.resolvedAt);

    await reply(
      db,
      conversation.id,
      "One more thing",
      residentAuth(residentId, dwelling.id)
    );
    const stillResolved = await getConversationForAdmin(
      db,
      org.id,
      conversation.id
    );
    expect(stillResolved.status).toBe("RESOLVED");

    await cleanupOrg(org.id);
    await cleanupOrg(otherOrg.id);
    await deleteAppUser(residentId);
  });

  it("listConversationsForOrganization returns status, last message, and unread state; filters by dwelling", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org List", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwellingA = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      org.id,
      { number: "2" },
      seedAdminId
    );
    const residentId = await seedResident("it-k-resident-list@example.com");
    const convoA = await createConversation(
      db,
      dwellingA.id,
      "A",
      "Body A",
      residentId
    );
    await createConversation(db, dwellingB.id, "B", "Body B", residentId);
    await resolveConversation(db, org.id, convoA.id, seedAdminId);

    const all = await listConversationsForOrganization(db, org.id);
    expect(all).toHaveLength(2);
    // status filtering is now the caller's responsibility (same pattern as
    // the dwellings/periods list pages' in-memory type/status filters).
    const resolvedOnly = all.filter((c) => c.status === "RESOLVED");
    expect(resolvedOnly.map((c) => c.id)).toEqual([convoA.id]);
    const convoAResult = all.find((c) => c.id === convoA.id)!;
    expect(convoAResult.lastMessage?.body).toBe("Body A");
    expect(convoAResult.hasUnread).toBe(true);

    const forB = await listConversationsForOrganization(db, org.id, {
      dwellingId: dwellingB.id,
    });
    expect(forB).toHaveLength(1);
    expect(forB[0].dwellingNumber).toBe("2");

    await cleanupOrg(org.id);
    await deleteAppUser(residentId);
  });

  it("listConversationsWithMessagesForDwelling bundles every conversation with its own messages", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org Bundle", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const residentId = await seedResident("it-k-resident-bundle@example.com");
    const convo1 = await createConversation(
      db,
      dwelling.id,
      "First",
      "Body 1",
      residentId
    );
    const convo2 = await createConversation(
      db,
      dwelling.id,
      "Second",
      "Body 2",
      residentId
    );
    await reply(db, convo1.id, "Reply", adminAuth(seedAdminId, org.id));

    const bundled = await listConversationsWithMessagesForDwelling(
      db,
      dwelling.id
    );
    expect(bundled).toHaveLength(2);
    const first = bundled.find((b) => b.conversation.id === convo1.id)!;
    const second = bundled.find((b) => b.conversation.id === convo2.id)!;
    expect(first.messages).toHaveLength(2);
    expect(second.messages).toHaveLength(1);

    await cleanupOrg(org.id);
    await deleteAppUser(residentId);
  });
});

describe("exportReadingsCsv", () => {
  it("exports readings with formula-injection sanitization on the dwelling number", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org ReadingsExport", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "=SUM(A1)" },
      seedAdminId
    );
    const meter = await createMeter(
      db,
      org.id,
      dwelling.id,
      { type: "COLD_WATER", unit: "m3" },
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
    await submitAdminReading(
      db,
      org.id,
      period.id,
      meter.id,
      "10.000",
      seedAdminId
    );

    const csv = await exportReadingsCsv(db, org.id);
    expect(csv).toContain("dwelling_number");
    expect(csv).toContain('"\'=SUM(A1)"');
    expect(csv).toContain("COLD_WATER");
    expect(csv).toContain("10.000");

    await cleanupOrg(org.id);
  });

  it("still emits the header row for an organization with zero readings", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org ReadingsExportEmpty", addressLine1: "Addr 1" },
      seedAdminId
    );

    const csv = await exportReadingsCsv(db, org.id);
    expect(csv.trim()).toBe(
      "dwelling_number,meter_type,period_year,period_month,previous_value,current_value,consumption,source,submitted_at"
    );

    await cleanupOrg(org.id);
  });
});
