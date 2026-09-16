// Phase G (Invoices/delivery) - invoice_templates get/upsert (spec Section
// 22, 27 "invoice template"). One row per organization (organization_id is
// UNIQUE), edited by an admin, may not exist yet. Same upsert+audit shape as
// src/domain/periods/manual-rule-inputs.ts's submitManualRuleInput, just a
// single-column conflict target instead of a composite one.
//
// Never touches an existing invoice's templateSnapshot: that's a one-time
// copy made in generation.ts at generation time (spec Section 21
// immutability), never a live join back to this table.
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { invoiceTemplates } from "../../db/schema/invoices";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ValidationError } from "../errors";
import {
  createDefaultInvoiceTemplateConfig,
  invoiceTemplateConfigV1Schema,
  type InvoiceTemplateConfigV1,
} from "./invoice-template-schema";

export { ValidationError };

export async function getInvoiceTemplate(db: Db, organizationId: string) {
  const [template] = await db
    .select()
    .from(invoiceTemplates)
    .where(eq(invoiceTemplates.organizationId, organizationId))
    .limit(1);
  return template ?? null;
}

export interface ResolvedInvoiceTemplate {
  headerText: string;
  footerText: string;
  paymentInstructions: string;
  defaultNote: string;
  config: InvoiceTemplateConfigV1;
}

// Always returns a complete object, whether or not a row exists yet, so the
// settings page/editor never special-cases "no row yet".
export async function getResolvedInvoiceTemplate(
  db: Db,
  organizationId: string
): Promise<ResolvedInvoiceTemplate> {
  const template = await getInvoiceTemplate(db, organizationId);
  return {
    headerText: template?.headerText ?? "",
    footerText: template?.footerText ?? "",
    paymentInstructions: template?.paymentInstructions ?? "",
    defaultNote: template?.defaultNote ?? "",
    config: template
      ? (invoiceTemplateConfigV1Schema.safeParse(template.config).data ??
        createDefaultInvoiceTemplateConfig())
      : createDefaultInvoiceTemplateConfig(),
  };
}

export interface InvoiceTemplateInput {
  headerText: string;
  footerText: string;
  paymentInstructions: string;
  defaultNote: string;
  config: unknown;
}

// Strict validation on write (unlike parseInvoiceTemplateConfig's lenient
// read-path fallback): this is the admin's own just-edited config, so a
// malformed payload should come back as a clear error, not silently reset
// their whole layout to the default.
export async function updateInvoiceTemplate(
  db: Db,
  organizationId: string,
  input: InvoiceTemplateInput,
  actorUserId: string
) {
  const configResult = invoiceTemplateConfigV1Schema.safeParse(input.config);
  if (!configResult.success) {
    throw new ValidationError(
      configResult.error.issues[0]?.message ?? "Invalid template layout"
    );
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(invoiceTemplates)
      .where(eq(invoiceTemplates.organizationId, organizationId))
      .limit(1);

    const values = {
      headerText: input.headerText || null,
      footerText: input.footerText || null,
      paymentInstructions: input.paymentInstructions || null,
      defaultNote: input.defaultNote || null,
      config: configResult.data,
      updatedAt: new Date(),
    };

    // logoObjectKey is never listed in `values` above, so onConflictDoUpdate
    // never touches it -- logo upload is still out of scope for this
    // feature and must not be nulled out by an unrelated text/layout save.
    const [template] = await tx
      .insert(invoiceTemplates)
      .values({ organizationId, ...values })
      .onConflictDoUpdate({
        target: invoiceTemplates.organizationId,
        set: values,
      })
      .returning();

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: existing
        ? "INVOICE_TEMPLATE_UPDATED"
        : "INVOICE_TEMPLATE_CREATED",
      entityType: "invoice_template",
      entityId: template.id,
      beforeData: existing,
      afterData: template,
    });

    return template;
  });
}
