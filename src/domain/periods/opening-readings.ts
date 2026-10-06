// Starting readings for the setup (ADR 0012). A meter counts up forever and
// a month is billed as this reading minus the previous one, so the first
// billing month needs the meter's position just before it. That position is
// stored as a reading in a real period: the month before the organization's
// first billing month, marked `opening_readings`, always LOCKED, with no
// billing cases. findPreviousValue (readings.ts) then returns it for the first
// billing month like any earlier reading.
//
// Callers must call requireActiveOrganization() first.
import Papa from "papaparse";
import { and, eq, isNull } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../../db/client";
import { billingPeriods, meterReadings } from "../../db/schema/billing";
import { dwellings, meterTypeEnum, meters } from "../../db/schema/dwellings";
import { DECIMAL3_PATTERN } from "../../lib/decimal3";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { ImportHeaderError } from "../organizations/csv-import";
import { recalculateCaseReadinessForOpenPeriods } from "./case-readiness";
import { getFirstBillingPeriod } from "./periods";
import { hasLaterReading } from "./readings";

export const OPENING_READING_NOTE = "Starting reading";
export const NO_FIRST_PERIOD_MESSAGE =
  "Create the first billing period before you enter starting readings";
export const OPENING_MONTH_TAKEN_MESSAGE =
  "The month before the first billing period is already a billing period";

const MAX_ROWS = 5_000;
const MAX_CSV_BYTES = 2_000_000;
const METER_TYPES = new Set<string>(meterTypeEnum.enumValues);

function monthBefore(year: number, month: number) {
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
async function lockOpeningPeriod(
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

// Inside the caller's transaction, so the CSV import can create meters and
// write their starting readings atomically.
async function writeOpeningReadings(
  tx: Tx,
  organizationId: string,
  rows: OpeningReadingInput[],
  actorUserId: string
) {
  const period = await lockOpeningPeriod(tx, organizationId, actorUserId);
  for (const row of rows) {
    const [meter] = await tx
      .select()
      .from(meters)
      .where(
        and(
          eq(meters.id, row.meterId),
          eq(meters.organizationId, organizationId)
        )
      )
      .for("update")
      .limit(1);
    if (!meter) throw new NotFoundError("Meter not found");
    if (meter.archivedAt) {
      throw new ConflictError("Cannot record a reading for an archived meter");
    }
    // A later reading computed its consumption from the old start, so the
    // start can no longer change without making that reading wrong.
    if (await hasLaterReading(tx, meter.id, period)) {
      throw new ConflictError(
        "This meter already has a later reading, so its starting reading cannot change"
      );
    }
    const [before] = await tx
      .select()
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.periodId, period.id),
          eq(meterReadings.meterId, meter.id)
        )
      )
      .limit(1);
    const values = {
      previousValue: null,
      currentValue: row.value,
      // Required column; the opening period is left out of consumption views.
      consumption: "0.000",
      source: "IMPORT" as const,
      submittedByUserId: actorUserId,
      submittedAt: new Date(),
      note: OPENING_READING_NOTE,
    };
    const [reading] = await tx
      .insert(meterReadings)
      .values({
        organizationId,
        periodId: period.id,
        meterId: meter.id,
        ...values,
      })
      .onConflictDoUpdate({
        target: [meterReadings.periodId, meterReadings.meterId],
        set: values,
      })
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      scopeDwellingId: meter.dwellingId,
      actorUserId,
      action: "METER_OPENING_READING_RECORDED",
      entityType: "meter_reading",
      entityId: reading.id,
      beforeData: before,
      afterData: reading,
    });
  }
  return period;
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
export async function listOpeningReadings(db: Db, organizationId: string) {
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

// ---- CSV import of last month's readings from the old system.

export const OPENING_READINGS_HEADERS = [
  "dwelling_number",
  "meter_type",
  "serial_number",
  "unit",
  "reading",
];

export interface OpeningReadingCsvRow {
  rowNumber: number;
  dwellingNumber: string;
  meterType: string;
  serialNumber: string;
  unit: string;
  reading: string;
  // USE: an existing meter; CREATE: the import adds the meter.
  status: "USE" | "CREATE" | "ERROR";
  meterId: string | null;
  dwellingId: string | null;
  errors: string[];
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function validateOpeningReadingsCsv(
  db: DbOrTx,
  organizationId: string,
  csvText: string
): Promise<{ rows: OpeningReadingCsvRow[]; headerError: string | null }> {
  if (new TextEncoder().encode(csvText).length > MAX_CSV_BYTES) {
    return { rows: [], headerError: "The CSV file is too large (up to 2 MB)." };
  }
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const headers = parsed.meta.fields ?? [];
  const missing = OPENING_READINGS_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      headerError: `Missing required column(s): ${missing.join(", ")}`,
    };
  }
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    return {
      rows: [],
      headerError: `Could not parse the file (row ${(first.row ?? 0) + 1}: ${first.message}). Check the file is a valid CSV and try again.`,
    };
  }
  if (parsed.data.length > MAX_ROWS) {
    return {
      rows: [],
      headerError: "The CSV file has too many rows (up to 5,000).",
    };
  }

  const orgDwellings = await db
    .select({ id: dwellings.id, number: dwellings.number })
    .from(dwellings)
    .where(
      and(
        eq(dwellings.organizationId, organizationId),
        isNull(dwellings.archivedAt)
      )
    );
  const dwellingByNumber = new Map(orgDwellings.map((d) => [d.number, d.id]));
  const orgMeters = await db
    .select()
    .from(meters)
    .where(
      and(eq(meters.organizationId, organizationId), isNull(meters.archivedAt))
    );
  const seenMeters = new Set<string>();

  const rows = parsed.data.map((raw, index): OpeningReadingCsvRow => {
    const errors: string[] = [];
    const dwellingNumber = cell(raw, "dwelling_number");
    const meterType = cell(raw, "meter_type").toUpperCase();
    const serialNumber = cell(raw, "serial_number");
    const unit = cell(raw, "unit") || "m3";
    const reading = cell(raw, "reading").replace(",", ".");

    const dwellingId = dwellingByNumber.get(dwellingNumber) ?? null;
    if (!dwellingNumber) errors.push("dwelling_number is required");
    else if (!dwellingId) {
      errors.push(`dwelling "${dwellingNumber}" does not exist`);
    }
    if (!METER_TYPES.has(meterType)) {
      errors.push(
        `meter_type "${meterType}" is not one of ${[...METER_TYPES].join(", ")}`
      );
    }
    if (!DECIMAL3_PATTERN.test(reading)) {
      errors.push(
        "reading must be a non-negative number with at most 3 decimal places"
      );
    }
    if (serialNumber.length > 100) {
      errors.push("serial_number exceeds 100 characters");
    }
    if (unit.length > 20) errors.push("unit exceeds 20 characters");

    // The meter: by serial when given, else the one active meter of that
    // type in the dwelling. None: the import creates it.
    let meterId: string | null = null;
    if (dwellingId && errors.length === 0) {
      const candidates = orgMeters.filter(
        (m) =>
          m.dwellingId === dwellingId &&
          m.type === meterType &&
          (!serialNumber || m.serialNumber === serialNumber)
      );
      if (candidates.length > 1) {
        errors.push(
          "the dwelling has more than one meter of this type; add serial_number"
        );
      } else if (candidates.length === 1) {
        meterId = candidates[0].id;
        if (seenMeters.has(meterId)) {
          errors.push("this meter appears more than once in the file");
        }
        seenMeters.add(meterId);
      }
    }

    return {
      rowNumber: index + 1,
      dwellingNumber,
      meterType,
      serialNumber,
      unit,
      reading,
      status: errors.length > 0 ? "ERROR" : meterId ? "USE" : "CREATE",
      meterId,
      dwellingId,
      errors,
    };
  });

  // Two rows that would create the same new meter.
  const newKeys = new Set<string>();
  for (const row of rows) {
    if (row.status !== "CREATE") continue;
    const key = `${row.dwellingId}|${row.meterType}|${row.serialNumber}`;
    if (newKeys.has(key)) {
      row.status = "ERROR";
      row.errors.push("this meter appears more than once in the file");
    }
    newKeys.add(key);
  }
  return { rows, headerError: null };
}

// Re-validates from the raw text, like importDwellingsCsv. All or nothing:
// a file with any error row writes nothing. The opening period is locked
// first and the file is validated inside the same transaction, so two
// imports at the same time cannot both create the same missing meter.
export async function importOpeningReadingsCsv(
  db: Db,
  organizationId: string,
  csvText: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    await lockOpeningPeriod(tx, organizationId, actorUserId);
    const { rows, headerError } = await validateOpeningReadingsCsv(
      tx,
      organizationId,
      csvText
    );
    if (headerError) throw new ImportHeaderError(headerError);
    if (rows.length === 0) {
      throw new ValidationError("Enter at least one starting reading");
    }
    if (rows.some((r) => r.status === "ERROR")) {
      throw new ValidationError("Fix the rows with errors, then import again");
    }

    let createdMeters = 0;
    const inputs: OpeningReadingInput[] = [];
    for (const row of rows) {
      let meterId = row.meterId;
      if (!meterId) {
        const [meter] = await tx
          .insert(meters)
          .values({
            organizationId,
            dwellingId: row.dwellingId!,
            type: row.meterType as (typeof meterTypeEnum.enumValues)[number],
            serialNumber: row.serialNumber || null,
            unit: row.unit,
          })
          .returning();
        await recordAuditEvent(tx, {
          organizationId,
          scopeDwellingId: meter.dwellingId,
          actorUserId,
          action: "METER_CREATED",
          entityType: "meter",
          entityId: meter.id,
          afterData: meter,
        });
        // Same as createMeter: a new meter can add a blocker to open cases.
        await recalculateCaseReadinessForOpenPeriods(
          tx,
          organizationId,
          meter.dwellingId
        );
        meterId = meter.id;
        createdMeters++;
      }
      inputs.push({ meterId, value: row.reading });
    }
    validateRows(inputs);
    await writeOpeningReadings(tx, organizationId, inputs, actorUserId);
    return { createdMeters, written: inputs.length };
  });
}
