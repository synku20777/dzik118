// Phase D (Organizations/dwellings) - Organization actions (spec Section 10).
// Astro Actions are network-accessible regardless of which page calls them
// (spec Section 10), so every handler re-checks auth/org access itself --
// it never trusts that the caller only reached this via an /admin page.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import {
  requireAdminRole,
  requireOrganizationAccess,
} from "../domain/authorization/guards";
import {
  addAdminMembership,
  createOrganization,
  removeAdminMembership,
  updateOrganization,
} from "../domain/organizations/organizations";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";
import { getSupabaseAdmin } from "./_supabase_admin";

const organizationFields = {
  name: z.string().min(1).max(200),
  addressLine1: z.string().min(1).max(300),
  addressLine2: z.string().max(300).optional(),
  city: z.string().max(200).optional(),
  postalCode: z.string().max(50).optional(),
  countryCode: z.string().length(2).optional(),
  email: z.email().max(320).optional(),
  phone: z.string().max(50).optional(),
  bankName: z.string().max(200).optional(),
  iban: z.string().max(50).optional(),
  bic: z.string().max(20).optional(),
};

export const organizations = {
  // ORG-001
  create: defineAction({
    accept: "form",
    input: z.object(organizationFields),
    handler: safeHandler(async (input, { locals }) => {
      requireAdminRole(locals.auth);
      return withDb((db) => createOrganization(db, input, locals.auth!.userId));
    }),
  }),

  // ORG-002
  update: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      ...organizationFields,
      name: organizationFields.name.optional(),
      addressLine1: organizationFields.addressLine1.optional(),
      currency: z.string().length(3).optional(),
      timezone: z.string().max(100).optional(),
      locale: z.string().max(10).optional(),
      invoicePrefix: z.string().min(1).max(20).optional(),
      defaultDueDays: z.number().int().min(0).max(120).optional(),
      autoGenerateEnabled: z.boolean().optional(),
      autoSendEnabled: z.boolean().optional(),
      autoSendDay: z.number().int().min(1).max(28).nullable().optional(),
    }),
    handler: safeHandler(async ({ organizationId, ...input }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        updateOrganization(db, organizationId, input, locals.auth!.userId)
      );
    }),
  }),

  addAdminMember: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      email: z.email(),
    }),
    handler: safeHandler(async ({ organizationId, email }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb((db) =>
        addAdminMembership(
          db,
          organizationId,
          email,
          locals.auth!.userId,
          getSupabaseAdmin()
        )
      );
    }),
  }),

  removeAdminMember: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      userId: z.uuid(),
    }),
    handler: safeHandler(async ({ organizationId, userId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      await withDb((db) =>
        removeAdminMembership(db, organizationId, userId, locals.auth!.userId)
      );
    }),
  }),
};
