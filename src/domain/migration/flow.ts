// Glue for the Migration Center pages (ADR 0013): read an upload or pasted
// cells, list past imports, and build the downloadable CSV files. A cell that
// repeats a value from the admin's own spreadsheet is escaped against formula
// injection (Papa's escapeFormulae, or escapeFormula below for a single column
// next to our own numbers).
import Papa from "papaparse";
import { desc, eq } from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import { migrationImports } from "../../db/schema/migration";
import { ValidationError } from "../errors";
import {
  decodeBytes,
  parseTable,
  type MigrationEncoding,
  type ParsedTable,
} from "./files";
import type { BalanceReport } from "./balances";
import { MIGRATION_MAX_BYTES } from "./limits";
import { DWELLING_FIELDS, METER_FIELDS } from "./targets";

// Written first in a downloaded CSV so Excel opens it as UTF-8 and "m²" and
// Latvian letters stay readable. Built from the code point so the source file
// holds no invisible character.
export const CSV_BOM = String.fromCharCode(0xfeff);

export interface ReadUpload {
  // The decoded text. The page carries it between steps and every later step
  // re-parses it.
  text: string;
  encoding: MigrationEncoding | "pasted";
  table: ParsedTable;
}

// From an uploaded file's bytes (encoding detected unless the admin picked
// one) or from cells pasted out of Excel.
export function readUpload(input: {
  bytes?: Uint8Array;
  pasted?: string;
  encoding?: MigrationEncoding | "auto";
}): ReadUpload {
  if (input.bytes) {
    const { text, encoding } = decodeBytes(
      input.bytes,
      input.encoding ?? "auto"
    );
    return { text, encoding, table: parseTable(text) };
  }
  const pasted = input.pasted ?? "";
  if (new TextEncoder().encode(pasted).length > MIGRATION_MAX_BYTES) {
    throw new ValidationError("The file is too large (up to 1 MB)");
  }
  return { text: pasted, encoding: "pasted", table: parseTable(pasted) };
}

export async function listMigrationImports(db: DbOrTx, organizationId: string) {
  return db
    .select({
      id: migrationImports.id,
      kind: migrationImports.kind,
      sourceFilename: migrationImports.sourceFilename,
      rowCount: migrationImports.rowCount,
      createdCount: migrationImports.createdCount,
      updatedCount: migrationImports.updatedCount,
      skippedCount: migrationImports.skippedCount,
      createdAt: migrationImports.createdAt,
    })
    .from(migrationImports)
    .where(eq(migrationImports.organizationId, organizationId))
    .orderBy(desc(migrationImports.createdAt))
    .limit(100);
}

// A starting spreadsheet: the English field names, one example row.
export function dwellingsTemplateCsv(): string {
  const headers = DWELLING_FIELDS.map((f) => f.label);
  const sample: Record<string, string> = {
    number: "12",
    type: "Apartment",
    billing_email: "owner@example.com",
    area_m2: "45.5",
    resident_count: "2",
    delivery: "Email",
  };
  const example = DWELLING_FIELDS.map((f) => sample[f.key] ?? "");
  return Papa.unparse([headers, example], {
    escapeFormulae: true,
    delimiter: ";",
  });
}

// The reconciliation report as a file: one line per posted balance, then the
// totals from the file and from the ledger.
export function balanceReportCsv(
  report: BalanceReport,
  translate: (text: string) => string = (t) => t
): string {
  // Papa's escapeFormulae would also prefix our own negative amounts ("-15.00")
  // with a quote. The amounts are computed numbers; only the dwelling number
  // comes from the admin's file, so only it is escaped.
  const lines = report.lines.map((l) => [
    escapeFormula(l.number),
    translate(l.direction === "DEBIT" ? "Debt" : "Credit"),
    l.amount,
    l.balanceNow,
    "",
  ]);
  return Papa.unparse(
    [
      [
        translate("Dwelling number"),
        translate("Type"),
        translate("Amount"),
        translate("Balance now"),
        translate("Message"),
      ],
      ...lines,
      // Rows left out, with the reason, so nothing disappears from the report.
      ...report.skippedLines.map((s) => [
        escapeFormula(s.number),
        translate("Left unchanged"),
        "",
        "",
        translate(s.reason),
      ]),
      [translate("Total debt in the file"), "", report.fileDebit, "", ""],
      [translate("Total debt in the ledger"), "", report.ledgerDebit, "", ""],
      [translate("Total credit in the file"), "", report.fileCredit, "", ""],
      [
        translate("Total credit in the ledger"),
        "",
        report.ledgerCredit,
        "",
        "",
      ],
    ],
    { delimiter: ";" }
  );
}

function escapeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// Example for the meter readings file: one row per meter.
export function metersTemplateCsv(): string {
  return Papa.unparse(
    [
      METER_FIELDS.map((f) => f.label),
      // A decimal comma, as in a file saved by Excel with ";" between cells.
      ["12", "Cold water", "123456", "m3", "245,123", "30.09.2026"],
      ["12", "Hot water", "654321", "m3", "118,450", "30.09.2026"],
    ],
    // Fixed example text, like the other templates.
    { delimiter: ";" }
  );
}

// Example for the opening balance file: one signed balance per dwelling,
// positive = the resident owes.
export function balancesTemplateCsv(): string {
  return Papa.unparse(
    [
      ["Dwelling number", "Balance", "Debt due date"],
      ["12", "120.50", "31.08.2026"],
      ["13", "-15.00", ""],
    ],
    // Fixed example text; escapeFormulae would turn "-15.00" into "'-15.00".
    { delimiter: ";" }
  );
}

// The same for both kinds: rows with errors or warnings, for the admin to fix
// in the spreadsheet.
interface IssueRow {
  rowNumber: number;
  number: string;
  status: string;
  errors: string[];
  warnings: string[];
  skipReason?: string;
}

// The messages are the English domain strings; the page passes `translate` to
// show them in the admin's language.
export function issuesCsv(
  rows: IssueRow[],
  translate: (text: string) => string = (t) => t
): string {
  const header = [
    translate("Row"),
    translate("Dwelling number"),
    translate("Status"),
    translate("Message"),
  ];
  const data = rows
    .filter((r) => r.errors.length > 0 || r.warnings.length > 0 || r.skipReason)
    .map((r) => [
      String(r.rowNumber),
      r.number,
      r.status,
      [...r.errors, ...r.warnings, ...(r.skipReason ? [r.skipReason] : [])]
        .map(translate)
        .join("; "),
    ]);
  return Papa.unparse([header, ...data], {
    escapeFormulae: true,
    delimiter: ";",
  });
}
