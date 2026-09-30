// A signed-in person edits their own profile (ADR 0009). The target is always
// the signed-in user, never an input.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireResidentRole } from "../domain/authorization/guards";
import {
  DISPLAY_NAME_MESSAGE,
  updateOwnDisplayName,
} from "../domain/privacy/profile";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

export const profile = {
  updateDisplayName: defineAction({
    accept: "form",
    input: z.object({
      displayName: z
        .string()
        .trim()
        .min(1, DISPLAY_NAME_MESSAGE)
        .max(100, DISPLAY_NAME_MESSAGE),
    }),
    handler: safeHandler(async ({ displayName }, { locals }) => {
      requireResidentRole(locals.auth);
      const userId = locals.auth.userId;
      const name = await withDb((db) =>
        updateOwnDisplayName(db, userId, displayName)
      );
      return { displayName: name };
    }),
  }),
};
