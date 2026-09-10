// Phase F (Billing) - Invoice generation, bulk generation, prepare, and the
// manual status override escape hatch (spec Section 19/20/21, INV-001/002/004).
//
// MANUAL_QUANTITY/MANUAL_AMOUNT rules (spec Section 18) need a per-case admin
// input that has no persisted home anywhere in the schema yet (no UI or
// table field captures "admin supplies quantity/amount for dwelling X,
// period Y"). Building that input mechanism is real, undefined-by-spec
// scope on its own; until it exists, those rules are skipped during
// generation rather than guessed at.
import { and, eq, like } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import {
  billingCases,
  billingPeriods,
  meterReadings,
} from "../../db/schema/billing";
import { dwellings, meters } from "../../db/schema/dwellings";
import {
  invoiceLines,
  invoices,
  invoiceTemplates,
} from "../../db/schema/invoices";
import { organizations } from "../../db/schema/organizations";
import {
  addExact,
  multiplyAndRound,
  percentOf,
  sumExact,
} from "../../lib/decimal2";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { wasMeterActiveDuringPeriod } from "../periods/case-readiness";
import { getEffectiveRules } from "./rules";

export { ConflictError, NotFoundError, ValidationError };

const SEQUENCE_DIGITS = 5;

// Caller must already hold the organization row lock (FOR UPDATE) for the
// duration of this transaction -- that's what actually serializes this
// per spec Section 20's "concurrency-safe", not anything in this function.
async function nextInvoiceNumber(
  tx: Tx,
  organizationId: string,
  invoicePrefix: string,
  period: { year: number; month: number }
): Promise<string> {
  const yyyymm = `${period.year}${String(period.month).padStart(2, "0")}`;
  const prefixPattern = `${invoicePrefix}-${yyyymm}-%`;
  const existing = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        like(invoices.invoiceNumber, prefixPattern)
      )
    );
  const sequence = existing.length + 1;
  return `${invoicePrefix}-${yyyymm}-${String(sequence).padStart(SEQUENCE_DIGITS, "0")}`;
}

type EffectiveRule = Awaited<ReturnType<typeof getEffectiveRules>>[number];

// Returns null when the rule doesn't apply to this dwelling at all (no
// meter of the configured type during this period) -- the caller skips
// the line entirely rather than billing a bogus zero. Throws for
// MANUAL_QUANTITY/MANUAL_AMOUNT rather than silently skipping them: there
// is nowhere yet that persists an admin-supplied per-case quantity/amount
// for these (see the module-level comment), so silently omitting the line
// would generate an invoice that looks complete but is missing a charge --
// worse than blocking generation until the rule is disabled.
async function computeQuantity(
  tx: Tx,
  rule: EffectiveRule,
  dwelling: typeof dwellings.$inferSelect,
  period: { id: string; startsOn: string; endsOn: string }
): Promise<string | null> {
  switch (rule.calculationType) {
    case "FIXED":
      return "1";
    case "AREA":
      return dwelling.areaM2;
    case "RESIDENT_COUNT":
      return String(dwelling.residentCount);
    case "METER_CONSUMPTION": {
      if (!rule.meterType) return null;
      const rows = await tx
        .select({
          consumption: meterReadings.consumption,
          installedAt: meters.installedAt,
          archivedAt: meters.archivedAt,
        })
        .from(meterReadings)
        .innerJoin(meters, eq(meters.id, meterReadings.meterId))
        .where(
          and(
            eq(meterReadings.periodId, period.id),
            eq(meters.dwellingId, dwelling.id),
            eq(meters.type, rule.meterType)
          )
        );
      const active = rows.filter((m) => wasMeterActiveDuringPeriod(m, period));
      if (active.length === 0) return null;
      return sumExact(active.map((r) => r.consumption));
    }
    case "MANUAL_QUANTITY":
    case "MANUAL_AMOUNT":
      throw new ValidationError(
        `The rule "${rule.name}" requires a manually supplied ${rule.calculationType === "MANUAL_QUANTITY" ? "quantity" : "amount"}, which isn't supported by automatic generation yet; disable or archive this rule to generate this invoice`
      );
  }
}

// INV-001. A billing_case with existing missing_data is rejected outright
// (spec Section 19: "MISSING_DATA: invoice cannot be generated"). Calling
// this again while the case is still DRAFT regenerates in place (same
// invoice id/number, version += 1) rather than erroring or duplicating --
// spec Section 19's "DRAFT: invoice exists and may be regenerated" and
// INV-001's "retry does not duplicate".
export async function generateInvoice(
  db: Db,
  organizationId: string,
  periodId: string,
  dwellingId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    // FOR UPDATE: serializes invoice-number sequencing per organization
    // against any other concurrent generation for the same org.
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for("update")
      .limit(1);
    if (!org) throw new NotFoundError("Organization not found");

    const [period] = await tx
      .select()
      .from(billingPeriods)
      .where(
        and(
          eq(billingPeriods.id, periodId),
          eq(billingPeriods.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!period) throw new NotFoundError("Billing period not found");
    // Spec Section 16: "LOCKED period blocks ... invoice regeneration".
    // Applies to first-time generation too -- locking a period is meant to
    // freeze it, not just protect invoices that already existed.
    if (period.status === "LOCKED") {
      throw new ConflictError("This billing period is locked");
    }

    const [billingCase] = await tx
      .select()
      .from(billingCases)
      .where(
        and(
          eq(billingCases.periodId, periodId),
          eq(billingCases.dwellingId, dwellingId)
        )
      )
      .for("update")
      .limit(1);
    if (!billingCase) {
      throw new NotFoundError(
        "No billing case exists for this dwelling in this period"
      );
    }
    if ((billingCase.missingData as unknown[]).length > 0) {
      throw new ConflictError(
        "This dwelling has missing data for this period and cannot be invoiced yet"
      );
    }
    if (
      billingCase.status !== "MISSING_DATA" &&
      billingCase.status !== "DRAFT"
    ) {
      throw new ConflictError(
        `Cannot generate an invoice for a case in ${billingCase.status} status`
      );
    }

    const [dwelling] = await tx
      .select()
      .from(dwellings)
      .where(
        and(
          eq(dwellings.id, dwellingId),
          eq(dwellings.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!dwelling) throw new NotFoundError("Dwelling not found");

    const rules = await getEffectiveRules(tx, organizationId, period);

    const lineInputs: Array<{ rule: EffectiveRule; quantity: string }> = [];
    for (const rule of rules) {
      const quantity = await computeQuantity(tx, rule, dwelling, period);
      if (quantity === null) continue;
      lineInputs.push({ rule, quantity });
    }
    if (lineInputs.length === 0) {
      throw new ValidationError(
        "No billable rules produced a line item for this dwelling in this period"
      );
    }

    const lines = lineInputs.map(({ rule, quantity }, index) => {
      const unitPrice = rule.unitPrice ?? "0";
      const netAmount = multiplyAndRound(quantity, unitPrice, 2);
      const vatAmount = percentOf(netAmount, rule.vatRate, 2);
      const grossAmount = addExact(netAmount, vatAmount);
      return {
        billingRuleId: rule.id,
        sortOrder: index,
        description: rule.name,
        calculationType: rule.calculationType,
        sourceSnapshot: rule,
        unit: rule.unit,
        quantity,
        unitPrice,
        vatRate: rule.vatRate,
        netAmount,
        vatAmount,
        grossAmount,
      };
    });

    const subtotal = sumExact(lines.map((l) => l.netAmount));
    const vatTotal = sumExact(lines.map((l) => l.vatAmount));
    const total = addExact(subtotal, vatTotal);

    const issuerSnapshot = {
      name: org.name,
      registrationNumber: org.registrationNumber,
      vatNumber: org.vatNumber,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      city: org.city,
      postalCode: org.postalCode,
      countryCode: org.countryCode,
      email: org.email,
      phone: org.phone,
    };
    const paymentSnapshot = {
      bankName: org.bankName,
      iban: org.iban,
      bic: org.bic,
      currency: org.currency,
    };
    const recipientSnapshot = {
      dwellingNumber: dwelling.number,
      displayName: dwelling.displayName,
      occupantName: dwelling.occupantName,
      billingName: dwelling.billingName,
      billingEmail: dwelling.billingEmail,
      billingAddress: dwelling.billingAddress,
    };
    const [templateRow] = await tx
      .select()
      .from(invoiceTemplates)
      .where(eq(invoiceTemplates.organizationId, organizationId))
      .limit(1);
    const templateSnapshot = templateRow ?? {};

    const [existingInvoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.billingCaseId, billingCase.id))
      .limit(1);

    let invoice: typeof invoices.$inferSelect;
    if (existingInvoice) {
      // Checked independently of billingCase.status: a manual status
      // override (overrideCaseStatus) can move a case's *status* back to
      // DRAFT for workflow-tracking reasons, but spec Section 21 makes the
      // *invoice row* itself immutable once sent/paid, unconditionally --
      // status is not the source of truth for that guarantee.
      if (existingInvoice.sentAt || existingInvoice.paidAt) {
        throw new ConflictError(
          "This invoice has already been sent and can no longer be regenerated; issue a correction document instead"
        );
      }
      if (billingCase.status !== "DRAFT") {
        throw new ConflictError(
          "This invoice has already moved past DRAFT and can no longer be regenerated"
        );
      }
      await tx
        .delete(invoiceLines)
        .where(eq(invoiceLines.invoiceId, existingInvoice.id));
      [invoice] = await tx
        .update(invoices)
        .set({
          subtotal,
          vatTotal,
          total,
          issuerSnapshot,
          recipientSnapshot,
          paymentSnapshot,
          templateSnapshot,
          issueDate: period.invoiceIssueDate,
          dueDate: period.invoiceDueDate,
          version: existingInvoice.version + 1,
          // Clear any canonical PDF from the prior version -- otherwise a
          // future send would see pdfObjectKey/pdfSha256 already set and
          // skip regenerating, emailing a PDF for stale line/total data.
          pdfObjectKey: null,
          pdfSha256: null,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, existingInvoice.id))
        .returning();
    } else {
      const invoiceNumber = await nextInvoiceNumber(
        tx,
        organizationId,
        org.invoicePrefix,
        period
      );
      [invoice] = await tx
        .insert(invoices)
        .values({
          organizationId,
          billingCaseId: billingCase.id,
          dwellingId,
          periodId,
          invoiceNumber,
          issueDate: period.invoiceIssueDate,
          dueDate: period.invoiceDueDate,
          currency: org.currency,
          subtotal,
          vatTotal,
          total,
          issuerSnapshot,
          recipientSnapshot,
          paymentSnapshot,
          templateSnapshot,
        })
        .returning();
    }

    await tx
      .insert(invoiceLines)
      .values(
        lines.map((l) => ({ ...l, organizationId, invoiceId: invoice.id }))
      );

    await tx
      .update(billingCases)
      .set({ status: "DRAFT", statusUpdatedAt: new Date() })
      .where(eq(billingCases.id, billingCase.id));

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: existingInvoice ? "INVOICE_REGENERATED" : "INVOICE_GENERATED",
      entityType: "invoice",
      entityId: invoice.id,
      afterData: invoice,
    });

    return invoice;
  });
}

export interface BulkGenerateResult {
  generated: string[];
  skipped: { dwellingId: string; reason: string }[];
}

// INV-002: each case generates in its own transaction (via generateInvoice)
// so one dwelling's failure doesn't roll back the others in the batch.
export async function bulkGenerateInvoices(
  db: Db,
  organizationId: string,
  periodId: string,
  actorUserId: string
): Promise<BulkGenerateResult> {
  const cases = await db
    .select()
    .from(billingCases)
    .where(
      and(
        eq(billingCases.periodId, periodId),
        eq(billingCases.organizationId, organizationId)
      )
    );

  const result: BulkGenerateResult = { generated: [], skipped: [] };
  for (const billingCase of cases) {
    if ((billingCase.missingData as unknown[]).length > 0) {
      result.skipped.push({
        dwellingId: billingCase.dwellingId,
        reason: "Missing required readings",
      });
      continue;
    }
    if (
      billingCase.status !== "MISSING_DATA" &&
      billingCase.status !== "DRAFT"
    ) {
      result.skipped.push({
        dwellingId: billingCase.dwellingId,
        reason: `Already ${billingCase.status}`,
      });
      continue;
    }
    try {
      await generateInvoice(
        db,
        organizationId,
        periodId,
        billingCase.dwellingId,
        actorUserId
      );
      result.generated.push(billingCase.dwellingId);
    } catch (err) {
      result.skipped.push({
        dwellingId: billingCase.dwellingId,
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }
  return result;
}

async function loadInvoiceAndLines(
  db: Db,
  invoice: typeof invoices.$inferSelect
) {
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoice.id))
    .orderBy(invoiceLines.sortOrder);
  const [billingCase] = await db
    .select({ id: billingCases.id, status: billingCases.status })
    .from(billingCases)
    .where(eq(billingCases.id, invoice.billingCaseId))
    .limit(1);
  return { invoice, lines, caseStatus: billingCase?.status ?? null };
}

export async function getInvoice(
  db: Db,
  organizationId: string,
  invoiceId: string
) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!invoice) throw new NotFoundError("Invoice not found");
  return loadInvoiceAndLines(db, invoice);
}

// Resident-facing: dwellingId is the resident's already-access-checked
// dwelling (requireDwellingAccess ran in the caller), same convention as
// getDwellingForResident (Phase E). A valid invoice id for a *different*
// dwelling is rejected as not found, not forbidden, so a resident can't
// probe which invoice ids exist elsewhere.
export async function getInvoiceForResident(
  db: Db,
  invoiceId: string,
  dwellingId: string
) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.dwellingId, dwellingId)))
    .limit(1);
  if (!invoice) throw new NotFoundError("Invoice not found");
  return loadInvoiceAndLines(db, invoice);
}

export async function listInvoicesForDwelling(db: Db, dwellingId: string) {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.dwellingId, dwellingId))
    .orderBy(invoices.issueDate);
}

// INV-004: normal transition only from DRAFT.
export async function prepareInvoice(
  db: Db,
  organizationId: string,
  invoiceId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!invoice) throw new NotFoundError("Invoice not found");

    const [billingCase] = await tx
      .select()
      .from(billingCases)
      .where(eq(billingCases.id, invoice.billingCaseId))
      .limit(1);
    if (!billingCase || billingCase.status !== "DRAFT") {
      throw new ConflictError("Only a DRAFT invoice can be prepared");
    }

    const issuer = invoice.issuerSnapshot as Record<string, unknown>;
    const recipient = invoice.recipientSnapshot as Record<string, unknown>;
    const payment = invoice.paymentSnapshot as Record<string, unknown>;
    if (!issuer.name || !issuer.addressLine1) {
      throw new ValidationError(
        "Issuer details are incomplete; update organization settings before preparing"
      );
    }
    if (
      (!recipient.billingName && !recipient.occupantName) ||
      !recipient.billingAddress
    ) {
      throw new ValidationError(
        "This dwelling is missing a billing/occupant name or a billing address"
      );
    }
    if (!payment.iban || !payment.bankName) {
      throw new ValidationError(
        "Organization payment details are incomplete (both bank name and IBAN are required)"
      );
    }

    const [prepared] = await tx
      .update(invoices)
      .set({ preparedAt: new Date(), updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId))
      .returning();
    await tx
      .update(billingCases)
      .set({ status: "PREPARED", statusUpdatedAt: new Date() })
      .where(eq(billingCases.id, billingCase.id));
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "INVOICE_PREPARED",
      entityType: "invoice",
      entityId: invoiceId,
      afterData: prepared,
    });
    return prepared;
  });
}

// Spec Section 19: "Manual admin status override is allowed but must
// require confirmation and audit. Non-normal transitions require a
// reason." The generic escape hatch for any status jump this phase's two
// normal transitions (generate -> DRAFT, prepare -> PREPARED) don't cover.
export async function overrideCaseStatus(
  db: Db,
  organizationId: string,
  caseId: string,
  newStatus: (typeof billingCases.$inferSelect)["status"],
  reason: string,
  actorUserId: string
) {
  if (!reason.trim()) {
    throw new ValidationError(
      "A reason is required for a manual status override"
    );
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(billingCases)
      .where(
        and(
          eq(billingCases.id, caseId),
          eq(billingCases.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!before) throw new NotFoundError("Billing case not found");

    const [after] = await tx
      .update(billingCases)
      .set({
        status: newStatus,
        manualStatusOverride: true,
        statusUpdatedAt: new Date(),
      })
      .where(eq(billingCases.id, caseId))
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "CASE_STATUS_OVERRIDDEN",
      entityType: "billing_case",
      entityId: caseId,
      beforeData: before,
      afterData: { ...after, reason },
    });
    return after;
  });
}
