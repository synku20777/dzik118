// Phase J (Payments) - payment match confirm/reject actions (spec Section
// 10, PAY-003). The CSV upload/preview/confirm flow itself is a plain page
// (src/pages/admin/o/[orgId]/payments/import.astro), not an action, for
// the same reason the dwellings CSV import is: raw multipart file upload
// doesn't fit an action's input shape.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import { confirmMatch, rejectMatch } from "../domain/payments/matching";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

export const payments = {
  confirmMatch: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      matchId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, matchId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        confirmMatch(db, organizationId, matchId, locals.auth!.userId)
      );
    }),
  }),

  rejectMatch: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      matchId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, matchId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        rejectMatch(db, organizationId, matchId, locals.auth!.userId)
      );
    }),
  }),
};
