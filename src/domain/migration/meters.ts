// Meters and the latest reading of each, from a mapped spreadsheet (ADR 0013).
// The reading becomes the meter's starting reading: its position at the end of
// the month before the first billing month, stored in the organization's
// opening-readings period (ADR 0012). Only the latest reading of a meter is
// kept; the data model has no history. Missing meters are created. Validation
// is read-only; the import re-parses the raw text and re-validates inside its
// own transaction, after taking the opening-period lock that serializes
// imports. Callers must call requireActiveOrganization() first.
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { billingPeriods, meterReadings } from "../../db/schema/billing";
import { dwellings, meters } from "../../db/schema/dwellings";
import { migrationImports, migrationMappings } from "../../db/schema/migration";
import { DECIMAL3_PATTERN } from "../../lib/decimal3";
import { sha256Hex } from "../../lib/hash";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ValidationError } from "../errors";
import { ROW_BALANCE_UNKNOWN_ERROR } from "./balances";
import {
  NO_FIRST_PERIOD_MESSAGE,
  OPENING_LATER_READING_MESSAGE,
  createMetersBulk,
  listOpeningReadings,
  lockOpeningPeriod,
  matchMeter,
  monthBefore,
  writeOpeningReadings,
} from "../periods/opening-readings";
import { getFirstBillingPeriod } from "../periods/periods";
import { ROW_BALANCE_ARCHIVED_ERROR } from "./balances";
import {
  IMPORT_FIX_ROWS_ERROR,
  ROW_NUMBER_LENGTH_ERROR,
  ROW_NUMBER_REQUIRED_ERROR,
  ROW_TEXT_LENGTH_ERROR,
} from "./dwellings";
import { parseTable } from "./files";
import { cell } from "./limits";
import {
  fingerprintHeaders,
  toSavedMapping,
  validateMapping,
  type MappingSource,
} from "./mapping";
import {
  detectDecimalSeparator,
  parseDate,
  parseDecimal,
  parseMeterType,
  type MeterTypeName,
} from "./values";

export const ROW_METER_TYPE_ERROR =
  "The meter type is not recognized: use cold water, hot water, electricity, gas or heat";
export const ROW_METER_READING_ERROR =
  "The reading must be a number of zero or more with at most 3 decimals";
export const ROW_METER_UNIT_ERROR = "The unit is required for this meter type";
export const ROW_METER_AMBIGUOUS_ERROR =
  "The dwelling has more than one meter of this type. Add the serial number";
export const ROW_METER_DUPLICATE_ERROR =
  "This meter appears more than once in the file. Add a reading date to keep the latest";
export const ROW_METER_SAME_DATE_ERROR =
  "Two readings of this meter have the same date";
export const ROW_METER_DATE_ERROR = "The reading date is not a valid date";
export const ROW_METER_AFTER_START_ERROR =
  "The reading is dated after the first billing period starts. Use the reading from the end of the previous month";
export const ROW_METER_OLDER_SKIP_MESSAGE =
  "An older reading of this meter. Only the latest is kept";
export const ROW_METER_SAME_SKIP_MESSAGE = "Already the starting reading";
export const ROW_METER_REPLACE_WARNING_MESSAGE =
  "Replaces the starting reading already saved";
export const IMPORT_METER_MAPPING_ERROR =
  "Map the dwelling number, the meter type and the reading";

// Units for a new meter when the file has none. Heat meters differ (MWh, GJ),
// so they must say.
const DEFAULT_UNIT: Partial<Record<MeterTypeName, string>> = {
  COLD_WATER: "m3",
  HOT_WATER: "m3",
  ELECTRICITY: "kWh",
  GAS: "m3",
};

export interface MigrationMeterRow {
  rowNumber: number;
  number: string;
  dwellingId?: string;
  meterType: MeterTypeName | null;
  serialNumber: string;
  unit: string;
  // The reading with three decimals, "" when it is not a valid number.
  reading: string;
  readingDate?: string;
  // The matched meter, or null when the import creates one.
  meterId: string | null;
  // The starting reading saved before, for a meter that has one.
  previousValue: string | null;
  status: "POST" | "SKIP" | "ERROR";
  errors: string[];
  warnings: string[];
  skipReason?: string;
}

export interface MeterValidation {
  rows: MigrationMeterRow[];
  counts: { post: number; newMeters: number; skip: number; error: number };
}

// "12.4" -> "12.400", "007.5" -> "7.500": the form the database returns, so two
// readings can be compared as text.
function threeDecimals(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(3, "0")}`;
}

export async function validateMeters(
  db: DbOrTx,
  organizationId: string,
  table: { headers: string[]; rows: string[][]; delimiter?: string },
  fields: (string | null)[]
): Promise<MeterValidation> {
  const first = await getFirstBillingPeriod(db, organizationId);
  if (!first) throw new ValidationError(NO_FIRST_PERIOD_MESSAGE);
  const opening = monthBefore(first.year, first.month);

  const index = new Map<string, number>();
  fields.forEach((f, i) => {
    if (f) index.set(f, i);
  });
  const readingSeparator = detectDecimalSeparator(
    table.rows.map((r) => r[index.get("reading") ?? -1] ?? "").filter(Boolean),
    table.delimiter
  );

  const dwellingRows = await db
    .select({
      id: dwellings.id,
      number: dwellings.number,
      archivedAt: dwellings.archivedAt,
    })
    .from(dwellings)
    .where(eq(dwellings.organizationId, organizationId));
  const byNumber = new Map(dwellingRows.map((d) => [d.number, d]));
  const orgMeters = await db
    .select()
    .from(meters)
    .where(
      and(eq(meters.organizationId, organizationId), isNull(meters.archivedAt))
    );
  const savedStart = new Map(
    (await listOpeningReadings(db, organizationId)).map((r) => [
      r.meterId,
      r.value,
    ])
  );

  type Draft = MigrationMeterRow & { key: string };
  const drafts: Draft[] = table.rows.map((raw, i) => {
    const get = (key: string) =>
      index.has(key) ? cell({ v: raw[index.get(key)!] }, "v") : "";
    const errors: string[] = [];
    const number = get("number");
    if (number === "") errors.push(ROW_NUMBER_REQUIRED_ERROR);
    else if (number.length > 50) errors.push(ROW_NUMBER_LENGTH_ERROR);

    const dwelling = number !== "" ? byNumber.get(number) : undefined;
    if (number !== "" && number.length <= 50) {
      if (!dwelling) errors.push(ROW_BALANCE_UNKNOWN_ERROR);
      else if (dwelling.archivedAt) errors.push(ROW_BALANCE_ARCHIVED_ERROR);
    }

    const typeRaw = get("meter_type");
    const parsedType = parseMeterType(typeRaw);
    if (!parsedType.ok) errors.push(ROW_METER_TYPE_ERROR);
    const meterType = parsedType.ok ? parsedType.value : null;

    const serialNumber = get("serial_number");
    if (serialNumber.length > 100) errors.push(ROW_TEXT_LENGTH_ERROR);

    const readingRaw = get("reading");
    let reading = "";
    const parsedReading = parseDecimal(readingRaw, readingSeparator);
    if (parsedReading.ok && DECIMAL3_PATTERN.test(parsedReading.value)) {
      reading = threeDecimals(parsedReading.value);
    } else {
      errors.push(ROW_METER_READING_ERROR);
    }

    let readingDate: string | undefined;
    const dateRaw = get("reading_date");
    if (dateRaw !== "") {
      const parsed = parseDate(dateRaw);
      if (!parsed.ok) errors.push(ROW_METER_DATE_ERROR);
      else if (parsed.value > first.startsOn) {
        // Stored as the closing value of the previous month, a later reading
        // would under-bill the first days of the first month.
        errors.push(ROW_METER_AFTER_START_ERROR);
      } else readingDate = parsed.value;
    }

    // The meter: the matching existing one, or a new one.
    let meterId: string | null = null;
    let key = `new|${dwelling?.id}|${meterType}|${serialNumber}`;
    if (dwelling && meterType && errors.length === 0) {
      const match = matchMeter(orgMeters, dwelling.id, meterType, serialNumber);
      if (match.ambiguous) errors.push(ROW_METER_AMBIGUOUS_ERROR);
      else if (match.meter) {
        meterId = match.meter.id;
        key = `meter|${meterId}`;
      }
    }

    let unit = get("unit").replace(/³/g, "3");
    if (unit.length > 20) errors.push(ROW_TEXT_LENGTH_ERROR);
    if (meterId === null && meterType && errors.length === 0 && unit === "") {
      unit = DEFAULT_UNIT[meterType] ?? "";
      if (unit === "") errors.push(ROW_METER_UNIT_ERROR);
    }

    return {
      rowNumber: i + 1,
      number,
      dwellingId: dwelling?.id,
      meterType,
      serialNumber,
      unit,
      reading,
      readingDate,
      meterId,
      previousValue: meterId ? (savedStart.get(meterId) ?? null) : null,
      status: errors.length > 0 ? "ERROR" : "POST",
      errors,
      warnings: [],
      key,
    };
  });

  // A meter named twice: keep the latest dated row, skip the older ones. Without
  // dates there is no way to tell which is latest, so that is an error.
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (d.status === "ERROR") continue;
    groups.set(d.key, [...(groups.get(d.key) ?? []), d]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (group.some((d) => !d.readingDate)) {
      for (const d of group) {
        d.status = "ERROR";
        d.errors.push(ROW_METER_DUPLICATE_ERROR);
      }
      continue;
    }
    const latest = group
      .map((d) => d.readingDate!)
      .sort()
      .at(-1)!;
    const atLatest = group.filter((d) => d.readingDate === latest);
    if (atLatest.length > 1) {
      for (const d of atLatest) {
        d.status = "ERROR";
        d.errors.push(ROW_METER_SAME_DATE_ERROR);
      }
    }
    for (const d of group) {
      if (d.readingDate !== latest) {
        d.status = "SKIP";
        d.skipReason = ROW_METER_OLDER_SKIP_MESSAGE;
      }
    }
  }

  // A meter that already has a reading in a billing period cannot get a new
  // starting reading.
  const withLater = new Set<string>();
  const ids = drafts
    .filter((d) => d.status === "POST" && d.meterId)
    .map((d) => d.meterId!);
  for (let i = 0; i < ids.length; i += 500) {
    const later = await db
      .selectDistinct({ meterId: meterReadings.meterId })
      .from(meterReadings)
      .innerJoin(billingPeriods, eq(billingPeriods.id, meterReadings.periodId))
      .where(
        and(
          inArray(meterReadings.meterId, ids.slice(i, i + 500)),
          or(
            gt(billingPeriods.year, opening.year),
            and(
              eq(billingPeriods.year, opening.year),
              gt(billingPeriods.month, opening.month)
            )
          )
        )
      );
    for (const r of later) withLater.add(r.meterId);
  }
  for (const d of drafts) {
    if (d.status !== "POST" || !d.meterId) continue;
    // An unchanged starting reading is a harmless row even after billing has
    // started; only a changed one is blocked by a later reading.
    if (
      d.previousValue !== null &&
      threeDecimals(d.previousValue) === d.reading
    ) {
      d.status = "SKIP";
      d.skipReason = ROW_METER_SAME_SKIP_MESSAGE;
    } else if (withLater.has(d.meterId)) {
      d.status = "ERROR";
      d.errors.push(OPENING_LATER_READING_MESSAGE);
    } else if (d.previousValue !== null) {
      d.warnings.push(ROW_METER_REPLACE_WARNING_MESSAGE);
    }
  }

  const rows: MigrationMeterRow[] = drafts.map(({ key: _key, ...row }) => row);
  const count = (s: MigrationMeterRow["status"]) =>
    rows.filter((r) => r.status === s).length;
  return {
    rows,
    counts: {
      post: count("POST"),
      newMeters: rows.filter((r) => r.status === "POST" && !r.meterId).length,
      skip: count("SKIP"),
      error: count("ERROR"),
    },
  };
}

export interface MeterImportInput {
  // The raw file text; everything is re-derived from it here, including the
  // hash that is stored with the import.
  text: string;
  filename: string;
  fields: (string | null)[];
  mappingSources: MappingSource[];
}

export interface MeterImportResult {
  importId: string | null;
  written: number;
  createdMeters: number;
  skipped: number;
}

export async function importMeters(
  db: Db,
  organizationId: string,
  input: MeterImportInput,
  actorUserId: string
): Promise<MeterImportResult> {
  const table = parseTable(input.text);
  if (
    validateMapping("METERS", table.headers.length, input.fields).length > 0
  ) {
    throw new ValidationError(IMPORT_METER_MAPPING_ERROR);
  }
  const fingerprint = await fingerprintHeaders(table.headers);
  const sourceSha256 = await sha256Hex(new TextEncoder().encode(input.text));
  const numberColumn = input.fields.indexOf("number");
  const numbers = [
    ...new Set(
      table.rows
        .map((r) => cell({ v: r[numberColumn] }, "v"))
        .filter((n) => n !== "")
    ),
  ];

  return db.transaction(async (tx) => {
    // The same lock every starting-readings write takes: two imports (or an
    // import and a typed reading) cannot both create the same missing meter.
    await lockOpeningPeriod(tx, organizationId, actorUserId);
    // createMeter does not take that lock, but its insert needs a key share on
    // the dwelling. FOR UPDATE conflicts with it, so a meter added by hand at
    // the same moment is either seen by the check below or waits until this
    // import is done: no duplicate meter.
    for (let i = 0; i < numbers.length; i += 500) {
      await tx
        .select({ id: dwellings.id })
        .from(dwellings)
        .where(
          and(
            eq(dwellings.organizationId, organizationId),
            inArray(dwellings.number, numbers.slice(i, i + 500))
          )
        )
        .orderBy(asc(dwellings.id))
        .for("update");
    }
    const { rows, counts } = await validateMeters(
      tx,
      organizationId,
      table,
      input.fields
    );
    if (counts.error > 0) throw new ValidationError(IMPORT_FIX_ROWS_ERROR);
    if (counts.post === 0) {
      return {
        importId: null,
        written: 0,
        createdMeters: 0,
        skipped: counts.skip,
      };
    }

    const posting = rows.filter((r) => r.status === "POST");
    const missing = posting.filter((r) => !r.meterId);
    const created = await createMetersBulk(
      tx,
      organizationId,
      missing.map((r) => ({
        dwellingId: r.dwellingId!,
        type: r.meterType!,
        serialNumber: r.serialNumber || null,
        unit: r.unit,
      })),
      actorUserId
    );
    const newIds = new Map(missing.map((r, i) => [r, created[i].id]));
    await writeOpeningReadings(
      tx,
      organizationId,
      posting.map((r) => ({
        meterId: r.meterId ?? newIds.get(r)!,
        value: r.reading,
      })),
      actorUserId
    );

    const [importRow] = await tx
      .insert(migrationImports)
      .values({
        organizationId,
        kind: "METERS",
        sourceFilename: input.filename.slice(0, 200),
        sourceSha256,
        mapping: input.fields,
        mappingSources: input.mappingSources,
        fingerprint,
        rowCount: rows.length,
        // New starting readings, and ones that replaced a saved reading.
        createdCount: posting.filter((r) => r.previousValue === null).length,
        updatedCount: posting.filter((r) => r.previousValue !== null).length,
        skippedCount: counts.skip,
        totals: {
          readingsWritten: posting.length,
          metersCreated: created.length,
        },
        importedByUserId: actorUserId,
      })
      .returning({ id: migrationImports.id });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "MIGRATION_IMPORT_COMPLETED",
      entityType: "migration_import",
      entityId: importRow.id,
      afterData: {
        kind: "METERS",
        readingsWritten: posting.length,
        metersCreated: created.length,
        skipped: counts.skip,
      },
    });
    const saved = toSavedMapping(table.headers, input.fields);
    await tx
      .insert(migrationMappings)
      .values({ organizationId, kind: "METERS", fingerprint, mapping: saved })
      .onConflictDoUpdate({
        target: [
          migrationMappings.organizationId,
          migrationMappings.kind,
          migrationMappings.fingerprint,
        ],
        set: { mapping: saved, lastUsedAt: new Date() },
      });
    return {
      importId: importRow.id,
      written: posting.length,
      createdMeters: created.length,
      skipped: counts.skip,
    };
  });
}
