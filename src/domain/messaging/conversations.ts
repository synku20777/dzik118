// Phase K (Messaging) - resident/admin conversations (spec Section 13.19,
// 35 MSG-001/002). createConversation is resident-only and resolve is
// admin-only, so their guards run in the action layer as usual (spec
// Section 14). reply() is the one operation both roles call through a
// single action (spec Section 10 lists one `messages.reply`, not a
// role-split pair like readings.submitAdmin/submitResident) -- so, unlike
// every other domain function here, it takes the caller's full AuthContext
// and does its own role-based tenant/dwelling check after loading the
// conversation, since which check applies isn't known until then.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import type { AuthContext } from "../authorization/context";
import { conversations, messages } from "../../db/schema/messaging";
import { appUsers } from "../../db/schema/auth";
import { dwellings } from "../../db/schema/dwellings";
import { recordAuditEvent } from "../../lib/logging/audit";
import { NotFoundError } from "../errors";

export { NotFoundError };

export async function createConversation(
  db: Db,
  dwellingId: string,
  subject: string,
  body: string,
  residentUserId: string
) {
  const [dwelling] = await db
    .select({ organizationId: dwellings.organizationId })
    .from(dwellings)
    .where(eq(dwellings.id, dwellingId))
    .limit(1);
  if (!dwelling) throw new NotFoundError("Dwelling not found");

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({
        organizationId: dwelling.organizationId,
        dwellingId,
        subject,
        createdByUserId: residentUserId,
      })
      .returning();
    await tx.insert(messages).values({
      organizationId: dwelling.organizationId,
      conversationId: conversation.id,
      senderUserId: residentUserId,
      body,
    });
    await recordAuditEvent(tx, {
      organizationId: dwelling.organizationId,
      actorUserId: residentUserId,
      action: "CONVERSATION_CREATED",
      entityType: "conversation",
      entityId: conversation.id,
      afterData: { subject },
    });
    return conversation;
  });
}

export async function reply(
  db: Db,
  conversationId: string,
  body: string,
  auth: AuthContext
) {
  // The tenant/dwelling check is baked into the WHERE clause itself (not a
  // separate check after an unscoped read): a foreign conversation and a
  // nonexistent one must look identical (NotFoundError, never Forbidden) --
  // spec Section 11, "do not expose whether a foreign tenant resource
  // exists". The row is also locked here, in the same transaction as the
  // status update below, so a concurrent resolveConversation() can't be
  // raced and overwritten by a reply computed from a stale status.
  const scopeIds =
    auth.role === "ADMIN" ? auth.organizationIds : auth.dwellingIds;
  if (scopeIds.length === 0) throw new NotFoundError("Conversation not found");
  const scopeColumn =
    auth.role === "ADMIN"
      ? conversations.organizationId
      : conversations.dwellingId;

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          inArray(scopeColumn, scopeIds)
        )
      )
      .for("update")
      .limit(1);
    if (!conversation) throw new NotFoundError("Conversation not found");

    const [message] = await tx
      .insert(messages)
      .values({
        organizationId: conversation.organizationId,
        conversationId,
        senderUserId: auth.userId,
        body,
      })
      .returning();
    // A NEW conversation (nobody has responded yet) becomes OPEN on its
    // first reply from either side; RESOLVED never auto-reopens -- spec
    // Section 10 has no separate "reopen" action, so a closed conversation
    // stays closed until an admin explicitly resolves a fresh one.
    await tx
      .update(conversations)
      .set({
        status: conversation.status === "NEW" ? "OPEN" : conversation.status,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
    await recordAuditEvent(tx, {
      organizationId: conversation.organizationId,
      actorUserId: auth.userId,
      action: "MESSAGE_SENT",
      entityType: "message",
      entityId: message.id,
      afterData: { conversationId },
    });
    return message;
  });
}

// Idempotent the same way Phase J's confirmMatch/rejectMatch are:
// resolving an already-resolved conversation is a safe no-op.
export async function resolveConversation(
  db: Db,
  organizationId: string,
  conversationId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!conversation) throw new NotFoundError("Conversation not found");
    if (conversation.status === "RESOLVED") return conversation;

    const [resolved] = await tx
      .update(conversations)
      .set({
        status: "RESOLVED",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId))
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "CONVERSATION_RESOLVED",
      entityType: "conversation",
      entityId: conversationId,
      afterData: resolved,
    });
    return resolved;
  });
}

export interface ListConversationsOptions {
  dwellingId?: string;
}

// Returns each conversation's last message and unread flag alongside its
// own fields, so the inbox list can show a preview snippet and an unread
// dot without a per-row query -- same two-query shape as
// listConversationsWithMessagesForDwelling below, just aggregated instead
// of returning every message.
export async function listConversationsForOrganization(
  db: Db,
  organizationId: string,
  options: ListConversationsOptions = {}
) {
  const conditions = [eq(conversations.organizationId, organizationId)];
  if (options.dwellingId)
    conditions.push(eq(conversations.dwellingId, options.dwellingId));

  const rows = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      status: conversations.status,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      dwellingId: conversations.dwellingId,
      dwellingNumber: dwellings.number,
      occupantName: dwellings.occupantName,
    })
    .from(conversations)
    .innerJoin(dwellings, eq(dwellings.id, conversations.dwellingId))
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt));
  if (rows.length === 0) return [];

  const allMessages = await db
    .select()
    .from(messages)
    .where(
      inArray(
        messages.conversationId,
        rows.map((r) => r.id)
      )
    )
    .orderBy(messages.createdAt);

  const messagesByConversation = new Map<string, typeof allMessages>();
  for (const m of allMessages) {
    const list = messagesByConversation.get(m.conversationId) ?? [];
    list.push(m);
    messagesByConversation.set(m.conversationId, list);
  }

  return rows.map((row) => {
    const convoMessages = messagesByConversation.get(row.id) ?? [];
    return {
      ...row,
      lastMessage: convoMessages[convoMessages.length - 1] ?? null,
      hasUnread: convoMessages.some((m) => !m.readAt),
    };
  });
}

export async function getConversationForAdmin(
  db: Db,
  organizationId: string,
  conversationId: string
) {
  const [conversation] = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      status: conversations.status,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      dwellingId: conversations.dwellingId,
      dwellingNumber: dwellings.number,
      dwellingType: dwellings.type,
      dwellingAreaM2: dwellings.areaM2,
      occupantName: dwellings.occupantName,
    })
    .from(conversations)
    .innerJoin(dwellings, eq(dwellings.id, conversations.dwellingId))
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!conversation) throw new NotFoundError("Conversation not found");
  return conversation;
}

// Joins appUsers for senderRole only (not the sender's own name) -- the
// inbox displays a resident sender as the dwelling's occupant name (already
// available from the conversation) and an admin sender generically as
// "Admin", regardless of which admin account sent it.
export async function listMessagesForConversation(
  db: Db,
  conversationId: string
) {
  return db
    .select({
      id: messages.id,
      body: messages.body,
      createdAt: messages.createdAt,
      readAt: messages.readAt,
      senderUserId: messages.senderUserId,
      senderRole: appUsers.role,
    })
    .from(messages)
    .innerJoin(appUsers, eq(appUsers.id, messages.senderUserId))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

// Called when an admin opens a conversation -- marks every unread message
// in it as read. Scoped by organizationId in the same query (not a
// separate check after an unscoped read) so a foreign conversation is a
// silent no-op rather than a cross-tenant write.
export async function markConversationRead(
  db: Db,
  organizationId: string,
  conversationId: string
) {
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.organizationId, organizationId),
        isNull(messages.readAt)
      )
    );
}

// Resident-facing single page shows every one of the dwelling's
// conversations as a full thread at once (spec's route table has no
// per-conversation resident URL) -- fetches all messages for every
// conversation in two queries total, not one query per conversation.
export async function listConversationsWithMessagesForDwelling(
  db: Db,
  dwellingId: string
) {
  const convos = await db
    .select()
    .from(conversations)
    .where(eq(conversations.dwellingId, dwellingId))
    .orderBy(desc(conversations.updatedAt));
  if (convos.length === 0) return [];

  const allMessages = await db
    .select()
    .from(messages)
    .where(
      inArray(
        messages.conversationId,
        convos.map((c) => c.id)
      )
    )
    .orderBy(messages.createdAt);

  const messagesByConversation = new Map<string, typeof allMessages>();
  for (const m of allMessages) {
    const list = messagesByConversation.get(m.conversationId) ?? [];
    list.push(m);
    messagesByConversation.set(m.conversationId, list);
  }

  return convos.map((conversation) => ({
    conversation,
    messages: messagesByConversation.get(conversation.id) ?? [],
  }));
}
