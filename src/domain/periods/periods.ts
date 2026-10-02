// Phase E (Periods/meters/readings) - Billing period CRUD and case
// generation (spec Section 16, PER-001/002). Callers must call
// requireOrganizationAccess() before calling any of these, same convention
// as the Phase D domain modules (spec Section 14).
import { and, asc, desc, eq, inArray, isNull, notExists } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { billingCases, billingPeriods } from "../../db/schema/billing";
import { dwellings } from "../../db/schema/dwellings";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { isUniqueViolation } from "../../lib/db-errors";
import { recordAuditEvent } from "../../lib/logging/audit";
import {
  computeMissingData,
  deriveReadinessStatus,
  recalculateCaseReadiness,
} from "./case-readiness";

export { ConflictError, NotFoundError, ValidationError };

export interface CreatePeriodInput {
  year: number;
  month: number;
  startsOn: string;
  endsOn: string;
  readingDeadline?: string;
  invoiceIssueDate: string;
  invoiceDueDate: string;
}

// PER-001: dates validate. Kept to the ordering the acceptance criterion
// actually implies (a period is a contiguous range, invoices go out after
// it, due after issue) rather than guessing at stricter rules the spec
// doesn't state.
function validatePeriodDates(input: CreatePeriodInput) {
  if (new Date(input.startsOn) > new Date(input.endsOn)) {
    throw new ValidationError(
      "The period start date must not be after its end date."
    );
  }
  if (new Date(input.invoiceDueDate) < new Date(input.invoiceIssueDate)) {
    throw new ValidationError(
      "The due date must not be before the invoice issue date."
    );
  }
  // Invoices are generated from the readings, so readings must close first.
  if (
    input.readingDeadline &&
    new Date(input.readingDeadline) > new Date(input.invoiceIssueDate)
  ) {
    throw new ValidationError(
      "The reading deadline must not be after the invoice issue date."
    );
  }
}

// PER-001: creates a billing case (initial missing-data calculated) for
// every active dwelling (spec Section 16 steps 1-5). Archived dwellings are
// excluded -- an archived dwelling isn't billed going forward (spec Section
// 27/DWL-002).
export async function createPeriod(
  db: Db,
  organizationId: string,
  input: CreatePeriodInput,
  actorUserId: string
) {
  validatePeriodDates(input);
  try {
    return await db.transaction(async (tx) => {
      const [period] = await tx
        .insert(billingPeriods)
        .values({ organizationId, ...input })
        .returning();

      const activeDwellings = await tx
        .select({ id: dwellings.id })
        .from(dwellings)
        .where(
          and(
            eq(dwellings.organizationId, organizationId),
            isNull(dwellings.archivedAt)
          )
        );

      for (const dwelling of activeDwellings) {
        const missingData = await computeMissingData(
          tx,
          organizationId,
          dwelling.id,
          period.id,
          period
        );
        await tx.insert(billingCases).values({
          organizationId,
          periodId: period.id,
          dwellingId: dwelling.id,
          missingData,
          status: deriveReadinessStatus(missingData),
        });
      }

      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "PERIOD_CREATED",
        entityType: "billing_period",
        entityId: period.id,
        afterData: period,
      });

      return period;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        `A billing period already exists for ${input.year}-${String(input.month).padStart(2, "0")}`
      );
    }
    throw err;
  }
}

// Called right after a dwelling is created (by createDwelling, the CSV
// import's CREATE branch, and the one-off backfill script) so it gets a
// case in the current period -- matching what createPeriod would have
// snapshotted had the dwelling existed then. Every earlier period is left
// alone, open or locked: billing a dwelling for an earlier period is the
// explicit addDwellingToPeriod below, never a side effect of when the row
// was created. onConflictDoNothing makes this safe to call more than once
// for the same dwelling (e.g. a backfill sweep re-run).
export async function syncCasesForDwelling(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string
): Promise<number> {
  const current = await getCurrentOpenPeriod(tx, organizationId);

  let createdCount = 0;
  for (const period of current ? [current] : []) {
    const missingData = await computeMissingData(
      tx,
      organizationId,
      dwellingId,
      period.id,
      period
    );
    const inserted = await tx
      .insert(billingCases)
      .values({
        organizationId,
        periodId: period.id,
        dwellingId,
        missingData,
        status: deriveReadinessStatus(missingData),
      })
      .onConflictDoNothing()
      .returning({ id: billingCases.id });
    createdCount += inserted.length;
  }
  return createdCount;
}

export async function getPeriod(
  db: DbOrTx,
  organizationId: string,
  periodId: string
) {
  const [period] = await db
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
  return period;
}

// The one period residents, the dashboard, the scheduler, and new dwellings
// act against by default: the newest period, when it is OPEN. Null when the
// newest period is locked. An older period that was reopened for retroactive
// billing is never "current": it must not get automatic invoices, resident
// readings, or new dwellings.
export async function getCurrentOpenPeriod(db: DbOrTx, organizationId: string) {
  const [period] = await db
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.organizationId, organizationId))
    .orderBy(desc(billingPeriods.year), desc(billingPeriods.month))
    .limit(1);
  return period?.status === "OPEN" ? period : null;
}

export async function listPeriods(db: Db, organizationId: string) {
  return db
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.organizationId, organizationId))
    .orderBy(desc(billingPeriods.year), desc(billingPeriods.month));
}

// PER-002: normal reading edits and invoice regeneration are rejected once
// LOCKED (enforced where those actions happen -- submitReading checks
// period.status, invoice regeneration will in Phase F); historical viewing
// is unaffected since it's just a read. Idempotent: locking an
// already-locked period is a no-op, matching archiveDwelling's style
// (Phase D) rather than erroring on a harmless re-application.
export async function lockPeriod(
  db: Db,
  organizationId: string,
  periodId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const period = await getPeriod(tx, organizationId, periodId);
    if (period.status === "LOCKED") return period;

    const [locked] = await tx
      .update(billingPeriods)
      .set({ status: "LOCKED", lockedAt: new Date() })
      .where(eq(billingPeriods.id, periodId))
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "PERIOD_LOCKED",
      entityType: "billing_period",
      entityId: periodId,
    });
    return locked;
  });
}

// The reverse of lockPeriod, for retroactive billing: a locked period must be
// open again before a dwelling can be added to it, a reading recorded, or an
// invoice generated. Idempotent like lockPeriod. Readiness of the cases that
// have no invoice yet is recalculated, because rules and meters may have
// changed while they were frozen. Cases with an invoice are not touched.
export async function reopenPeriod(
  db: Db,
  organizationId: string,
  periodId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const period = await getPeriod(tx, organizationId, periodId);
    if (period.status === "OPEN") return period;

    const [reopened] = await tx
      .update(billingPeriods)
      .set({ status: "OPEN", lockedAt: null })
      .where(eq(billingPeriods.id, periodId))
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "PERIOD_REOPENED",
      entityType: "billing_period",
      entityId: periodId,
    });
    const cases = await tx
      .select({ dwellingId: billingCases.dwellingId })
      .from(billingCases)
      .where(
        and(
          eq(billingCases.periodId, periodId),
          inArray(billingCases.status, ["MISSING_DATA", "READY"])
        )
      );
    for (const { dwellingId } of cases) {
      await recalculateCaseReadiness(tx, organizationId, dwellingId, periodId);
    }
    return reopened;
  });
}

// Active dwellings that have no billing case in this period: the candidates
// for addDwellingToPeriod.
export async function listDwellingsWithoutCase(
  db: DbOrTx,
  organizationId: string,
  periodId: string
) {
  return db
    .select({ id: dwellings.id, number: dwellings.number })
    .from(dwellings)
    .where(
      and(
        eq(dwellings.organizationId, organizationId),
        isNull(dwellings.archivedAt),
        notExists(
          db
            .select({ id: billingCases.id })
            .from(billingCases)
            .where(
              and(
                eq(billingCases.periodId, periodId),
                eq(billingCases.dwellingId, dwellings.id)
              )
            )
        )
      )
    )
    .orderBy(asc(dwellings.number));
}

// Retroactive billing: the explicit way to bill a dwelling for a period it
// was not part of (for example, a contract that arrives today but starts in
// July). Nothing is inferred from when the dwelling row was created. The
// period must be OPEN; reopen a locked one first.
export async function addDwellingToPeriod(
  db: Db,
  organizationId: string,
  periodId: string,
  dwellingId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [period] = await tx
      .select()
      .from(billingPeriods)
      .where(
        and(
          eq(billingPeriods.id, periodId),
          eq(billingPeriods.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!period) throw new NotFoundError("Billing period not found");
    if (period.status === "LOCKED") {
      throw new ConflictError("This billing period is locked");
    }
    const [dwelling] = await tx
      .select({ archivedAt: dwellings.archivedAt })
      .from(dwellings)
      .where(
        and(
          eq(dwellings.id, dwellingId),
          eq(dwellings.organizationId, organizationId)
        )
      )
      // Serializes with archiveDwelling's update of the same row.
      .for("update")
      .limit(1);
    if (!dwelling) throw new NotFoundError("Dwelling not found");
    if (dwelling.archivedAt) {
      throw new ConflictError(
        "An archived dwelling cannot be added to a billing period"
      );
    }

    const missingData = await computeMissingData(
      tx,
      organizationId,
      dwellingId,
      periodId,
      period
    );
    const [billingCase] = await tx
      .insert(billingCases)
      .values({
        organizationId,
        periodId,
        dwellingId,
        missingData,
        status: deriveReadinessStatus(missingData),
      })
      .onConflictDoNothing()
      .returning();
    if (!billingCase) {
      throw new ConflictError(
        "This dwelling already has a billing case in this period"
      );
    }
    await recordAuditEvent(tx, {
      organizationId,
      scopeDwellingId: dwellingId,
      actorUserId,
      action: "BILLING_CASE_ADDED",
      entityType: "billing_case",
      entityId: billingCase.id,
      afterData: billingCase,
    });
    return billingCase;
  });
}
