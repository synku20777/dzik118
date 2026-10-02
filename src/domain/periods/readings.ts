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
import { organizations } from "../../db/schema/organizations";
import { orgLocalDateString } from "../../lib/org-time";
import {
  DECIMAL3_PATTERN,
  compareDecimal3,
  subtractDecimal3,
} from "../../lib/decimal3";
import { recordAuditEvent } from "../../lib/logging/audit";
import {
  computeMissingData,
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
      // The deadline date is inclusive and ends at midnight in the
      // organization's timezone (spec Section 32).
      const [org] = await tx
        .select({ timezone: organizations.timezone })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      const today = orgLocalDateString(new Date(), org.timezone);
      if (today > period.readingDeadline) {
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
      // A dwelling is in a period only when it has a billing case there.
      // Accepting a reading without one would record data no case (and so
      // no admin workbench row) ever tracks or displays -- spec MTR-003's
      // "visible immediately to admin" would silently fail. To bill a
      // dwelling for an earlier period, addDwellingToPeriod (periods.ts)
      // creates the case first.
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
      scopeDwellingId: meter.dwellingId,
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

export const CARRY_FORWARD_NOTE =
  "Carried forward from the previous reading after the reading deadline";

// After the reading deadline, each required meter that still has no reading
// for the period gets one written by the system: the previous value again, so
// consumption is zero and the next real reading bills the whole difference.
// The row is marked source CARRIED_FORWARD with no submitting user, and each
// one has its own audit event. A meter with no earlier reading has nothing to
// carry and stays a NO_READING blocker. An admin can replace a carried
// reading with the real value under the usual reading-edit rules (not once a
// later period has a reading; an existing invoice must be regenerated or
// corrected). Safe to run again: a meter
// that has a reading is skipped. Returns how many readings it wrote.
export async function carryForwardMissingReadings(
  db: Db,
  organizationId: string,
  periodId: string,
  actorUserId: string | null,
  now: Date = new Date()
): Promise<number> {
  return db.transaction(async (tx) => {
    // FOR UPDATE for the same reason as recordReading above.
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
    if (!period || period.status === "LOCKED" || !period.readingDeadline) {
      return 0;
    }
    const [org] = await tx
      .select({
        timezone: organizations.timezone,
        enabled: organizations.carryForwardReadingsEnabled,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    // Opt-in per organization (billing settings). And the deadline day
    // itself still belongs to the residents.
    if (
      !org.enabled ||
      orgLocalDateString(now, org.timezone) <= period.readingDeadline
    ) {
      return 0;
    }

    const blockedCases = await tx
      .select({ dwellingId: billingCases.dwellingId })
      .from(billingCases)
      .where(
        and(
          eq(billingCases.periodId, periodId),
          eq(billingCases.status, "MISSING_DATA")
        )
      );

    let written = 0;
    for (const billingCase of blockedCases) {
      // Resolved now, not read from the stored missing_data: a meter or rule
      // edit since the last recalculation must not get a reading it no
      // longer needs.
      const blockers = await computeMissingData(
        tx,
        organizationId,
        billingCase.dwellingId,
        periodId,
        period
      );
      const meterIds = blockers.flatMap((item) =>
        item.reason === "NO_READING" ? [item.meterId] : []
      );
      let wroteForCase = false;
      for (const meterId of meterIds) {
        const previousValue = await findPreviousValue(tx, meterId, period);
        if (previousValue === null) continue;
        const [reading] = await tx
          .insert(meterReadings)
          .values({
            organizationId,
            periodId,
            meterId,
            previousValue,
            currentValue: previousValue,
            consumption: subtractDecimal3(previousValue, previousValue),
            source: "CARRIED_FORWARD",
            submittedByUserId: null,
            submittedAt: now,
            note: CARRY_FORWARD_NOTE,
          })
          .onConflictDoNothing()
          .returning();
        if (!reading) continue;
        await recordAuditEvent(tx, {
          organizationId,
          scopeDwellingId: billingCase.dwellingId,
          actorUserId,
          action: "METER_READING_CARRIED_FORWARD",
          entityType: "meter_reading",
          entityId: reading.id,
          afterData: reading,
        });
        written++;
        wroteForCase = true;
      }
      if (wroteForCase) {
        await recalculateCaseReadiness(
          tx,
          organizationId,
          billingCase.dwellingId,
          periodId
        );
      }
    }
    return written;
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
