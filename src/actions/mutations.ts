import { z } from "astro/zod";
import { lookupMutationReceipt } from "../domain/mutations/receipts";
import { withRequestDb as withDb } from "../lib/db-request";
import { orgAction } from "./_org-action";

export const mutations = {
  lookup: orgAction({
    allowArchived: true,
    input: z.object({
      organizationId: z.uuid(),
      clientMutationId: z.uuid(),
    }),
    handler: async ({ organizationId, clientMutationId }) => {
      return withDb((db) =>
        lookupMutationReceipt(db, organizationId, clientMutationId)
      );
    },
  }),
};
