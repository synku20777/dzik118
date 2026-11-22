// Phase E (Periods/meters/readings) - Billing period actions (spec Section 10).
import { z } from "astro/zod";
import {
  addDwellingToPeriod,
  createPeriod,
  lockPeriod,
  reopenPeriod,
} from "../domain/periods/periods";
import { withRequestDb as withDb } from "../lib/db-request";
import { orgAction } from "./_org-action";

export const periods = {
  // PER-001
  create: orgAction({
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
    handler: async ({ organizationId, ...input }, { locals }) => {
      return withDb((db) =>
        createPeriod(db, organizationId, input, locals.auth!.userId)
      );
    },
  }),

  // PER-002
  lock: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
    }),
    handler: async ({ organizationId, periodId }, { locals }) => {
      return withDb((db) =>
        lockPeriod(db, organizationId, periodId, locals.auth!.userId)
      );
    },
  }),

  reopen: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
    }),
    handler: async ({ organizationId, periodId }, { locals }) => {
      return withDb((db) =>
        reopenPeriod(db, organizationId, periodId, locals.auth!.userId)
      );
    },
  }),

  // Retroactive billing: give a dwelling a billing case in this period.
  addDwelling: orgAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
      dwellingId: z.uuid(),
    }),
    handler: async ({ organizationId, periodId, dwellingId }, { locals }) => {
      return withDb((db) =>
        addDwellingToPeriod(
          db,
          organizationId,
          periodId,
          dwellingId,
          locals.auth!.userId
        )
      );
    },
  }),
};
