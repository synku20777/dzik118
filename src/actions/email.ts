// Suppressed email addresses (ADR 0008). Only removal is an action. Addresses
// are added by the SES events endpoint, never by a person.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireActiveOrganization } from "../domain/authorization/guards";
import { removeSuppression } from "../domain/email/suppression";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

export const emailSuppression = {
  remove: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      suppressionId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, suppressionId }, { locals }) => {
        requireActiveOrganization(locals.auth, organizationId);
        await withDb((db) =>
          removeSuppression(
            db,
            organizationId,
            suppressionId,
            locals.auth!.userId
          )
        );
        return { removed: true };
      }
    ),
  }),
};
