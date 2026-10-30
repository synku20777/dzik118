// Dwellings, recipients and delivery preferences from a mapped spreadsheet
// (ADR 0013). Validation is read-only; the import re-parses the raw file text
// and re-validates everything, so a changed form field cannot reach the
// database. Updates change only the mapped columns: an import of one column
// never blanks the others. Writes are bulk statements in one transaction.
// Callers must call requireActiveOrganization() first.
import { z } from "astro/zod";
import { and, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { dwellingTypeEnum, dwellings } from "../../db/schema/dwellings";
import { migrationImports, migrationMappings } from "../../db/schema/migration";
import { isUniqueViolation } from "../../lib/db-errors";
import { sha256Hex } from "../../lib/hash";
import { recordAuditEvent, recordAuditEvents } from "../../lib/logging/audit";
import { ConflictError, ValidationError } from "../errors";
import { syncCasesForDwellings } from "../periods/periods";
import { parseTable } from "./files";
import { cell } from "./limits";
import {
  fingerprintHeaders,
  toSavedMapping,
  validateMapping,
  type MappingSource,
} from "./mapping";
import { DWELLING_TYPE_WORDS, type MigrationKind } from "./targets";
import {
  detectDecimalSeparator,
  foldText,
  parseDecimal,
  parseDelivery,
} from "./values";

type DwellingType = (typeof dwellingTypeEnum.enumValues)[number];

export const ROW_NUMBER_REQUIRED_ERROR = "The dwelling number is empty";
export const ROW_NUMBER_LENGTH_ERROR =
  "The dwelling number has more than 50 characters";
export const ROW_NUMBER_DUPLICATE_ERROR =
  "This dwelling number appears more than once in the file";
export const ROW_TYPE_ERROR = "The dwelling type is not recognized";
export const ROW_EMAIL_ERROR = "The billing email is not valid";
export const ROW_AREA_ERROR =
  "The area must be a number with at most 2 decimals";
export const ROW_RESIDENTS_ERROR = "The resident count must be a whole number";
export const ROW_DELIVERY_ERROR =
  "The invoice delivery is not recognized: use email, paper or both";
export const ROW_TEXT_LENGTH_ERROR = "A text in this row is too long";
export const ROW_NO_EMAIL_WARNING_MESSAGE =
  "No billing email: invoices cannot be sent by email until one is added";
export const ROW_CASE_DUPLICATE_WARNING_MESSAGE =
  "Another dwelling number in the file differs only by letter case";
export const ROW_EXISTS_SKIP_MESSAGE = "Already exists; left unchanged";
export const ROW_NOTHING_SKIP_MESSAGE = "Nothing to change";
export const IMPORT_FIX_ROWS_ERROR =
  "Fix the rows with errors, then import again";
export const IMPORT_RACE_ERROR =
  "Some dwellings were created by someone else while importing. Check the file again";
export const IMPORT_MAPPING_ERROR = "The column mapping is not valid";

const MAX_LENGTH = {
  display_name: 200,
  occupant_name: 200,
  billing_name: 200,
  billing_address: 300,
  notes: 2000,
} as const;

export type DwellingImportMode = "create" | "update";

export interface DwellingPatch {
  type?: DwellingType;
  displayName?: string;
  occupantName?: string;
  billingName?: string;
  billingEmail?: string;
  billingAddress?: string;
  areaM2?: string;
  residentCount?: number;
  invoiceByEmail?: boolean;
  invoiceByPaper?: boolean;
  notes?: string;
}

export interface MigrationDwellingRow {
  // Position after the header row, in file order.
  rowNumber: number;
  number: string;
  patch: DwellingPatch;
  status: "CREATE" | "UPDATE" | "SKIP" | "ERROR";
  errors: string[];
  warnings: string[];
  // Why a SKIP row was left alone.
  skipReason?: string;
}

export interface DwellingValidation {
  rows: MigrationDwellingRow[];
  counts: { create: number; update: number; skip: number; error: number };
}

const emailSchema = z.email();

// Area is numeric(10,2): at most two decimals (trailing zeros are fine).
function canonicalArea(value: string): string | null {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  if (trimmed.length > 2 || value.startsWith("-") || whole.length > 8)
    return null;
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function matchDwellingType(raw: string): DwellingType | null {
  const upper = raw.trim().toUpperCase().replace(/ /g, "_");
  if ((dwellingTypeEnum.enumValues as readonly string[]).includes(upper)) {
    return upper as DwellingType;
  }
  const word = DWELLING_TYPE_WORDS[foldText(raw)];
  return (word as DwellingType | undefined) ?? null;
}

export async function validateDwellings(
  db: DbOrTx,
  organizationId: string,
  table: { headers: string[]; rows: string[][]; delimiter?: string },
  fields: (string | null)[],
  mode: DwellingImportMode
): Promise<DwellingValidation> {
  const index = new Map<string, number>();
  fields.forEach((f, i) => {
    if (f) index.set(f, i);
  });
  const columnValues = (key: string) =>
    index.has(key) ? table.rows.map((r) => r[index.get(key)!] ?? "") : [];
  const areaSep = detectDecimalSeparator(
    columnValues("area_m2").filter(Boolean),
    table.delimiter
  );
  const residentsSep = detectDecimalSeparator(
    columnValues("resident_count").filter(Boolean),
    table.delimiter
  );

  const existingRows = await db
    .select({
      number: dwellings.number,
      billingEmail: dwellings.billingEmail,
      invoiceByEmail: dwellings.invoiceByEmail,
    })
    .from(dwellings)
    .where(eq(dwellings.organizationId, organizationId));
  const existing = new Map(existingRows.map((d) => [d.number, d]));

  const seen = new Set<string>();
  const seenFolded = new Map<string, number>();
  const rows: MigrationDwellingRow[] = table.rows.map((raw, i) => {
    const get = (key: string) =>
      index.has(key) ? cell({ v: raw[index.get(key)!] }, "v") : "";
    const errors: string[] = [];
    const warnings: string[] = [];
    const patch: DwellingPatch = {};

    const number = get("number");
    if (number === "") errors.push(ROW_NUMBER_REQUIRED_ERROR);
    else if (number.length > 50) errors.push(ROW_NUMBER_LENGTH_ERROR);
    else if (seen.has(number)) errors.push(ROW_NUMBER_DUPLICATE_ERROR);
    if (number !== "") {
      seen.add(number);
      const key = number.toLowerCase();
      seenFolded.set(key, (seenFolded.get(key) ?? 0) + 1);
    }

    const type = get("type");
    if (type !== "") {
      const matched = matchDwellingType(type);
      if (matched) patch.type = matched;
      else errors.push(ROW_TYPE_ERROR);
    }
    for (const [key, prop] of [
      ["display_name", "displayName"],
      ["occupant_name", "occupantName"],
      ["billing_name", "billingName"],
      ["billing_address", "billingAddress"],
      ["notes", "notes"],
    ] as const) {
      const value = get(key);
      if (value === "") continue;
      if (value.length > MAX_LENGTH[key]) errors.push(ROW_TEXT_LENGTH_ERROR);
      else patch[prop] = value;
    }
    const email = get("billing_email");
    if (email !== "") {
      if (emailSchema.safeParse(email).success) patch.billingEmail = email;
      else errors.push(ROW_EMAIL_ERROR);
    }
    const area = get("area_m2");
    if (area !== "") {
      const parsed = parseDecimal(area, areaSep);
      const canonical = parsed.ok ? canonicalArea(parsed.value) : null;
      if (canonical !== null) patch.areaM2 = canonical;
      else errors.push(ROW_AREA_ERROR);
    }
    const residents = get("resident_count");
    if (residents !== "") {
      const parsed = parseDecimal(residents, residentsSep);
      if (
        parsed.ok &&
        /^\d+(\.0+)?$/.test(parsed.value) &&
        Number(parsed.value) <= 1000
      ) {
        patch.residentCount = Math.trunc(Number(parsed.value));
      } else {
        errors.push(ROW_RESIDENTS_ERROR);
      }
    }
    const delivery = get("delivery");
    if (delivery !== "") {
      const parsed = parseDelivery(delivery);
      if (parsed.ok) {
        patch.invoiceByEmail = parsed.value.invoiceByEmail;
        patch.invoiceByPaper = parsed.value.invoiceByPaper;
      } else {
        errors.push(ROW_DELIVERY_ERROR);
      }
    }

    const found = number !== "" ? existing.get(number) : undefined;
    let status: MigrationDwellingRow["status"];
    let skipReason: string | undefined;
    if (errors.length > 0) {
      status = "ERROR";
    } else if (found && mode === "create") {
      status = "SKIP";
      skipReason = ROW_EXISTS_SKIP_MESSAGE;
    } else if (found) {
      if (Object.keys(patch).length === 0) {
        status = "SKIP";
        skipReason = ROW_NOTHING_SKIP_MESSAGE;
      } else {
        status = "UPDATE";
      }
    } else {
      status = "CREATE";
    }

    if (status === "CREATE" || status === "UPDATE") {
      const byEmail = patch.invoiceByEmail ?? found?.invoiceByEmail ?? true;
      const hasEmail = Boolean(patch.billingEmail ?? found?.billingEmail);
      if (byEmail && !hasEmail) warnings.push(ROW_NO_EMAIL_WARNING_MESSAGE);
    }
    return {
      rowNumber: i + 1,
      number,
      patch,
      status,
      errors,
      warnings,
      skipReason,
    };
  });

  // Numbers that differ only by letter case are separate dwellings; say so.
  for (const row of rows) {
    if (
      row.number !== "" &&
      (seenFolded.get(row.number.toLowerCase()) ?? 0) > 1
    ) {
      if (!row.errors.includes(ROW_NUMBER_DUPLICATE_ERROR)) {
        row.warnings.push(ROW_CASE_DUPLICATE_WARNING_MESSAGE);
      }
    }
  }
  const count = (s: MigrationDwellingRow["status"]) =>
    rows.filter((r) => r.status === s).length;
  return {
    rows,
    counts: {
      create: count("CREATE"),
      update: count("UPDATE"),
      skip: count("SKIP"),
      error: count("ERROR"),
    },
  };
}

export interface DwellingImportInput {
  // The raw file text, decoded; the page carries it between steps. Everything
  // is re-derived from it here.
  text: string;
  filename: string;
  fields: (string | null)[];
  mappingSources: MappingSource[];
  mode: DwellingImportMode;
}

export interface DwellingImportResult {
  importId: string | null;
  created: number;
  updated: number;
  skipped: number;
}

function dwellingValues(
  organizationId: string,
  number: string,
  patch: DwellingPatch
) {
  return {
    organizationId,
    number,
    type: patch.type,
    displayName: patch.displayName,
    occupantName: patch.occupantName,
    billingName: patch.billingName,
    billingEmail: patch.billingEmail,
    billingAddress: patch.billingAddress,
    areaM2: patch.areaM2,
    residentCount: patch.residentCount,
    invoiceByEmail: patch.invoiceByEmail,
    invoiceByPaper: patch.invoiceByPaper,
    notes: patch.notes,
  };
}

export async function importDwellings(
  db: Db,
  organizationId: string,
  input: DwellingImportInput,
  actorUserId: string
): Promise<DwellingImportResult> {
  const table = parseTable(input.text);
  if (
    validateMapping("DWELLINGS", table.headers.length, input.fields).length > 0
  ) {
    throw new ValidationError(IMPORT_MAPPING_ERROR);
  }
  const fingerprint = await fingerprintHeaders(table.headers);
  // Taken from the text that is imported, not from a form field.
  const sourceSha256 = await sha256Hex(new TextEncoder().encode(input.text));

  try {
    return await db.transaction(async (tx) => {
      const { rows, counts } = await validateDwellings(
        tx,
        organizationId,
        table,
        input.fields,
        input.mode
      );
      if (counts.error > 0) throw new ValidationError(IMPORT_FIX_ROWS_ERROR);
      if (counts.create + counts.update === 0) {
        return { importId: null, created: 0, updated: 0, skipped: counts.skip };
      }

      const toCreate = rows.filter((r) => r.status === "CREATE");
      const created: { id: string; number: string }[] = [];
      for (let i = 0; i < toCreate.length; i += 500) {
        const inserted = await tx
          .insert(dwellings)
          .values(
            toCreate
              .slice(i, i + 500)
              .map((r) => dwellingValues(organizationId, r.number, r.patch))
          )
          .returning({ id: dwellings.id, number: dwellings.number });
        created.push(...inserted);
      }

      const toUpdate = rows.filter((r) => r.status === "UPDATE");
      const updatedIds: {
        id: string;
        row: MigrationDwellingRow;
        before: Record<string, unknown>;
      }[] = [];
      if (toUpdate.length > 0) {
        const found = await tx
          .select()
          .from(dwellings)
          .where(
            and(
              eq(dwellings.organizationId, organizationId),
              inArray(
                dwellings.number,
                toUpdate.map((r) => r.number)
              )
            )
          );
        const byNumber = new Map(found.map((d) => [d.number, d]));
        // Rows with the same patch (a delivery-only update, say) share one
        // statement. ponytail: rows with all-different patches still cost one
        // statement each; a VALUES join would remove that if it ever matters.
        const groups = new Map<
          string,
          { patch: DwellingPatch; ids: string[] }
        >();
        for (const row of toUpdate) {
          const current = byNumber.get(row.number);
          if (!current) continue;
          // Only the mapped, non-empty columns are in the patch.
          const key = JSON.stringify(row.patch);
          const group = groups.get(key) ?? { patch: row.patch, ids: [] };
          group.ids.push(current.id);
          groups.set(key, group);
          updatedIds.push({
            id: current.id,
            row,
            before: Object.fromEntries(
              Object.keys(row.patch).map((k) => [
                k,
                current[k as keyof typeof current],
              ])
            ),
          });
        }
        for (const { patch, ids } of groups.values()) {
          for (let i = 0; i < ids.length; i += 500) {
            await tx
              .update(dwellings)
              .set({ ...patch, updatedAt: new Date() })
              .where(
                and(
                  eq(dwellings.organizationId, organizationId),
                  inArray(dwellings.id, ids.slice(i, i + 500))
                )
              );
          }
        }
      }

      await syncCasesForDwellings(
        tx,
        organizationId,
        created.map((d) => d.id)
      );

      const [importRow] = await tx
        .insert(migrationImports)
        .values({
          organizationId,
          kind: "DWELLINGS",
          sourceFilename: input.filename.slice(0, 200),
          sourceSha256,
          mapping: input.fields,
          mappingSources: input.mappingSources,
          fingerprint,
          rowCount: rows.length,
          createdCount: created.length,
          updatedCount: updatedIds.length,
          skippedCount: counts.skip,
          importedByUserId: actorUserId,
        })
        .returning({ id: migrationImports.id });

      const patchByNumber = new Map(toCreate.map((r) => [r.number, r.patch]));
      await recordAuditEvents(tx, [
        ...created.map((d) => ({
          organizationId,
          actorUserId,
          action: "DWELLING_CREATED",
          entityType: "dwelling",
          entityId: d.id,
          afterData: {
            number: d.number,
            ...patchByNumber.get(d.number),
            migrationImportId: importRow.id,
          },
        })),
        ...updatedIds.map(({ id, row, before }) => ({
          organizationId,
          actorUserId,
          action: "DWELLING_UPDATED",
          entityType: "dwelling",
          entityId: id,
          beforeData: before,
          afterData: { ...row.patch, migrationImportId: importRow.id },
        })),
      ]);
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "MIGRATION_IMPORT_COMPLETED",
        entityType: "migration_import",
        entityId: importRow.id,
        afterData: {
          kind: "DWELLINGS",
          created: created.length,
          updated: updatedIds.length,
          skipped: counts.skip,
        },
      });

      // Remember the mapping for the next spreadsheet with these headers.
      const saved = toSavedMapping(table.headers, input.fields);
      await tx
        .insert(migrationMappings)
        .values({
          organizationId,
          kind: "DWELLINGS",
          fingerprint,
          mapping: saved,
        })
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
        created: created.length,
        updated: updatedIds.length,
        skipped: counts.skip,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(IMPORT_RACE_ERROR);
    throw err;
  }
}

// The saved mapping for a header set, if the organization has used it before.
export async function findSavedMapping(
  db: DbOrTx,
  organizationId: string,
  kind: MigrationKind,
  headers: string[]
): Promise<Record<string, string | null> | null> {
  const fingerprint = await fingerprintHeaders(headers);
  const [row] = await db
    .select({ mapping: migrationMappings.mapping })
    .from(migrationMappings)
    .where(
      and(
        eq(migrationMappings.organizationId, organizationId),
        eq(migrationMappings.kind, kind),
        eq(migrationMappings.fingerprint, fingerprint)
      )
    )
    .limit(1);
  return (row?.mapping as Record<string, string | null> | undefined) ?? null;
}
