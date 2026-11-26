// Starting readings for the setup (ADR 0012). A meter counts up forever and
// a month is billed as this reading minus the previous one, so the first
// billing month needs the meter's position just before it. That position is
// stored as a reading in a real period: the month before the organization's
// first billing month, marked `opening_readings`, always LOCKED, with no
// billing cases. findPreviousValue (readings.ts) then returns it for the first
// billing month like any earlier reading.
//
// Callers must call requireActiveOrganization() first.
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../../db/client";
import { billingPeriods, meterReadings } from "../../db/schema/billing";
import { dwellings, meterTypeEnum, meters } from "../../db/schema/dwellings";
import { DECIMAL3_PATTERN } from "../../lib/decimal3";
import { recordAuditEvent, recordAuditEvents } from "../../lib/logging/audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { recalculateCaseReadinessForDwellings } from "./case-readiness";
import { getFirstBillingPeriod } from "./periods";

export const OPENING_READING_NOTE = "Starting reading";
export const NO_FIRST_PERIOD_MESSAGE =
  "Create the first billing period before you enter starting readings";
export const OPENING_MONTH_TAKEN_MESSAGE =
  "The month before the first billing period is already a billing period";

const MAX_ROWS = 5_000;

export function monthBefore(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

function monthBounds(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startsOn: `${year}-${mm}-01`, endsOn: `${year}-${mm}-${last}` };
}

// The opening period for the first billing month, made on first use. Locked
// FOR UPDATE so concurrent writers serialize like recordReading's writers.
export async function lockOpeningPeriod(
  tx: Tx,
  organizationId: string,
  actorUserId: string
) {
  // Once made, the opening period stays the organization's only one (unique
  // index); createPeriod refuses months at or before it.
  const [existing] = await tx
    .select()
    .from(billingPeriods)
    .where(
      and(
        eq(billingPeriods.organizationId, organizationId),
        eq(billingPeriods.openingReadings, true)
      )
    )
    .for("update")
    .limit(1);
  if (existing) return existing;

  const first = await getFirstBillingPeriod(tx, organizationId);
  if (!first) throw new ConflictError(NO_FIRST_PERIOD_MESSAGE);
  const { year, month } = monthBefore(first.year, first.month);
  const { startsOn, endsOn } = monthBounds(year, month);

  const [created] = await tx
    .insert(billingPeriods)
    .values({
      organizationId,
      year,
      month,
      startsOn,
      endsOn,
      invoiceIssueDate: endsOn,
      invoiceDueDate: endsOn,
      status: "LOCKED",
      lockedAt: new Date(),
      openingReadings: true,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "PERIOD_CREATED",
      entityType: "billing_period",
      entityId: created.id,
      afterData: created,
    });
  }

  const [period] = await tx
    .select()
    .from(billingPeriods)
    .where(
      and(
        eq(billingPeriods.organizationId, organizationId),
        eq(billingPeriods.year, year),
        eq(billingPeriods.month, month)
      )
    )
    .for("update")
    .limit(1);
  if (!period.openingReadings) {
    throw new ConflictError(OPENING_MONTH_TAKEN_MESSAGE);
  }
  return period;
}

export interface OpeningReadingInput {
  meterId: string;
  value: string;
}

function validateRows(rows: OpeningReadingInput[]) {
  if (rows.length === 0) {
    throw new ValidationError("Enter at least one starting reading");
  }
  if (rows.length > MAX_ROWS) {
    throw new ValidationError("Too many starting readings (up to 5,000)");
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (!DECIMAL3_PATTERN.test(row.value)) {
      throw new ValidationError(
        "Current value must be a non-negative number with at most 3 decimal places"
      );
    }
    if (seen.has(row.meterId)) {
      throw new ValidationError("A meter appears more than once");
    }
    seen.add(row.meterId);
  }
}

export const OPENING_LATER_READING_MESSAGE =
  "This meter already has a later reading, so its starting reading cannot change";

// Inside the caller's transaction, so an import can create meters and write
// their starting readings atomically. A few statements for any number of
// meters: lock, check, upsert and audit are all bulk (a building can have a
// few thousand meters, and a round trip to the database costs milliseconds).
// `rows` must not repeat a meter (validateRows).
export async function writeOpeningReadings(
  tx: Tx,
  organizationId: string,
  rows: OpeningReadingInput[],
  actorUserId: string
) {
  const period = await lockOpeningPeriod(tx, organizationId, actorUserId);
  if (rows.length === 0) return period;

  const meterRows: (typeof meters.$inferSelect)[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    // Ordered locks, so two imports cannot wait on each other in a circle.
    meterRows.push(
      ...(await tx
        .select()
        .from(meters)
        .where(
          and(
            inArray(
              meters.id,
              rows.slice(i, i + 500).map((r) => r.meterId)
            ),
            eq(meters.organizationId, organizationId)
          )
        )
        .orderBy(asc(meters.id))
        .for("update"))
    );
  }
  // Ownership first: a meter of another organization (or none) must not be
  // told apart by what readings it has.
  const byId = new Map(meterRows.map((m) => [m.id, m]));
  for (const row of rows) {
    const meter = byId.get(row.meterId);
    if (!meter) throw new NotFoundError("Meter not found");
    if (meter.archivedAt) {
      throw new ConflictError("Cannot record a reading for an archived meter");
    }
  }

  const before = new Map<string, typeof meterReadings.$inferSelect>();
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.meterId);
    for (const reading of await tx
      .select()
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.periodId, period.id),
          inArray(meterReadings.meterId, ids)
        )
      )) {
      before.set(reading.meterId, reading);
    }
    // A later reading computed its consumption from the old start, so the
    // start can no longer change without making that reading wrong.
    const [later] = await tx
      .select({ id: meterReadings.id })
      .from(meterReadings)
      .innerJoin(billingPeriods, eq(billingPeriods.id, meterReadings.periodId))
      .where(
        and(
          inArray(meterReadings.meterId, ids),
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
    if (later) throw new ConflictError(OPENING_LATER_READING_MESSAGE);
  }

  const written: (typeof meterReadings.$inferSelect)[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    written.push(
      ...(await tx
        .insert(meterReadings)
        .values(
          rows.slice(i, i + 500).map((row) => ({
            organizationId,
            periodId: period.id,
            meterId: row.meterId,
            previousValue: null,
            currentValue: row.value,
            // Required column; the opening period is left out of consumption
            // views.
            consumption: "0.000",
            source: "IMPORT" as const,
            submittedByUserId: actorUserId,
            submittedAt: new Date(),
            note: OPENING_READING_NOTE,
          }))
        )
        .onConflictDoUpdate({
          target: [meterReadings.periodId, meterReadings.meterId],
          set: {
            previousValue: null,
            currentValue: sql`excluded.current_value`,
            consumption: "0.000",
            source: "IMPORT" as const,
            submittedByUserId: actorUserId,
            submittedAt: new Date(),
            note: OPENING_READING_NOTE,
          },
        })
        .returning())
    );
  }
  await recordAuditEvents(
    tx,
    written.map((reading) => ({
      organizationId,
      scopeDwellingId: byId.get(reading.meterId)!.dwellingId,
      actorUserId,
      action: "METER_OPENING_READING_RECORDED",
      entityType: "meter_reading",
      entityId: reading.id,
      beforeData: before.get(reading.meterId) ?? null,
      afterData: reading,
    }))
  );
  return period;
}

// New meters for imports, with their audit events and a single recalculation
// of the open cases of the dwellings they belong to (a new meter can add a
// blocker, as in createMeter).
export async function createMetersBulk(
  tx: Tx,
  organizationId: string,
  rows: {
    dwellingId: string;
    type: (typeof meterTypeEnum.enumValues)[number];
    serialNumber: string | null;
    unit: string;
  }[],
  actorUserId: string
) {
  const created: (typeof meters.$inferSelect)[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    created.push(
      ...(await tx
        .insert(meters)
        .values(rows.slice(i, i + 500).map((r) => ({ organizationId, ...r })))
        .returning())
    );
  }
  await recordAuditEvents(
    tx,
    created.map((meter) => ({
      organizationId,
      scopeDwellingId: meter.dwellingId,
      actorUserId,
      action: "METER_CREATED",
      entityType: "meter",
      entityId: meter.id,
      afterData: meter,
    }))
  );
  await recalculateCaseReadinessForDwellings(tx, organizationId, [
    ...new Set(created.map((m) => m.dwellingId)),
  ]);
  return created;
}

// The meter a spreadsheet row means: by serial number when given, else the one
// active meter of that type in the dwelling. `ambiguous` when several fit.
export function matchMeter<
  M extends {
    dwellingId: string;
    type: string;
    serialNumber: string | null;
    id: string;
  },
>(
  orgMeters: M[],
  dwellingId: string,
  type: string,
  serialNumber: string
): { meter: M | null; ambiguous: boolean } {
  const candidates = orgMeters.filter(
    (m) =>
      m.dwellingId === dwellingId &&
      m.type === type &&
      (!serialNumber || m.serialNumber === serialNumber)
  );
  return {
    meter: candidates.length === 1 ? candidates[0] : null,
    ambiguous: candidates.length > 1,
  };
}

export async function recordOpeningReadings(
  db: Db,
  organizationId: string,
  rows: OpeningReadingInput[],
  actorUserId: string
) {
  validateRows(rows);
  return db.transaction(async (tx) => {
    const period = await writeOpeningReadings(
      tx,
      organizationId,
      rows,
      actorUserId
    );
    return { periodId: period.id, written: rows.length };
  });
}

// The starting reading of each meter of the organization, if any.
export async function listOpeningReadings(db: DbOrTx, organizationId: string) {
  return db
    .select({
      meterId: meterReadings.meterId,
      value: meterReadings.currentValue,
    })
    .from(meterReadings)
    .innerJoin(billingPeriods, eq(billingPeriods.id, meterReadings.periodId))
    .where(
      and(
        eq(meterReadings.organizationId, organizationId),
        eq(billingPeriods.openingReadings, true)
      )
    );
}

// Every active meter of the organization with its dwelling number and its
// starting reading (null when none), for the setup's meters step.
export async function listMetersWithOpeningReading(
  db: Db,
  organizationId: string
) {
  const opening = new Map(
    (await listOpeningReadings(db, organizationId)).map((r) => [
      r.meterId,
      r.value,
    ])
  );
  const rows = await db
    .select({
      meterId: meters.id,
      dwellingId: meters.dwellingId,
      dwellingNumber: dwellings.number,
      type: meters.type,
      label: meters.label,
      serialNumber: meters.serialNumber,
      unit: meters.unit,
    })
    .from(meters)
    .innerJoin(dwellings, eq(dwellings.id, meters.dwellingId))
    .where(
      and(
        eq(meters.organizationId, organizationId),
        isNull(meters.archivedAt),
        isNull(dwellings.archivedAt)
      )
    )
    .orderBy(dwellings.number, meters.type);
  return rows.map((r) => ({
    ...r,
    openingValue: opening.get(r.meterId) ?? null,
  }));
}
