import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import {
  invoiceSendAttempts,
  type invoiceSendAttemptStatusEnum,
} from "../../db/schema/invoices";
import { isUniqueViolation } from "../../lib/db-errors";
import { NotFoundError } from "../errors";

export type InvoiceSendAttemptStatus =
  (typeof invoiceSendAttemptStatusEnum.enumValues)[number];

export type InvoiceSendAttempt = typeof invoiceSendAttempts.$inferSelect;
export type NewInvoiceSendAttempt = typeof invoiceSendAttempts.$inferInsert;

export type ClaimSendAttemptResult =
  | { claimed: true; attempt: InvoiceSendAttempt }
  | { claimed: false; attempt: InvoiceSendAttempt };

export const STALE_CLAIM_MS = 60_000;
export const STALE_DISPATCH_MS = 5 * 60_000;

export type StalenessClassification =
  | {
      isStale: true;
      targetStatus: "FAILED";
      errorCode: "ABANDONED_BEFORE_DISPATCH";
    }
  | {
      isStale: true;
      targetStatus: "UNKNOWN";
      errorCode: "STALE_DISPATCH_NO_CONFIRMATION";
    }
  | { isStale: false };

/**
 * Pure evaluation of attempt staleness based on status and timestamps.
 */
export function classifyAttemptStaleness(
  status: InvoiceSendAttemptStatus,
  claimedAt: Date,
  dispatchStartedAt: Date | null,
  now: number = Date.now()
): StalenessClassification {
  if (status === "CLAIMED") {
    if (now - claimedAt.getTime() >= STALE_CLAIM_MS) {
      return {
        isStale: true,
        targetStatus: "FAILED",
        errorCode: "ABANDONED_BEFORE_DISPATCH",
      };
    }
  } else if (status === "DISPATCHING") {
    const startTime = dispatchStartedAt?.getTime() ?? claimedAt.getTime();
    if (now - startTime >= STALE_DISPATCH_MS) {
      return {
        isStale: true,
        targetStatus: "UNKNOWN",
        errorCode: "STALE_DISPATCH_NO_CONFIRMATION",
      };
    }
  }
  return { isStale: false };
}

/**
 * Attempts to claim first-send concurrency for an invoice.
 *
 * Atomically inserts an invoice_send_attempts row with status 'CLAIMED'.
 * If another non-FAILED attempt already exists for this invoice, the partial
 * unique index on (invoice_id) WHERE status IN ('CLAIMED', 'DISPATCHING', 'SENT', 'UNKNOWN')
 * violates uniqueness. In that event, the conflict is caught and the existing active attempt
 * row is selected and returned with `claimed: false`.
 */
export async function claimSendAttempt(
  db: DbOrTx,
  organizationId: string,
  invoiceId: string
): Promise<ClaimSendAttemptResult> {
  try {
    const [attempt] = await db
      .insert(invoiceSendAttempts)
      .values({
        organizationId,
        invoiceId,
        status: "CLAIMED",
      })
      .returning();
    return { claimed: true, attempt };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [existing] = await db
        .select()
        .from(invoiceSendAttempts)
        .where(
          and(
            eq(invoiceSendAttempts.invoiceId, invoiceId),
            inArray(invoiceSendAttempts.status, [
              "CLAIMED",
              "DISPATCHING",
              "SENT",
              "UNKNOWN",
            ])
          )
        )
        .limit(1);

      if (!existing) {
        // If the conflicting attempt transitioned to FAILED in the tiny window
        // between our insert and select, retry claiming once.
        return claimSendAttempt(db, organizationId, invoiceId);
      }

      return { claimed: false, attempt: existing };
    }
    throw err;
  }
}

export async function markDispatching(
  db: DbOrTx,
  attemptId: string
): Promise<InvoiceSendAttempt> {
  const [updated] = await db
    .update(invoiceSendAttempts)
    .set({
      status: "DISPATCHING",
      dispatchStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invoiceSendAttempts.id, attemptId))
    .returning();
  if (!updated) {
    throw new NotFoundError("Invoice send attempt not found");
  }
  return updated;
}

export async function markSent(
  db: DbOrTx,
  attemptId: string,
  errorCode?: null,
  expectedStatus?: InvoiceSendAttemptStatus
): Promise<InvoiceSendAttempt> {
  const conditions = [eq(invoiceSendAttempts.id, attemptId)];
  if (expectedStatus) {
    conditions.push(eq(invoiceSendAttempts.status, expectedStatus));
  }
  const [updated] = await db
    .update(invoiceSendAttempts)
    .set({
      status: "SENT",
      errorCode: errorCode ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  if (!updated) {
    throw new NotFoundError("Invoice send attempt not found");
  }
  return updated;
}

export async function markFailed(
  db: DbOrTx,
  attemptId: string,
  errorCode: string,
  expectedStatus?: InvoiceSendAttemptStatus
): Promise<InvoiceSendAttempt> {
  const conditions = [eq(invoiceSendAttempts.id, attemptId)];
  if (expectedStatus) {
    conditions.push(eq(invoiceSendAttempts.status, expectedStatus));
  }
  const [updated] = await db
    .update(invoiceSendAttempts)
    .set({
      status: "FAILED",
      errorCode,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  if (!updated) {
    throw new NotFoundError("Invoice send attempt not found");
  }
  return updated;
}

export async function markUnknown(
  db: DbOrTx,
  attemptId: string,
  errorCode: string,
  expectedStatus?: InvoiceSendAttemptStatus
): Promise<InvoiceSendAttempt> {
  const conditions = [eq(invoiceSendAttempts.id, attemptId)];
  if (expectedStatus) {
    conditions.push(eq(invoiceSendAttempts.status, expectedStatus));
  }
  const [updated] = await db
    .update(invoiceSendAttempts)
    .set({
      status: "UNKNOWN",
      errorCode,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  if (!updated) {
    throw new NotFoundError("Invoice send attempt not found");
  }
  return updated;
}

export async function markFailedConditional(
  db: DbOrTx,
  attemptId: string,
  errorCode: string,
  expectedStatus: InvoiceSendAttemptStatus
): Promise<InvoiceSendAttempt | null> {
  const [updated] = await db
    .update(invoiceSendAttempts)
    .set({
      status: "FAILED",
      errorCode,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(invoiceSendAttempts.id, attemptId),
        eq(invoiceSendAttempts.status, expectedStatus)
      )
    )
    .returning();
  return updated ?? null;
}

export async function markUnknownConditional(
  db: DbOrTx,
  attemptId: string,
  errorCode: string,
  expectedStatus: InvoiceSendAttemptStatus
): Promise<InvoiceSendAttempt | null> {
  const [updated] = await db
    .update(invoiceSendAttempts)
    .set({
      status: "UNKNOWN",
      errorCode,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(invoiceSendAttempts.id, attemptId),
        eq(invoiceSendAttempts.status, expectedStatus)
      )
    )
    .returning();
  return updated ?? null;
}

/**
 * Checks an attempt against staleness thresholds and updates stuck rows.
 *
 * - A CLAIMED row older than STALE_CLAIM_MS is transitioned to FAILED
 *   with error code 'ABANDONED_BEFORE_DISPATCH'.
 * - A DISPATCHING row older than STALE_DISPATCH_MS is transitioned to UNKNOWN
 *   with error code 'STALE_DISPATCH_NO_CONFIRMATION'.
 * - Any other row is returned unchanged.
 *
 * Safe against TOCTOU races: the status transition is conditional on the exact
 * status observed at classification time. If the row changed underneath (e.g.
 * CLAIMED -> DISPATCHING), zero rows are updated, and the freshly observed row
 * is returned rather than overwriting the live attempt.
 */
export async function reconcileStaleAttempt(
  db: DbOrTx,
  attempt: InvoiceSendAttempt
): Promise<InvoiceSendAttempt> {
  const [current] = await db
    .select()
    .from(invoiceSendAttempts)
    .where(eq(invoiceSendAttempts.id, attempt.id))
    .limit(1);

  const row = current ?? attempt;
  const classification = classifyAttemptStaleness(
    row.status,
    row.claimedAt,
    row.dispatchStartedAt
  );

  if (!classification.isStale) {
    return row;
  }

  const updated =
    classification.targetStatus === "FAILED"
      ? await markFailedConditional(
          db,
          row.id,
          classification.errorCode,
          row.status
        )
      : await markUnknownConditional(
          db,
          row.id,
          classification.errorCode,
          row.status
        );

  if (!updated) {
    const [fresh] = await db
      .select()
      .from(invoiceSendAttempts)
      .where(eq(invoiceSendAttempts.id, row.id))
      .limit(1);
    return fresh ?? row;
  }

  return updated;
}
