// Phase E (Periods/meters/readings) - Meter reading submission (spec
// Section 17, MTR-002/003). Callers must call requireOrganizationAccess()
// (admin) or requireDwellingAccess() (resident) first, same convention as
// every other domain module (spec Section 14).
import { and, desc, eq, gt, lt, or } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import {
  billingCases,
  billingPeriods,
  meterReadings,
} from "../../db/schema/billing";
import { meters } from "../../db/schema/dwellings";
import {
  DECIMAL3_PATTERN,
  compareDecimal3,
  subtractDecimal3,
} from "../../lib/decimal3";
import { recordAuditEvent } from "../../lib/logging/audit";
import {
  recalculateCaseReadiness,
  wasMeterActiveDuringPeriod,
} from "./case-readiness";
import { NotFoundError, ConflictError, ValidationError } from "./periods";

export { NotFoundError, ConflictError, ValidationError };

// spec Section 17: "previous reading is most recent prior accepted
// reading" -- the most recent reading (by period year/month, not
// submission time) strictly before this period, regardless of which
// period it was originally submitted against.
async function findPreviousValue(
  tx: DbOrTx,
  meterId: string,
  period: { year: number; month: number }
): Promise<string | null> {
  const [prev] = await tx
    .select({ currentValue: meterReadings.currentValue })
    .from(meterReadings)
    .innerJoin(billingPeriods, eq(billingPeriods.id, meterReadings.periodId))
    .where(
      and(
        eq(meterReadings.meterId, meterId),
        or(
          lt(billingPeriods.year, period.year),
          and(
            eq(billingPeriods.year, period.year),
            lt(billingPeriods.month, period.month)
          )
        )
      )
    )
    .orderBy(desc(billingPeriods.year), desc(billingPeriods.month))
    .limit(1);
  return prev?.currentValue ?? null;
}

// Editing an already-recorded reading is only safe if no later period has
// already recorded its own reading for this meter -- that later reading's
// previousValue/consumption were computed from the value being changed and
// would otherwise silently go stale (this domain doesn't cascade-recompute
// forward; blocking the edit is the cheaper, safer alternative).
async function hasLaterReading(
  tx: DbOrTx,
  meterId: string,
  period: { year: number; month: number }
): Promise<boolean> {
  const [later] = await tx
    .select({ id: meterReadings.id })
    .from(meterReadings)
    .innerJoin(billingPeriods, eq(billingPeriods.id, meterReadings.periodId))
    .where(
      and(
        eq(meterReadings.meterId, meterId),
        or(
          gt(billingPeriods.year, period.year),
          and(
            eq(billingPeriods.year, period.year),
            gt(billingPeriods.month, period.month)
          )
        )
      )
    )
    .limit(1);
  return !!later;
}

export interface RecordReadingOptions {
  note?: string;
  // MTR-002: "lower reading needs explicit admin reset/replacement flow" --
  // force is that flow's minimal form, admin-only (never accepted from the
  // resident path below).
  force?: boolean;
}

async function recordReading(
  db: Db,
  organizationId: string,
  periodId: string,
  meterId: string,
  currentValue: string,
  source: "ADMIN" | "RESIDENT",
  submittedByUserId: string,
  options: RecordReadingOptions = {}
) {
  if (!DECIMAL3_PATTERN.test(currentValue)) {
    throw new ValidationError(
      "Current value must be a non-negative number with at most 3 decimal places"
    );
  }

  return db.transaction(async (tx) => {
    // FOR UPDATE: without this, a concurrent lockPeriod/archiveMeter could
    // commit its UPDATE between this SELECT and this transaction's own
    // write, letting a reading through for a period/meter that's actually
    // locked/archived by the time this commits (Postgres's default Read
    // Committed isolation permits exactly that interleaving). Locking the
    // row here makes the concurrent UPDATE wait instead.
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
    if (source === "RESIDENT" && period.readingDeadline) {
      // Inclusive of the whole deadline date, not just up to UTC midnight
      // at its start -- a plain `new Date(dateString)` parses to 00:00 UTC,
      // which would cut off nearly the entire day. Still UTC-based, not the
      // organization's configured timezone (no timezone-aware date infra
      // exists in this codebase yet); a few hours of edge-of-day slack
      // remains depending on the org's actual timezone.
      const deadlineEndOfDay = new Date(
        `${period.readingDeadline}T23:59:59.999Z`
      );
      if (new Date() > deadlineEndOfDay) {
        throw new ConflictError(
          "The reading deadline for this period has passed"
        );
      }
    }

    const [meter] = await tx
      .select()
      .from(meters)
      .where(
        and(eq(meters.id, meterId), eq(meters.organizationId, organizationId))
      )
      .for("update")
      .limit(1);
    if (!meter) throw new NotFoundError("Meter not found");
    if (meter.archivedAt) {
      // Spec Section 17: residents can never submit to an archived meter,
      // full stop. Admins may still back-fill a reading for one that was
      // archived mid-period (it was still active for part of it, so it's
      // still a required input, spec Section 16 step 4) -- otherwise a case
      // stays MISSING_DATA forever with no way to ever satisfy it.
      if (source === "RESIDENT" || !wasMeterActiveDuringPeriod(meter, period)) {
        throw new ConflictError(
          "Cannot record a reading for an archived meter"
        );
      }
    }

    const [existingCase] = await tx
      .select({ id: billingCases.id })
      .from(billingCases)
      .where(
        and(
          eq(billingCases.periodId, periodId),
          eq(billingCases.dwellingId, meter.dwellingId)
        )
      )
      .limit(1);
    if (!existingCase) {
      // A dwelling created after this period was created has no billing
      // case for it (createPeriod only snapshots dwellings that existed at
      // the time); accepting a reading anyway would record data no case
      // (and so no admin workbench row) ever tracks or displays it -- spec
      // MTR-003's "visible immediately to admin" would silently fail.
      throw new NotFoundError(
        "No billing case exists for this dwelling in this period"
      );
    }

    const previousValue = await findPreviousValue(tx, meterId, period);
    const isLower =
      previousValue !== null &&
      compareDecimal3(currentValue, previousValue) < 0;
    const isAdminReset = isLower && source === "ADMIN" && options.force;
    if (isLower && !isAdminReset) {
      throw new ConflictError(
        `Current value (${currentValue}) is lower than the previous reading (${previousValue}); an admin must explicitly confirm this reset`
      );
    }
    // A confirmed reset means the meter was physically replaced/rolled
    // over -- the new value isn't a continuation of the old one, so
    // consumption is the new reading itself, not a negative delta against
    // a baseline that no longer applies.
    const consumption =
      previousValue !== null && !isAdminReset
        ? subtractDecimal3(currentValue, previousValue)
        : currentValue;

    const [existing] = await tx
      .select()
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.periodId, periodId),
          eq(meterReadings.meterId, meterId)
        )
      )
      .limit(1);
    if (existing && (await hasLaterReading(tx, meterId, period))) {
      throw new ConflictError(
        "Cannot edit this reading: a later billing period already recorded a reading for this meter"
      );
    }

    const values = {
      previousValue,
      currentValue,
      consumption,
      source,
      submittedByUserId,
      submittedAt: new Date(),
      note: options.note ?? null,
    };

    // A single atomic upsert, not select-then-insert-or-update: two
    // concurrent submissions for the same never-yet-read meter/period would
    // otherwise both see `existing` as undefined and both attempt an
    // INSERT, and the loser would hit a raw unique-violation instead of
    // just recording the later value (same class of race as
    // addAdminMembership in Phase D). `existing` (read just above, before
    // the write) is still used to label the audit action CREATED/UPDATED
    // and to give it a `beforeData` snapshot -- under the rare race window
    // this can misjudge CREATED vs UPDATED, but the persisted data is
    // always correct.
    const [reading] = await tx
      .insert(meterReadings)
      .values({ organizationId, periodId, meterId, ...values })
      .onConflictDoUpdate({
        target: [meterReadings.periodId, meterReadings.meterId],
        set: values,
      })
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: submittedByUserId,
      action: existing ? "METER_READING_UPDATED" : "METER_READING_CREATED",
      entityType: "meter_reading",
      entityId: reading.id,
      beforeData: existing,
      afterData: reading,
    });

    await recalculateCaseReadiness(
      tx,
      organizationId,
      meter.dwellingId,
      periodId
    );
    return reading;
  });
}

// MTR-002.
export async function submitAdminReading(
  db: Db,
  organizationId: string,
  periodId: string,
  meterId: string,
  currentValue: string,
  actorUserId: string,
  options: RecordReadingOptions = {}
) {
  return recordReading(
    db,
    organizationId,
    periodId,
    meterId,
    currentValue,
    "ADMIN",
    actorUserId,
    options
  );
}

// MTR-003: dwellingId is the resident's already-access-checked dwelling
// (requireDwellingAccess ran in the action). The meter's own
// organization_id is used, never one asserted by the caller, and its
// dwelling_id must match -- a valid meter UUID for a *different* dwelling
// is rejected as not found, not as forbidden, so a resident can't probe
// which meter UUIDs exist elsewhere.
export async function submitResidentReading(
  db: Db,
  dwellingId: string,
  periodId: string,
  meterId: string,
  currentValue: string,
  residentUserId: string
) {
  const [meter] = await db
    .select()
    .from(meters)
    .where(eq(meters.id, meterId))
    .limit(1);
  if (!meter || meter.dwellingId !== dwellingId) {
    throw new NotFoundError("Meter not found");
  }

  const [period] = await db
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.id, periodId))
    .limit(1);
  if (!period || period.organizationId !== meter.organizationId) {
    throw new NotFoundError("Billing period not found");
  }

  return recordReading(
    db,
    meter.organizationId,
    periodId,
    meterId,
    currentValue,
    "RESIDENT",
    residentUserId
  );
}
