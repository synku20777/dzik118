// Phase K (Messaging) - conversation actions (spec Section 10, MSG-001/002).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import {
  ForbiddenError,
  requireDwellingAccess,
  requireOrganizationAccess,
} from "../domain/authorization/guards";
import {
  createConversation,
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
