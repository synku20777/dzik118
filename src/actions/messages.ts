// Phase K (Messaging) - conversation actions (spec Section 10, MSG-001/002).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import {
  ForbiddenError,
  requireDwellingAccess,
  requireOrganizationAccess,
} from "../domain/authorization/guards";
import { getDwelling } from "../domain/organizations/dwellings";
import {
  createConversation,
  getConversationForAdmin,
  listMessagesForConversation,
  markConversationRead,
  reply,
  resolveConversation,
} from "../domain/messaging/conversations";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

export const messages = {
  createConversation: defineAction({
    accept: "form",
    input: z.object({
      dwellingId: z.uuid(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(4000),
    }),
    handler: safeHandler(async ({ dwellingId, subject, body }, { locals }) => {
      requireDwellingAccess(locals.auth, dwellingId);
      return withDb((db) =>
        createConversation(db, dwellingId, subject, body, locals.auth!.userId)
      );
    }),
  }),

  // Admin-initiated counterpart to createConversation above (same
  // role-split shape as readings.submitAdmin/submitResident) -- the
  // dwelling is looked up scoped to organizationId first so an admin
  // can't originate a conversation for a dwelling outside their org, the
  // same tenant-scoped-query pattern used everywhere else in this app.
  createConversationAdmin: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      dwellingId: z.uuid(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(4000),
    }),
    handler: safeHandler(
      async ({ organizationId, dwellingId, subject, body }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb(async (db) => {
          await getDwelling(db, organizationId, dwellingId);
          return createConversation(
            db,
            dwellingId,
            subject,
            body,
            locals.auth!.userId
          );
        });
      }
    ),
  }),

  // Both admin and resident call this one action (spec Section 10 lists a
  // single messages.reply, unlike readings' role-split pair) -- the domain
  // layer checks the caller's role against the conversation it loads,
  // since which of organizationId/dwellingId applies isn't known here.
  reply: defineAction({
    accept: "form",
    input: z.object({
      conversationId: z.uuid(),
      body: z.string().min(1).max(4000),
    }),
    handler: safeHandler(async ({ conversationId, body }, { locals }) => {
      if (!locals.auth) throw new ForbiddenError();
      return withDb((db) => reply(db, conversationId, body, locals.auth!));
    }),
  }),

  // JSON action (no `accept: "form"`), polled from the client while an
  // admin has a conversation open -- lets the thread and status update
  // live without a full page reload. Marking read here too (not just on
  // the page's initial load) keeps the unread state correct for as long
  // as the admin keeps the conversation open, matching a normal chat's
  // read-receipt behavior.
  getThread: defineAction({
    input: z.object({
      organizationId: z.uuid(),
      conversationId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, conversationId }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb(async (db) => {
          const conversation = await getConversationForAdmin(
            db,
            organizationId,
            conversationId
          );
          await markConversationRead(db, organizationId, conversationId);
          const messagesList = await listMessagesForConversation(
            db,
            conversationId
          );
          return {
            status: conversation.status,
            occupantName: conversation.occupantName,
            messages: messagesList,
          };
        });
      }
    ),
  }),

  resolve: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      conversationId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, conversationId }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          resolveConversation(
            db,
            organizationId,
            conversationId,
            locals.auth!.userId
          )
        );
      }
    ),
  }),
};
