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
  markConversationRead,
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
    userId,
    email: "resident@example.com",
    organizationIds: [],
    dwellingIds: [dwellingId],
  };
}

function adminAuth(userId: string, organizationId: string): AuthContext {
  return {
    userId,
    email: "admin@example.com",
    organizationIds: [organizationId],
    dwellingIds: [],
  };
}

function dualAuth(
  userId: string,
  organizationId: string,
  dwellingId: string
): AuthContext {
  return {
    userId,
    email: "dual@example.com",
    organizationIds: [organizationId],
    dwellingIds: [dwellingId],
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
      residentId,
      "RESIDENT"
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
      residentId,
      "RESIDENT"
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
      residentId,
      "RESIDENT"
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
      residentId,
      "RESIDENT"
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
      residentId,
      "RESIDENT"
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
      residentId,
      "RESIDENT"
    );
    await createConversation(
      db,
      dwellingB.id,
      "B",
      "Body B",
      residentId,
      "RESIDENT"
    );
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

  it("listConversationsForOrganization returns the newest lastMessage and unread state for each conversation in updatedAt desc order", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org Aggregates", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const residentId = await seedResident("it-k-resident-agg@example.com");

    const convo1 = await createConversation(
      db,
      dwelling.id,
      "First",
      "Message 1.1",
      residentId,
      "RESIDENT"
    );
    await reply(db, convo1.id, "Message 1.2", adminAuth(seedAdminId, org.id));
    await reply(
      db,
      convo1.id,
      "Message 1.3",
      residentAuth(residentId, dwelling.id)
    );

    const convo2 = await createConversation(
      db,
      dwelling.id,
      "Second",
      "Message 2.1",
      residentId,
      "RESIDENT"
    );
    await reply(db, convo2.id, "Message 2.2", adminAuth(seedAdminId, org.id));

    await markConversationRead(db, org.id, convo1.id);

    const list = await listConversationsForOrganization(db, org.id);
    expect(list).toHaveLength(2);

    expect(list[0].id).toBe(convo2.id);
    expect(list[0].lastMessage?.body).toBe("Message 2.2");
    expect(list[0].hasUnread).toBe(true);

    expect(list[1].id).toBe(convo1.id);
    expect(list[1].lastMessage?.body).toBe("Message 1.3");
    expect(list[1].hasUnread).toBe(false);

    expect(new Date(list[0].updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(list[1].updatedAt).getTime()
    );

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
      residentId,
      "RESIDENT"
    );
    const convo2 = await createConversation(
      db,
      dwelling.id,
      "Second",
      "Body 2",
      residentId,
      "RESIDENT"
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

  it("a dual-role user's reply is attributed to whichever capability the conversation matched", async () => {
    const orgA = await createOrganization(
      db,
      { name: "IT-K Org Dual A", addressLine1: "Addr 1" },
      seedAdminId
    );
    const orgB = await createOrganization(
      db,
      { name: "IT-K Org Dual B", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwellingA = await createDwelling(
      db,
      orgA.id,
      { number: "1" },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      orgB.id,
      { number: "1" },
      seedAdminId
    );
    const residentA = await seedResident("it-k-resident-dual-a@example.com");
    const dualUserId = await seedResident("it-k-dual-user@example.com");
    const auth = dualAuth(dualUserId, orgB.id, dwellingA.id);

    // A conversation reachable via the dual user's DWELLING capability.
    const convoViaDwelling = await createConversation(
      db,
      dwellingA.id,
      "Via dwelling",
      "Hi",
      residentA,
      "RESIDENT"
    );
    await reply(db, convoViaDwelling.id, "Replying as resident", auth);

    // A conversation reachable via the dual user's ORG capability.
    const convoViaOrg = await createConversation(
      db,
      dwellingB.id,
      "Via org",
      "Hi",
      seedAdminId,
      "ADMIN"
    );
    await reply(db, convoViaOrg.id, "Replying as admin", auth);

    const dwellingMsgs = await listMessagesForConversation(
      db,
      convoViaDwelling.id
    );
    expect(dwellingMsgs.at(-1)?.senderRole).toBe("RESIDENT");

    const orgMsgs = await listMessagesForConversation(db, convoViaOrg.id);
    expect(orgMsgs.at(-1)?.senderRole).toBe("ADMIN");

    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
    await deleteAppUser(residentA);
    await deleteAppUser(dualUserId);
  });

  it("a person who is admin AND resident of the same dwelling replies as the screen they used", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-K Org Dual Same", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const dualUserId = await seedResident("it-k-dual-same@example.com");
    const both = dualAuth(dualUserId, org.id, dwelling.id);
    const onlyResident = residentAuth(dualUserId, dwelling.id);

    const convo = await createConversation(
      db,
      dwelling.id,
      "Both roles",
      "Hi",
      dualUserId,
      "RESIDENT"
    );
    const senderOf = async () =>
      (await listMessagesForConversation(db, convo.id)).at(-1)?.senderRole;

    await reply(db, convo.id, "from the portal", both, "RESIDENT");
    expect(await senderOf()).toBe("RESIDENT");

    await reply(db, convo.id, "from the inbox", both, "ADMIN");
    expect(await senderOf()).toBe("ADMIN");

    // No screen given: the old default, admin when the person can be one.
    await reply(db, convo.id, "no hint", both);
    expect(await senderOf()).toBe("ADMIN");

    // A forged value cannot grant a role the person does not hold.
    await reply(db, convo.id, "forged", onlyResident, "ADMIN");
    expect(await senderOf()).toBe("RESIDENT");

    await cleanupOrg(org.id);
    await deleteAppUser(dualUserId);
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
