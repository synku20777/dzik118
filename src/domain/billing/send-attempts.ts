import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import {
  invoices,
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
 * Attempts to claim send concurrency for an invoice.
 *
 * Atomically inserts an invoice_send_attempts row with status 'CLAIMED'.
 * If another active-dispatch attempt already exists for this invoice, the partial
 * unique index on (invoice_id) WHERE status IN ('CLAIMED', 'DISPATCHING')
 * violates uniqueness. In that event, the conflict is caught and the existing active attempt
 * row is selected and returned with `claimed: false`.
 *
 * Note: this insert-then-catch-conflict approach alone has a late-loser
 * race (a caller that loses the conflict, then re-selects AFTER the winner
 * has already gone terminal, finds no active row and can claim again).
 * sendInvoice/resendInvoice use claimSendCommand (below) instead, which
 * closes that race via an invoice-row lock. This function remains as the
 * lower-level primitive it wraps, and for direct callers that don't need
 * that guarantee.
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
      // Must match the active-dispatch index's own status list exactly: with
      // the narrower index, multiple historical SENT/UNKNOWN/FAILED rows can
      // now legitimately coexist per invoice, so a wider filter here (with no
      // ORDER BY) could return an unrelated terminal row instead of the one
      // CLAIMED/DISPATCHING row that actually caused this violation.
      const [existing] = await db
        .select()
        .from(invoiceSendAttempts)
        .where(
          and(
            eq(invoiceSendAttempts.invoiceId, invoiceId),
            inArray(invoiceSendAttempts.status, ["CLAIMED", "DISPATCHING"])
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

export type SendCommandMode = "FIRST_SEND" | "RESEND";

export type ClaimSendCommandResult =
  | { outcome: "CLAIMED"; attempt: InvoiceSendAttempt }
  | { outcome: "ALREADY_SENT"; invoice: typeof invoices.$inferSelect }
  | { outcome: "UNKNOWN_BLOCKS_SEND" }
  | { outcome: "IN_FLIGHT"; attempt: InvoiceSendAttempt }
  | { outcome: "DUPLICATE_COMMAND"; attempt: InvoiceSendAttempt };

/**
 * Atomically decides whether a send/resend command may claim a new attempt,
 * and claims it if so -- all under one `SELECT ... FOR UPDATE` lock on the
 * invoice row.
 *
 * This closes the late-loser race the plain insert-and-catch-conflict
 * approach in claimSendAttempt() cannot: without a lock, a caller that loses
 * the unique-index race, then re-checks for an active attempt AFTER the
 * winner has already gone terminal (SENT/FAILED/UNKNOWN), finds nothing
 * blocking it and can insert a second CLAIMED row of its own. Here, the
 * losing caller blocks on the row lock instead, then re-reads the
 * authoritative state itself once it acquires it -- so it always makes its
 * decision against the winner's ACTUAL final state, never a stale read.
 *
 * No external I/O (provider dispatch) happens inside this transaction.
 *
 * `commandId`, for RESEND only, correlates this claim attempt back to the
 * specific form submission that produced it (a fresh value per page
 * render). Two concurrent submits of the same rendered Resend form carry
 * the same commandId; the second one to reach this lock is recognized as a
 * replay of the same logical click (DUPLICATE_COMMAND) rather than being
 * treated as a distinct, later resend.
 */
export async function claimSendCommand(
  db: Db,
  organizationId: string,
  invoiceId: string,
  mode: SendCommandMode,
  commandId: string | null = null
): Promise<ClaimSendCommandResult> {
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
    if (!invoice) {
      throw new NotFoundError("Invoice not found");
    }

    if (mode === "FIRST_SEND" && invoice.sentAt) {
      return { outcome: "ALREADY_SENT", invoice };
    }

    const [latestAttempt] = await tx
      .select()
      .from(invoiceSendAttempts)
      .where(
        and(
          eq(invoiceSendAttempts.invoiceId, invoiceId),
          eq(invoiceSendAttempts.organizationId, organizationId)
        )
      )
      .orderBy(desc(invoiceSendAttempts.createdAt))
      .limit(1);

    if (
      latestAttempt &&
      (latestAttempt.status === "CLAIMED" ||
        latestAttempt.status === "DISPATCHING")
    ) {
      return { outcome: "IN_FLIGHT", attempt: latestAttempt };
    }

    if (mode === "FIRST_SEND" && latestAttempt?.status === "UNKNOWN") {
      // Application-layer policy, not a DB constraint: UNKNOWN is never
      // auto-retried. An explicit resend (mode RESEND) is exactly the
      // mechanism that's allowed to try again after UNKNOWN.
      return { outcome: "UNKNOWN_BLOCKS_SEND" };
    }

    if (mode === "RESEND" && commandId) {
      const [duplicate] = await tx
        .select()
        .from(invoiceSendAttempts)
        .where(
          and(
            eq(invoiceSendAttempts.invoiceId, invoiceId),
            eq(invoiceSendAttempts.commandId, commandId)
          )
        )
        .limit(1);
      if (duplicate) {
        return { outcome: "DUPLICATE_COMMAND", attempt: duplicate };
      }
    }

    const [attempt] = await tx
      .insert(invoiceSendAttempts)
      .values({
        organizationId,
        invoiceId,
        status: "CLAIMED",
        commandId: mode === "RESEND" ? commandId : null,
      })
      .returning();

    return { outcome: "CLAIMED", attempt };
  });
}

export async function getLatestSendAttempt(
  db: DbOrTx,
  organizationId: string,
  invoiceId: string
): Promise<InvoiceSendAttempt | null> {
  const [attempt] = await db
    .select()
    .from(invoiceSendAttempts)
    .where(
      and(
        eq(invoiceSendAttempts.invoiceId, invoiceId),
        eq(invoiceSendAttempts.organizationId, organizationId)
      )
    )
    .orderBy(desc(invoiceSendAttempts.createdAt))
    .limit(1);

  return attempt ?? null;
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
