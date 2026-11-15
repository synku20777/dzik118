// Suppressed email addresses (ADR 0008). Only removal is an action. Addresses
// are added by the SES events endpoint, never by a person.
import { z } from "astro/zod";
import { removeSuppression } from "../domain/email/suppression";
import { withRequestDb as withDb } from "../lib/db-request";
import { orgAction } from "./_org-action";

export const emailSuppression = {
  remove: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      suppressionId: z.uuid(),
    }),
    handler: async ({ organizationId, suppressionId }, { locals }) => {
      await withDb((db) =>
        removeSuppression(
          db,
          organizationId,
          suppressionId,
          locals.auth!.userId
        )
      );
      return { removed: true };
    },
  }),
};
