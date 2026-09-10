// Phase E (Periods/meters/readings) - Billing period actions (spec Section 10).
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import { createPeriod, lockPeriod } from "../domain/periods/periods";
import { safeHandler } from "./_errors";
import { withDb } from "./_db";

export const periods = {
  // PER-001
  create: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      year: z.coerce.number().int().min(2000).max(2200),
      month: z.coerce.number().int().min(1).max(12),
      startsOn: z.iso.date(),
      endsOn: z.iso.date(),
      readingDeadline: z.iso.date().optional(),
      invoiceIssueDate: z.iso.date(),
      invoiceDueDate: z.iso.date(),
    }),
    handler: safeHandler(async ({ organizationId, ...input }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        createPeriod(db, organizationId, input, locals.auth!.userId)
      );
    }),
  }),

  // PER-002
  lock: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, periodId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        lockPeriod(db, organizationId, periodId, locals.auth!.userId)
      );
    }),
  }),
};
