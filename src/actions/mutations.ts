import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import { lookupMutationReceipt } from "../domain/mutations/receipts";
import { withRequestDb as withDb } from "../lib/db-request";
import { safeHandler } from "./_errors";

export const mutations = {
  lookup: defineAction({
    input: z.object({
      organizationId: z.uuid(),
      clientMutationId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, clientMutationId }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb((db) =>
          lookupMutationReceipt(db, organizationId, clientMutationId)
        );
      }
    ),
  }),
};
