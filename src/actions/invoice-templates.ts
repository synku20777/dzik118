// Phase G (Invoices/delivery) - invoice template settings (spec Section
// 22, 27). Separate file from billing.ts, whose own header comment scopes
// it to billing-rule CRUD and invoice generation/status actions.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import { updateInvoiceTemplate } from "../domain/billing/invoice-templates";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

export const invoiceTemplates = {
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
        requireOrganizationAccess(locals.auth, organizationId);
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
