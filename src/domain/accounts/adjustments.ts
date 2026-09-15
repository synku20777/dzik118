import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { lateFeeAdjustments } from "../../db/schema/accounts";
import { invoices } from "../../db/schema/invoices";
import { compareExact, subtractExact } from "../../lib/decimal2";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { assertDwellingInOrganization, postAccountEntry } from "./ledger";
import { buildPenaltySnapshot, resolveStatementFinancials } from "./statements";

const OTHER = "OTHER" as const;

export async function adjustLateFee(
  db: Db,
  input: {
    organizationId: string;
    invoiceId: string;
    newAppliedAmount: string;
    reason: (typeof lateFeeAdjustments.$inferInsert)["reason"];
    note?: string;
    actorUserId: string;
  }
) {
  if (input.reason === OTHER && !input.note?.trim()) {
    throw new ValidationError(
      "An explanation is required when reason is Other"
    );
  }
  if (compareExact(input.newAppliedAmount, "0.00") < 0) {
    throw new ValidationError("Late fee cannot be negative");
  }
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.organizationId, input.organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.preparedAt || invoice.sentAt) {
      throw new ConflictError(
        "A prepared or sent invoice cannot have its financial statement changed"
      );
    }
    const financials = await resolveStatementFinancials(tx, {
      organizationId: input.organizationId,
      dwellingId: invoice.dwellingId,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      currentCharges: invoice.currentCharges,
      manualAdjustment: invoice.manualAdjustment,
    });
    const calculated = financials.lateFee.appliedAmount;
    if (compareExact(input.newAppliedAmount, calculated) > 0) {
      throw new ValidationError(
        "Applied late fee cannot exceed the calculated amount"
      );
    }
    const lateFeeAdjustment = subtractExact(input.newAppliedAmount, calculated);
    const refreshed = await resolveStatementFinancials(tx, {
      organizationId: input.organizationId,
      dwellingId: invoice.dwellingId,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      currentCharges: invoice.currentCharges,
      manualAdjustment: invoice.manualAdjustment,
      lateFeeAdjustment,
    });
    const [event] = await tx
      .insert(lateFeeAdjustments)
      .values({
        organizationId: input.organizationId,
        invoiceId: invoice.id,
        calculatedAmount: calculated,
        priorAppliedAmount: invoice.lateFeeApplied,
        newAppliedAmount: input.newAppliedAmount,
        adjustmentAmount: subtractExact(
          input.newAppliedAmount,
          invoice.lateFeeApplied
        ),
        reason: input.reason,
        note: input.note?.trim() || null,
        actorUserId: input.actorUserId,
      })
      .returning();
    const [updated] = await tx
      .update(invoices)
      .set({
        previousOutstanding: refreshed.balance.previousOutstanding,
        previousCreditApplied: refreshed.balance.previousCreditApplied,
        lateFeeCalculated: calculated,
        lateFeeAdjustment,
        lateFeeApplied: input.newAppliedAmount,
        amountDue: refreshed.balance.amountDue,
        remainingCredit: refreshed.balance.remainingCredit,
        penaltySnapshot: buildPenaltySnapshot(refreshed),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id))
      .returning();
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "LATE_FEE_ADJUSTED",
      entityType: "invoice",
      entityId: invoice.id,
      beforeData: {
        calculated: invoice.lateFeeCalculated,
        applied: invoice.lateFeeApplied,
      },
      afterData: { event, applied: updated.lateFeeApplied },
    });
    return updated;
  });
}

export async function setInvoiceManualAdjustment(
  db: Db,
  input: {
    organizationId: string;
    invoiceId: string;
    amount: string;
    reason: string;
    note?: string;
    actorUserId: string;
  }
) {
  if (!input.reason.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.organizationId, input.organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.preparedAt || invoice.sentAt) {
      throw new ConflictError(
        "A prepared or sent invoice cannot have its financial statement changed"
      );
    }
    const financials = await resolveStatementFinancials(tx, {
      organizationId: input.organizationId,
      dwellingId: invoice.dwellingId,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      currentCharges: invoice.currentCharges,
      manualAdjustment: input.amount,
      lateFeeAdjustment: invoice.lateFeeAdjustment,
    });
    const [updated] = await tx
      .update(invoices)
      .set({
        manualAdjustment: input.amount,
        manualAdjustmentSnapshot: {
          reason: input.reason.trim(),
          note: input.note?.trim() || null,
          actorUserId: input.actorUserId,
        },
        previousOutstanding: financials.balance.previousOutstanding,
        previousCreditApplied: financials.balance.previousCreditApplied,
        amountDue: financials.balance.amountDue,
        remainingCredit: financials.balance.remainingCredit,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id))
      .returning();
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "ACCOUNT_ADJUSTMENT_CREATED",
      entityType: "invoice",
      entityId: invoice.id,
      beforeData: { manualAdjustment: invoice.manualAdjustment },
      afterData: { manualAdjustment: updated.manualAdjustment },
    });
    return updated;
  });
}

export async function createDwellingAccountAdjustment(
  db: Db,
  input: {
    organizationId: string;
    dwellingId: string;
    currency: string;
    amount: string;
    direction: "CHARGE" | "CREDIT";
    effectiveDate: string;
    reason: string;
    note?: string;
    actorUserId: string;
  }
) {
  if (compareExact(input.amount, "0.00") <= 0) {
    throw new ValidationError("Adjustment amount must be positive");
  }
  if (!input.reason.trim()) throw new ValidationError("A reason is required");
  return db.transaction(async (tx) => {
    await assertDwellingInOrganization(
      tx,
      input.organizationId,
      input.dwellingId
    );
    const entry = await postAccountEntry(tx, {
      organizationId: input.organizationId,
      dwellingId: input.dwellingId,
      effectiveDate: input.effectiveDate,
      type: "MANUAL_ADJUSTMENT",
      debit: input.direction === "CHARGE" ? input.amount : "0.00",
      credit: input.direction === "CREDIT" ? input.amount : "0.00",
      currency: input.currency,
      reason: input.reason.trim(),
      description: `Manual ${input.direction.toLowerCase()} adjustment`,
      actorUserId: input.actorUserId,
      metadata: { note: input.note?.trim() || null },
      idempotencyKey: `manual-adjustment:${input.organizationId}:${input.dwellingId}:${crypto.randomUUID()}`,
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "ACCOUNT_ADJUSTMENT_CREATED",
      entityType: "account_entry",
      entityId: entry.id,
      afterData: entry,
    });
    return entry;
  });
}
