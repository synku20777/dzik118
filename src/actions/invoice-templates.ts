// Phase G (Invoices/delivery) - invoice template settings (spec Section
// 22, 27). Separate file from billing.ts, whose own header comment scopes
// it to billing-rule CRUD and invoice generation/status actions.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import {
  requireActiveOrganization,
  requireOrganizationAccess,
} from "../domain/authorization/guards";
import { updateInvoiceTemplate } from "../domain/billing/invoice-templates";
import {
  buildPreviewLines,
  buildPreviewTotals,
  previewPeriodDateRange,
} from "../domain/billing/invoice-template-preview";
import { getEffectiveRules } from "../domain/billing/rules";
import { listPeriods } from "../domain/periods/periods";
import { NotFoundError } from "../domain/errors";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

export const invoiceTemplates = {
  // Read-only: the sample charges and dates the editor's preview shows for one
  // billing period, so switching the preview period needs no page reload (a
  // reload would throw away unsaved edits). Same functions as the page's own
  // first render.
  previewLines: defineAction({
    input: z.object({ organizationId: z.uuid(), periodId: z.uuid() }),
    handler: safeHandler(async ({ organizationId, periodId }, { locals }) => {
      requireOrganizationAccess(locals.auth, organizationId);
      return withDb(async (db) => {
        const period = (await listPeriods(db, organizationId)).find(
          (p) => p.id === periodId
        );
        if (!period) throw new NotFoundError("Billing period not found");
        const rules = await getEffectiveRules(
          db,
          organizationId,
          previewPeriodDateRange(period)
        );
        const sampleLines = buildPreviewLines(rules);
        return {
          periodId,
          issueDate: period.invoiceIssueDate,
          dueDate: period.invoiceDueDate,
          sampleLines,
          totals: buildPreviewTotals(sampleLines),
        };
      });
    }),
  }),

  update: defineAction({
    accept: "form",
    input: z.object({
      organizationId: z.uuid(),
      headerText: z.string().max(500).optional(),
      footerText: z.string().max(1000).optional(),
      paymentInstructions: z.string().max(1000).optional(),
      defaultNote: z.string().max(1000).optional(),
      // JSON-stringified InvoiceTemplateConfigV2 -- the editor sends its
      // whole document state as one field rather than dozens of individual
      // form fields. Parsed and strictly re-validated server-side in
      // updateInvoiceTemplate; client-side validation is convenience only.
      // Measured in UTF-8 bytes (not `z.string().max()`'s UTF-16 code
      // units), since multibyte input -- emoji, Cyrillic in a custom text
      // block -- can be up to 3x larger encoded than its JS string length.
      config: z
        .string()
        .refine((value) => new TextEncoder().encode(value).length <= 200_000, {
          message: "Template layout payload is too large",
        }),
    }),
    handler: safeHandler(
      async (
        {
          organizationId,
          headerText,
          footerText,
          paymentInstructions,
          defaultNote,
          config,
        },
        { locals }
      ) => {
        requireActiveOrganization(locals.auth, organizationId);
        let parsedConfig: unknown;
        try {
          parsedConfig = JSON.parse(config);
        } catch {
          parsedConfig = null;
        }
        return withDb((db) =>
          updateInvoiceTemplate(
            db,
            organizationId,
            {
              headerText: headerText ?? "",
              footerText: footerText ?? "",
              paymentInstructions: paymentInstructions ?? "",
              defaultNote: defaultNote ?? "",
              config: parsedConfig,
            },
            locals.auth!.userId
          )
        );
      }
    ),
  }),
};
