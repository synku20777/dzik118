// Phase F (Billing) - Invoice generation, bulk generation, prepare, and the
// manual status override escape hatch (spec Section 19/20/21, INV-001/002/004).
//
// MANUAL_QUANTITY/MANUAL_AMOUNT rules (spec Section 18) read their per-case
// admin-supplied value from manual_rule_inputs (domain/periods/
// manual-rule-inputs.ts); case-readiness.ts tracks its absence as missing
// data the same way it tracks a missing meter reading, so a case can only
// reach generation eligibility once every required manual input exists --
// computeQuantity below can assume it's there.
import { and, eq, inArray, like } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import {
  billingCases,
  billingPeriods,
  manualRuleInputs,
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
  compareExact,
  maxExact,
  multiplyAndRound,
  percentOf,
  subtractExact,
  sumExact,
} from "../../lib/decimal2";
import { recordAuditEvent } from "../../lib/logging/audit";
import {
  getInvoiceAllocatedAmount,
  postInvoiceCharge,
} from "../accounts/ledger";
import {
  buildBalanceSnapshot,
  buildPenaltySnapshot,
  resolveStatementFinancials,
} from "../accounts/statements";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  skipKind,
  toSafeSkipReason,
  type SkipKind,
} from "../errors";
import {
  invoiceBlockerMessage,
  resolveInvoiceEligibility,
  wasMeterActiveDuringPeriod,
} from "../periods/case-readiness";
import { carryForwardMissingReadings } from "../periods/readings";
import { buildInvoiceTemplateSnapshot } from "./invoice-template-schema";
import {
  missingBillingDetails,
  parseInvoiceSnapshots,
} from "./invoice-snapshots";
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
// meter of the configured type during this period) -- the caller skips the
// line entirely rather than billing a bogus zero. MANUAL_QUANTITY/
// MANUAL_AMOUNT never return null: unlike METER_CONSUMPTION, a manual rule
// applies to every dwelling unconditionally (same as FIXED/AREA/
// RESIDENT_COUNT), so a missing input is a data problem, not a "doesn't
// apply here" case -- case-readiness.ts's missingData guard (checked before
// this function is ever called, see generateInvoice below) is what's
// supposed to prevent that; the ConflictError here is a defensive backstop,
// not the normal path.
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
    case "MANUAL_AMOUNT": {
      const [input] = await tx
        .select({ value: manualRuleInputs.value })
        .from(manualRuleInputs)
        .where(
          and(
            eq(manualRuleInputs.periodId, period.id),
            eq(manualRuleInputs.dwellingId, dwelling.id),
            eq(manualRuleInputs.billingRuleId, rule.id)
          )
        )
        .limit(1);
      if (!input) {
        throw new ConflictError(
          `The rule "${rule.name}" is missing its manually supplied value for this dwelling; this should have been caught as missing data`
        );
      }
      return input.value;
    }
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
  actorUserId: string | null
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
    if (
      billingCase.status !== "MISSING_DATA" &&
      billingCase.status !== "READY" &&
      billingCase.status !== "DRAFT"
    ) {
      throw new ConflictError(
        `Cannot generate an invoice for a case in ${billingCase.status} status`
      );
    }
    // Resolved live, not read from billingCase.missingData: the same resolver
    // sets READY, so generation and readiness cannot disagree, and a stale
    // stored value cannot let a blocked case through.
    const { blockers, billableRules: rules } = await resolveInvoiceEligibility(
      tx,
      organizationId,
      dwellingId,
      periodId,
      period
    );
    if (blockers.length > 0) {
      const message = invoiceBlockerMessage(blockers);
      throw blockers.some((b) => b.reason === "NO_APPLICABLE_RULES")
        ? new ValidationError(message)
        : new ConflictError(message);
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

    // `rules` is dwelling-scoped, not org-wide: ONE_TO_MANY/ONE_TO_ONE rules
    // must never appear on a dwelling they aren't assigned to (spec: "every
    // org-wide tariff into every dwelling's invoice -- that must stop"). The
    // null/empty checks below are backstops; the resolver already cleared them.
    const lineInputs: Array<{ rule: EffectiveRule; quantity: string }> = [];
    for (const rule of rules) {
      const quantity = await computeQuantity(tx, rule, dwelling, period);
      if (quantity === null) continue;
      lineInputs.push({ rule, quantity });
    }
    if (lineInputs.length === 0) {
      throw new ValidationError(
        "No billing rules apply to this dwelling for this period"
      );
    }

    const lines = lineInputs.map(({ rule, quantity }, index) => {
      // MANUAL_AMOUNT's manual_rule_inputs value IS the desired net amount,
      // not a quantity to be priced -- validateRuleShape (rules.ts) doesn't
      // even require a unit_price for this type. Reusing the same
      // quantity x unitPrice formula with quantity pinned to "1" and
      // unitPrice set to the supplied value keeps one formula for every
      // calculation type instead of a separate net-amount code path, and
      // reads naturally on the invoice ("1 x €45.00").
      const isManualAmount = rule.calculationType === "MANUAL_AMOUNT";
      const effectiveQuantity = isManualAmount ? "1" : quantity;
      const unitPrice = isManualAmount ? quantity : (rule.unitPrice ?? "0");
      const netAmount = multiplyAndRound(effectiveQuantity, unitPrice, 2);
      const vatAmount = percentOf(netAmount, rule.vatRate, 2);
      const grossAmount = addExact(netAmount, vatAmount);
      return {
        billingRuleId: rule.id,
        sortOrder: index,
        description: rule.name,
        calculationType: rule.calculationType,
        sourceSnapshot: rule,
        unit: rule.unit,
        quantity: effectiveQuantity,
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
      invoiceByEmail: dwelling.invoiceByEmail,
      invoiceByPaper: dwelling.invoiceByPaper,
    };
    const [existingInvoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.billingCaseId, billingCase.id))
      .limit(1);
    const financials = await resolveStatementFinancials(tx, {
      organizationId,
      dwellingId,
      currency: org.currency,
      issueDate: period.invoiceIssueDate,
      invoiceId: existingInvoice?.id,
      currentCharges: total,
      manualAdjustment: existingInvoice?.manualAdjustment ?? "0.00",
      lateFeeAdjustment: existingInvoice?.lateFeeAdjustment ?? "0.00",
    });
    const balanceSnapshot = buildBalanceSnapshot(financials);
    const penaltySnapshot = buildPenaltySnapshot(financials);
    const [templateRow] = await tx
      .select()
      .from(invoiceTemplates)
      .where(eq(invoiceTemplates.organizationId, organizationId))
      .limit(1);
    const templateSnapshot = buildInvoiceTemplateSnapshot(templateRow ?? null);

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
          currentCharges: total,
          previousOutstanding: financials.balance.previousOutstanding,
          previousCreditApplied: financials.balance.previousCreditApplied,
          lateFeeCalculated: financials.lateFee.appliedAmount,
          lateFeeApplied: financials.balance.lateFee,
          amountDue: financials.balance.amountDue,
          remainingCredit: financials.balance.remainingCredit,
          balanceSnapshot,
          penaltySnapshot,
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
          // Its content changed, so it is not prepared any more: only a new
          // preparation (not a status override) may post the new amounts.
          preparedAt: null,
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
          currentCharges: total,
          previousOutstanding: financials.balance.previousOutstanding,
          previousCreditApplied: financials.balance.previousCreditApplied,
          lateFeeCalculated: financials.lateFee.appliedAmount,
          lateFeeAdjustment: "0.00",
          lateFeeApplied: financials.balance.lateFee,
          manualAdjustment: "0.00",
          amountDue: financials.balance.amountDue,
          remainingCredit: financials.balance.remainingCredit,
          balanceSnapshot,
          penaltySnapshot,
          manualAdjustmentSnapshot: {},
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
      scopeDwellingId: invoice.dwellingId,
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
  skipped: { dwellingId: string; reason: string; kind: SkipKind }[];
}

// INV-002: each case generates in its own transaction (via generateInvoice)
// so one dwelling's failure doesn't roll back the others in the batch.
export async function bulkGenerateInvoices(
  db: Db,
  organizationId: string,
  periodId: string,
  actorUserId: string | null
): Promise<BulkGenerateResult> {
  // After the reading deadline, a meter with no reading reuses its previous
  // one, so a silent resident does not hold the invoice back.
  await carryForwardMissingReadings(db, organizationId, periodId, actorUserId);
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
    // Blockers are not pre-checked from the stored missingData:
    // generateInvoice resolves them live and its error is the skip reason.
    if (
      billingCase.status !== "MISSING_DATA" &&
      billingCase.status !== "READY" &&
      billingCase.status !== "DRAFT"
    ) {
      result.skipped.push({
        dwellingId: billingCase.dwellingId,
        reason: `Already ${billingCase.status}`,
        kind: "ROUTINE",
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
        reason: toSafeSkipReason(err),
        kind: skipKind(err),
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
// probe which invoice ids exist elsewhere. Invoices are only visible once
// issued and dispatched (SENT, PAID, OVERDUE), not in preliminary DRAFT/PREPARED state.
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
  const result = await loadInvoiceAndLines(db, invoice);
  if (
    !result.caseStatus ||
    !["SENT", "PAID", "OVERDUE"].includes(result.caseStatus)
  ) {
    throw new NotFoundError("Invoice not found");
  }
  const paidAmount = await getInvoiceAllocatedAmount(
    db,
    invoice.organizationId,
    invoice.id
  );
  // Older paid invoices have no allocation rows: trust paidAt, as
  // getInvoiceForDwellingPeriod does.
  const legacyPaid = !!invoice.paidAt && paidAmount === "0.00";
  const remainingAmount = legacyPaid
    ? "0.00"
    : maxExact("0.00", subtractExact(invoice.amountDue, paidAmount));
  return {
    ...result,
    paidAmount: legacyPaid ? invoice.amountDue : paidAmount,
    remainingAmount,
  };
}

// caseStatus is included (not just sentAt/paidAt) because those two columns
// alone can't distinguish OVERDUE from SENT, or PREPARED from DRAFT --
// billing_cases.status is the source of truth for workflow state (spec
// Section 19). Only published invoices (SENT, PAID, OVERDUE) are visible to residents.
export async function listInvoicesForDwelling(db: Db, dwellingId: string) {
  return db
    .select({
      id: invoices.id,
      organizationId: invoices.organizationId,
      invoiceNumber: invoices.invoiceNumber,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      currentCharges: invoices.currentCharges,
      previousOutstanding: invoices.previousOutstanding,
      previousCreditApplied: invoices.previousCreditApplied,
      lateFeeApplied: invoices.lateFeeApplied,
      manualAdjustment: invoices.manualAdjustment,
      amountDue: invoices.amountDue,
      remainingCredit: invoices.remainingCredit,
      currency: invoices.currency,
      sentAt: invoices.sentAt,
      paidAt: invoices.paidAt,
      caseStatus: billingCases.status,
    })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(
      and(
        eq(invoices.dwellingId, dwellingId),
        inArray(billingCases.status, ["SENT", "PAID", "OVERDUE"])
      )
    )
    .orderBy(invoices.issueDate, invoices.createdAt);
}

// Phase I (Resident UX) - "current invoice" for the resident dwelling
// dashboard (spec Section 28). Returns null rather than throwing when none
// exists yet (e.g. the period's case is still DRAFT/MISSING_DATA) -- that's
// a normal, expected state for the current period, not an error.
export async function getInvoiceForDwellingPeriod(
  db: Db,
  dwellingId: string,
  periodId: string
) {
  const [invoice] = await db
    .select({
      id: invoices.id,
      organizationId: invoices.organizationId,
      invoiceNumber: invoices.invoiceNumber,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      currentCharges: invoices.currentCharges,
      previousOutstanding: invoices.previousOutstanding,
      previousCreditApplied: invoices.previousCreditApplied,
      lateFeeApplied: invoices.lateFeeApplied,
      manualAdjustment: invoices.manualAdjustment,
      amountDue: invoices.amountDue,
      remainingCredit: invoices.remainingCredit,
      currency: invoices.currency,
      sentAt: invoices.sentAt,
      paidAt: invoices.paidAt,
      caseStatus: billingCases.status,
    })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(
      and(
        eq(invoices.dwellingId, dwellingId),
        eq(invoices.periodId, periodId),
        inArray(billingCases.status, ["SENT", "PAID", "OVERDUE"])
      )
    )
    .limit(1);
  if (!invoice) return null;
  const allocated = await getInvoiceAllocatedAmount(
    db,
    invoice.organizationId,
    invoice.id
  );
  return {
    ...invoice,
    outstandingAmount:
      invoice.paidAt && allocated === "0.00"
        ? "0.00"
        : maxExact(subtractExact(invoice.amountDue, allocated), "0.00"),
  };
}

// INV-004: normal transition only from DRAFT.
export async function prepareInvoice(
  db: Db,
  organizationId: string,
  invoiceId: string,
  actorUserId: string | null
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

    // The opening balance import (ADR 0013) takes the same lock on the
    // dwelling. An opening balance posted at the same moment is then either
    // seen by this preparation, or the import finds this invoice prepared and
    // refuses the dwelling. Without it the invoice could freeze its balance
    // without the debt the import commits a moment later.
    await tx
      .select({ id: dwellings.id })
      .from(dwellings)
      .where(eq(dwellings.id, invoice.dwellingId))
      .for("no key update");

    const [billingCase] = await tx
      .select()
      .from(billingCases)
      .where(eq(billingCases.id, invoice.billingCaseId))
      .limit(1);
    if (!billingCase || billingCase.status !== "DRAFT") {
      throw new ConflictError("Only a DRAFT invoice can be prepared");
    }

    const problem = missingBillingDetails(parseInvoiceSnapshots(invoice));
    if (problem) throw new ValidationError(problem);

    // Only after an override back to Draft. The payment was matched against
    // the amount due the invoice had then; a new amount due under it would
    // let the invoice count as paid while money is still owed.
    const allocated = await getInvoiceAllocatedAmount(
      tx,
      organizationId,
      invoiceId
    );
    if (compareExact(allocated, "0.00") > 0) {
      throw new ConflictError(
        "This invoice already has a payment. Reverse the payment before preparing the invoice again"
      );
    }

    const financials = await resolveStatementFinancials(tx, {
      organizationId,
      dwellingId: invoice.dwellingId,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      invoiceId,
      currentCharges: invoice.currentCharges,
      manualAdjustment: invoice.manualAdjustment,
      lateFeeAdjustment: invoice.lateFeeAdjustment,
    });
    const balanceSnapshot = buildBalanceSnapshot(financials);
    const penaltySnapshot = buildPenaltySnapshot(financials);

    const [prepared] = await tx
      .update(invoices)
      .set({
        currentCharges: invoice.currentCharges,
        previousOutstanding: financials.balance.previousOutstanding,
        previousCreditApplied: financials.balance.previousCreditApplied,
        lateFeeCalculated: financials.lateFee.appliedAmount,
        lateFeeApplied: financials.balance.lateFee,
        amountDue: financials.balance.amountDue,
        remainingCredit: financials.balance.remainingCredit,
        balanceSnapshot,
        penaltySnapshot,
        preparedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();
    const entry = {
      organizationId,
      dwellingId: invoice.dwellingId,
      effectiveDate: invoice.issueDate,
      currency: invoice.currency,
      invoiceId,
    };
    await postInvoiceCharge(
      tx,
      {
        ...entry,
        type: "INVOICE_CHARGE",
        description: `Current charges ${invoice.invoiceNumber}`,
        metadata: { invoiceNumber: invoice.invoiceNumber },
        idempotencyKey: `invoice:${invoiceId}:current-charges`,
      },
      prepared.currentCharges
    );
    await postInvoiceCharge(
      tx,
      {
        ...entry,
        type: "LATE_FEE",
        description: `Late fee ${invoice.invoiceNumber}`,
        metadata: penaltySnapshot,
        idempotencyKey: `invoice:${invoiceId}:late-fee`,
      },
      prepared.lateFeeApplied
    );
    await postInvoiceCharge(
      tx,
      {
        ...entry,
        type: "MANUAL_ADJUSTMENT",
        description: `Manual adjustment ${invoice.invoiceNumber}`,
        metadata: invoice.manualAdjustmentSnapshot,
        actorUserId: actorUserId ?? undefined,
        idempotencyKey: `invoice:${invoiceId}:manual-adjustment`,
      },
      prepared.manualAdjustment
    );
    await tx
      .update(billingCases)
      .set({ status: "PREPARED", statusUpdatedAt: new Date() })
      .where(eq(billingCases.id, billingCase.id));
    await recordAuditEvent(tx, {
      organizationId,
      scopeDwellingId: invoice.dwellingId,
      actorUserId,
      action: "INVOICE_PREPARED",
      entityType: "invoice",
      entityId: invoiceId,
      afterData: prepared,
    });
    return prepared;
  });
}

export interface BulkPrepareResult {
  prepared: string[];
  skipped: { invoiceId: string; reason: string; kind: SkipKind }[];
}

// Spec Section 27: workbench "bulk selection" -- prepares whichever
// admin-selected invoices are eligible (DRAFT), same
// one-failure-does-not-block-the-rest pattern as bulkGenerateInvoices.
export async function bulkPrepareInvoices(
  db: Db,
  organizationId: string,
  invoiceIds: string[],
  actorUserId: string | null
): Promise<BulkPrepareResult> {
  const result: BulkPrepareResult = { prepared: [], skipped: [] };
  for (const invoiceId of invoiceIds) {
    try {
      await prepareInvoice(db, organizationId, invoiceId, actorUserId);
      result.prepared.push(invoiceId);
    } catch (err) {
      result.skipped.push({
        invoiceId,
        reason: toSafeSkipReason(err),
        kind: skipKind(err),
      });
    }
  }
  return result;
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
      .for("update")
      .limit(1);
    if (!before) throw new NotFoundError("Billing case not found");

    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.billingCaseId, caseId),
          eq(invoices.organizationId, organizationId)
        )
      )
      .limit(1);

    if (newStatus === "SENT" && (!invoice || !invoice.sentAt)) {
      throw new ConflictError(
        "A case can be set to Sent only when its invoice was sent"
      );
    }
    // A status override posts nothing to the account, so it must not skip the
    // preparation that does.
    if (newStatus === "PREPARED" && !invoice?.preparedAt) {
      throw new ConflictError(
        "A case can be set to Prepared only when its invoice was prepared"
      );
    }
    if (newStatus === "OVERDUE" && !invoice?.sentAt) {
      throw new ConflictError(
        "A case can be set to Overdue only when its invoice was sent"
      );
    }
    if (newStatus === "PAID" && (!invoice || !invoice.paidAt)) {
      throw new ConflictError(
        "A case can be set to Paid only when its invoice is paid"
      );
    }
    if ((newStatus === "MISSING_DATA" || newStatus === "READY") && invoice) {
      throw new ConflictError(
        "A case that already has an invoice cannot go back to Missing data or Ready"
      );
    }

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
      scopeDwellingId: before.dwellingId,
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
