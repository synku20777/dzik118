// Phase E (Periods/meters/readings) - Billing period CRUD and case
// generation (spec Section 16, PER-001/002). Callers must call
// requireOrganizationAccess() before calling any of these, same convention
// as the Phase D domain modules (spec Section 14).
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { billingCases, billingPeriods } from "../../db/schema/billing";
import { dwellings } from "../../db/schema/dwellings";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { isUniqueViolation } from "../../lib/db-errors";
import { recordAuditEvent } from "../../lib/logging/audit";
import { computeMissingData } from "./case-readiness";

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
    throw new ValidationError("startsOn must not be after endsOn");
  }
  if (new Date(input.invoiceDueDate) < new Date(input.invoiceIssueDate)) {
    throw new ValidationError(
      "invoiceDueDate must not be before invoiceIssueDate"
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

// The one period residents (and the admin dashboard, later) act against by
// default: the most recent OPEN period, or null once every period is
// locked (no current period to submit readings into).
export async function getCurrentOpenPeriod(db: DbOrTx, organizationId: string) {
  const [period] = await db
    .select()
    .from(billingPeriods)
    .where(
      and(
        eq(billingPeriods.organizationId, organizationId),
        eq(billingPeriods.status, "OPEN")
      )
    )
    .orderBy(desc(billingPeriods.year), desc(billingPeriods.month))
    .limit(1);
  return period ?? null;
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
