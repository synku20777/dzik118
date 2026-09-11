// Phase D (Organizations/dwellings) - Dwelling CSV import/export (spec
// Section 26, DWL-004). No interactive column-mapping UI: the header row
// must use the exact logical column names from Section 26. Freeform mapping
// (spec Section 29's CsvImportMapper.tsx) can be added if a real need for
// non-standard headers shows up; nothing in DWL-004's acceptance criteria
// requires it.
import Papa from "papaparse";
import { and, eq } from "drizzle-orm";
import { z } from "astro/zod";
import type { Db } from "../../db/client";
import { dwellingTypeEnum, dwellings, meters } from "../../db/schema/dwellings";
import { recordAuditEvent } from "../../lib/logging/audit";

const DWELLING_TYPES = new Set<string>(dwellingTypeEnum.enumValues);

// The only error importDwellingsCsv throws with a message safe to show an
// admin verbatim (no SQL/PII); anything else must be shown as a generic
// message instead.
export class ImportHeaderError extends Error {}

export type DwellingImportMode = "create" | "update";
export type DwellingImportRowStatus = "CREATE" | "UPDATE" | "ERROR";

export interface DwellingImportRow {
  rowNumber: number;
  number: string;
  type: string;
  displayName: string;
  occupantName: string;
  billingName: string;
  billingEmail: string;
  billingAddress: string;
  areaM2: string;
  residentCount: string;
  coldWaterMeterSerial: string;
  hotWaterMeterSerial: string;
  status: DwellingImportRowStatus;
  errors: string[];
}

const REQUIRED_HEADERS = [
  "number",
  "type",
  "display_name",
  "occupant_name",
  "billing_name",
  "billing_email",
  "billing_address",
  "area_m2",
  "resident_count",
  "cold_water_meter_serial",
  "hot_water_meter_serial",
];

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

// Parses and validates in one pass; returns rows classified CREATE/UPDATE/
// ERROR without writing anything (spec Section 26 UX: "preview" before
// "confirm", same principle as bank CSV's "never write immediately").
export async function validateDwellingsCsv(
  db: Db,
  organizationId: string,
  csvText: string,
  mode: DwellingImportMode
): Promise<{ rows: DwellingImportRow[]; headerError: string | null }> {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = parsed.meta.fields ?? [];
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return {
      rows: [],
      headerError: `Missing required column(s): ${missingHeaders.join(", ")}`,
    };
  }
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    return {
      rows: [],
      headerError: `Could not parse the file (row ${(first.row ?? 0) + 1}: ${first.message}). Check the file is a valid CSV and try again.`,
    };
  }

  const existingDwellings = await db
    .select({ number: dwellings.number })
    .from(dwellings)
    .where(eq(dwellings.organizationId, organizationId));
  const existingNumbers = new Set(existingDwellings.map((d) => d.number));
  const seenInFile = new Set<string>();

  const rows: DwellingImportRow[] = parsed.data.map((raw, index) => {
    const errors: string[] = [];
    const number = cell(raw, "number");
    const typeRaw = cell(raw, "type").toUpperCase();
    const areaM2 = cell(raw, "area_m2");
    const residentCount = cell(raw, "resident_count");

    if (!number) {
      errors.push("number is required");
    } else if (seenInFile.has(number)) {
      errors.push(`duplicate number "${number}" in this file`);
    } else {
      seenInFile.add(number);
    }

    const type = typeRaw || "APARTMENT";
    if (typeRaw && !DWELLING_TYPES.has(typeRaw)) {
      errors.push(
        `type "${typeRaw}" is not one of ${[...DWELLING_TYPES].join(", ")}`
      );
    }

    // Strict digit regexes, not Number(): Number("0x10") is 16, so a naive
    // Number.isInteger(Number(v)) check would silently accept hex/exponent
    // notation as a plain count.
    if (areaM2 && !/^\d+(\.\d+)?$/.test(areaM2)) {
      errors.push("area_m2 must be a non-negative number");
    }
    if (residentCount && !/^\d+$/.test(residentCount)) {
      errors.push("resident_count must be a non-negative whole number");
    }
    const billingEmail = cell(raw, "billing_email");
    if (billingEmail && !z.email().safeParse(billingEmail).success) {
      errors.push(`billing_email "${billingEmail}" is not a valid email`);
    }

    const displayName = cell(raw, "display_name");
    const occupantName = cell(raw, "occupant_name");
    const billingName = cell(raw, "billing_name");
    const billingAddress = cell(raw, "billing_address");
    const coldWaterMeterSerial = cell(raw, "cold_water_meter_serial");
    const hotWaterMeterSerial = cell(raw, "hot_water_meter_serial");

    if (number.length > 50) errors.push("number exceeds 50 characters");
    if (displayName.length > 200)
      errors.push("display_name exceeds 200 characters");
    if (occupantName.length > 200)
      errors.push("occupant_name exceeds 200 characters");
    if (billingName.length > 200)
      errors.push("billing_name exceeds 200 characters");
    if (billingAddress.length > 300)
      errors.push("billing_address exceeds 300 characters");
    if (coldWaterMeterSerial.length > 100)
      errors.push("cold_water_meter_serial exceeds 100 characters");
    if (hotWaterMeterSerial.length > 100)
      errors.push("hot_water_meter_serial exceeds 100 characters");

    const numberExists = number ? existingNumbers.has(number) : false;
    let status: DwellingImportRowStatus;
    if (errors.length > 0) {
      status = "ERROR";
    } else if (numberExists && mode !== "update") {
      status = "ERROR";
      errors.push(
        `dwelling number "${number}" already exists (switch to update mode to modify it)`
      );
    } else {
      status = numberExists ? "UPDATE" : "CREATE";
    }

    return {
      rowNumber: index + 1,
      number,
      type,
      displayName,
      occupantName,
      billingName,
      billingEmail,
      billingAddress,
      areaM2,
      residentCount,
      coldWaterMeterSerial,
      hotWaterMeterSerial,
      status,
      errors,
    };
  });

  return { rows, headerError: null };
}

export interface ImportDwellingsResult {
  created: number;
  updated: number;
  errored: number;
  rows: DwellingImportRow[];
}

// Re-validates from raw CSV text rather than trusting a client-submitted
// preview result, so confirm can never persist something that wasn't
// actually re-checked against the current DB state (spec DWL-004: "error
// report; duplicate handling deterministic").
export async function importDwellingsCsv(
  db: Db,
  organizationId: string,
  csvText: string,
  mode: DwellingImportMode,
  actorUserId: string
): Promise<ImportDwellingsResult> {
  const { rows, headerError } = await validateDwellingsCsv(
    db,
    organizationId,
    csvText,
    mode
  );
  if (headerError) {
    throw new ImportHeaderError(headerError);
  }

  let created = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      if (row.status === "ERROR") continue;

      const values = {
        type: row.type as (typeof dwellingTypeEnum.enumValues)[number],
        displayName: row.displayName || null,
        occupantName: row.occupantName || null,
        billingName: row.billingName || null,
        billingEmail: row.billingEmail || null,
        billingAddress: row.billingAddress || null,
        areaM2: row.areaM2 || "0",
        residentCount: row.residentCount ? Number(row.residentCount) : 0,
      };

      let dwellingId: string;
      if (row.status === "CREATE") {
        const [dwelling] = await tx
          .insert(dwellings)
          .values({ organizationId, number: row.number, ...values })
          .returning();
        dwellingId = dwelling.id;
        created++;
        await recordAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: "DWELLING_CREATED",
          entityType: "dwelling",
          entityId: dwelling.id,
          afterData: dwelling,
        });
      } else {
        const [dwelling] = await tx
          .update(dwellings)
          .set({ ...values, updatedAt: new Date() })
          .where(
            and(
              eq(dwellings.organizationId, organizationId),
              eq(dwellings.number, row.number)
            )
          )
          .returning();
        dwellingId = dwelling.id;
        updated++;
        await recordAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: "DWELLING_UPDATED",
          entityType: "dwelling",
          entityId: dwelling.id,
          afterData: dwelling,
        });
      }

      // Meter serials are part of the Section 26 column list; only created
      // for a brand-new dwelling, never overwritten on update (full meter
      // management is Phase E -- this just seeds the two water meters the
      // import format anticipates).
      if (row.status === "CREATE") {
        if (row.coldWaterMeterSerial) {
          await tx.insert(meters).values({
            organizationId,
            dwellingId,
            type: "COLD_WATER",
            serialNumber: row.coldWaterMeterSerial,
            unit: "m3",
          });
        }
        if (row.hotWaterMeterSerial) {
          await tx.insert(meters).values({
            organizationId,
            dwellingId,
            type: "HOT_WATER",
            serialNumber: row.hotWaterMeterSerial,
            unit: "m3",
          });
        }
      }
    }
  });

  return {
    created,
    updated,
    errored: rows.filter((r) => r.status === "ERROR").length,
    rows,
  };
}

export async function exportDwellingsCsv(
  db: Db,
  organizationId: string
): Promise<string> {
  const rows = await db
    .select()
    .from(dwellings)
    .where(eq(dwellings.organizationId, organizationId));

  const meterRows = await db
    .select({
      dwellingId: meters.dwellingId,
      type: meters.type,
      serialNumber: meters.serialNumber,
    })
    .from(meters)
    .where(eq(meters.organizationId, organizationId));
  const serialsByDwelling = new Map<string, { cold: string; hot: string }>();
  for (const m of meterRows) {
    const entry = serialsByDwelling.get(m.dwellingId) ?? { cold: "", hot: "" };
    if (m.type === "COLD_WATER") entry.cold = m.serialNumber ?? "";
    if (m.type === "HOT_WATER") entry.hot = m.serialNumber ?? "";
    serialsByDwelling.set(m.dwellingId, entry);
  }

  const csvRows = rows.map((d) => {
    const serials = serialsByDwelling.get(d.id) ?? { cold: "", hot: "" };
    return {
      number: d.number,
      type: d.type,
      display_name: d.displayName ?? "",
      occupant_name: d.occupantName ?? "",
      billing_name: d.billingName ?? "",
      billing_email: d.billingEmail ?? "",
      billing_address: d.billingAddress ?? "",
      area_m2: d.areaM2,
      resident_count: d.residentCount,
      cold_water_meter_serial: serials.cold,
      hot_water_meter_serial: serials.hot,
    };
  });

  // Spec Section 26: protect exports against spreadsheet formula injection.
  // PapaParse's own escapeFormulae prefixes a leading =/+/-/@/tab/CR with an
  // apostrophe (Excel's own "force text" marker) -- more complete than a
  // hand-rolled tab prefix, which didn't cover a value already starting
  // with a tab or carriage return.
  return Papa.unparse(
    { fields: REQUIRED_HEADERS, data: csvRows },
    { escapeFormulae: true }
  );
}
