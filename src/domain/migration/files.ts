// Turns the bytes of an uploaded file into a clean table (ADR 0013). Latvian
// Excel saves "CSV" in Windows-1257 with ";" separators and comma decimals, so
// the encoding and the delimiter are detected, not assumed. Pasted text skips
// the byte step. No value parsing happens here (see values.ts).
import Papa from "papaparse";
import { ValidationError } from "../errors";
import { MIGRATION_MAX_BYTES, MIGRATION_MAX_ROWS } from "./limits";
import { ACCEPT_SCORE, scoreHeader } from "./mapping";
import { TARGETS } from "./targets";

const ALL_FIELDS = Object.values(TARGETS).flat();
import { foldText, parseDecimal } from "./values";

export const SUPPORTED_ENCODINGS = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1257",
  "windows-1251",
  "windows-1252",
] as const;
export type MigrationEncoding = (typeof SUPPORTED_ENCODINGS)[number];

// Bytes that Latvian text uses in Windows-1257 (the letters with diacritics,
// both cases) plus punctuation that 1252 and 1257 share (euro, quotes, dashes,
// no-break space, degree, superscripts).
const LATVIAN_1257_BYTES = new Set([
  0xe2, 0xe8, 0xe7, 0xec, 0xee, 0xed, 0xef, 0xf2, 0xf0, 0xfb, 0xfe, 0xc2, 0xc8,
  0xc7, 0xcc, 0xce, 0xcd, 0xcf, 0xd2, 0xd0, 0xdb, 0xde, 0x80, 0x91, 0x92, 0x93,
  0x94, 0x95, 0x96, 0x97, 0xa0, 0xb0, 0xb2, 0xb3, 0xb9,
]);

function startsWith(bytes: Uint8Array, ...prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

// Picks the most plausible single-byte encoding for bytes that are not valid
// UTF-8. Windows-1257 (Latvian) is the default; Cyrillic text in 1251 uses many
// more distinct byte values than Latvian text does. The page shows a decoded
// sample and an encoding picker, so a wrong guess is visible and fixable.
function guessSingleByte(bytes: Uint8Array): MigrationEncoding {
  let high = 0;
  let inLatvianSet = 0;
  const cyrillicRange = new Set<number>();
  for (const b of bytes) {
    if (b < 0x80) continue;
    high++;
    if (LATVIAN_1257_BYTES.has(b)) inLatvianSet++;
    if (b >= 0xc0) cyrillicRange.add(b);
  }
  if (high === 0) return "windows-1257";
  if (inLatvianSet / high >= 0.9) return "windows-1257";
  if (cyrillicRange.size >= 12) return "windows-1251";
  return "windows-1252";
}

export function decodeBytes(
  bytes: Uint8Array,
  encoding: MigrationEncoding | "auto" = "auto"
): { text: string; encoding: MigrationEncoding } {
  if (bytes.length > MIGRATION_MAX_BYTES) {
    throw new ValidationError("The file is too large (up to 1 MB)");
  }
  let chosen: MigrationEncoding;
  if (encoding !== "auto") {
    chosen = encoding;
  } else if (startsWith(bytes, 0xef, 0xbb, 0xbf)) {
    chosen = "utf-8";
  } else if (startsWith(bytes, 0xff, 0xfe)) {
    chosen = "utf-16le";
  } else if (startsWith(bytes, 0xfe, 0xff)) {
    chosen = "utf-16be";
  } else {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      chosen = "utf-8";
    } catch {
      chosen = guessSingleByte(bytes);
    }
  }
  const text = new TextDecoder(chosen).decode(bytes).replace(/^\uFEFF/, "");
  return { text, encoding: chosen };
}

export interface ParsedTable {
  delimiter: string;
  headerRowIndex: number;
  headers: string[];
  rows: string[][];
  // Lines above the header row (titles, company name, date).
  skippedTitleRows: number;
  // "Kopā", "Total", "Итого" rows left out of the data.
  droppedTotalRows: number;
}

const TOTAL_WORDS = [
  "kopa",
  "kopsumma",
  "summa",
  "total",
  "totals",
  "grand total",
  "itogo",
  "итого",
  "всего",
  "bez pvn kopa",
];

// A number or a date. "1 369,456" is numeric even though, on its own, it is
// ambiguous (a comma and three digits: thousands or decimals).
function isNumeric(value: string): boolean {
  const parsed = parseDecimal(value);
  return (
    parsed.ok ||
    parsed.reason === "ambiguous number" ||
    /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(value)
  );
}

// A total row starts with a total word and holds only numbers after it. A
// dwelling named "Summa" or numbered "Total 1" has text in a later cell, or is
// not a bare total word, so it stays.
function isTotalRow(row: string[]): boolean {
  const filled = row.filter((c) => c !== "");
  if (filled.length === 0) return false;
  const first = foldText(filled[0]);
  return (
    TOTAL_WORDS.some((w) => first === w || first.startsWith(w + " ")) &&
    filled.slice(1).every(isNumeric)
  );
}

const DELIMITERS = [";", ",", "\t", "|"];

// The delimiter that splits the most of the first lines into the same number
// of columns. Papa's own guess is thrown off by a title line with a comma above
// a semicolon file with comma decimals.
function guessDelimiter(text: string): string {
  let best = ";";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const { data } = Papa.parse<string[]>(text, {
      delimiter,
      preview: 30,
      skipEmptyLines: "greedy",
    });
    const widths = new Map<number, number>();
    for (const row of data)
      widths.set(row.length, (widths.get(row.length) ?? 0) + 1);
    for (const [width, count] of widths) {
      if (width > 1 && count > bestScore) {
        best = delimiter;
        bestScore = count;
      }
    }
  }
  return best;
}

// A row with two or more cells that read as field names ("Nr.", "Platība")
// is the header, even when a textual title line sits above it.
function aliasHits(row: string[]): number {
  return row.filter((c) =>
    ALL_FIELDS.some((f) => scoreHeader(c, f) >= ACCEPT_SCORE)
  ).length;
}

export function parseTable(text: string): ParsedTable {
  if (new TextEncoder().encode(text).length > MIGRATION_MAX_BYTES) {
    throw new ValidationError("The file is too large (up to 1 MB)");
  }
  const parsed = Papa.parse<string[]>(text, {
    delimiter: guessDelimiter(text),
    skipEmptyLines: "greedy",
  });
  // An unclosed quote would swallow the following dwellings into one cell.
  if (parsed.errors.some((e) => e.type === "Quotes")) {
    throw new ValidationError("The file has a quote that is never closed");
  }
  const grid = parsed.data
    .filter((row): row is string[] => Array.isArray(row))
    .map((row) =>
      row.map((c) =>
        String(c ?? "")
          .replace(/[\u00A0\u202F]/g, " ")
          .trim()
      )
    );
  if (grid.length === 0) {
    throw new ValidationError("The file has no data rows");
  }

  // Header row: the first of the first 15 lines that is mostly text and about
  // as wide as the widest of them. Lines above it are titles.
  const sample = grid.slice(0, 15);
  const widest = Math.max(...sample.map((r) => r.filter(Boolean).length));
  const candidates: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    const filled = sample[i].filter(Boolean);
    if (filled.length < 2 || filled.length < 0.6 * widest) continue;
    const textual = filled.filter((c) => !isNumeric(c)).length;
    if (textual / filled.length >= 0.7) candidates.push(i);
  }
  const headerRowIndex =
    candidates.find((i) => aliasHits(sample[i]) >= 2) ?? candidates[0] ?? 0;

  const width = Math.max(...grid.slice(headerRowIndex).map((r) => r.length));
  const pad = (r: string[]) => [
    ...r,
    ...Array(Math.max(0, width - r.length)).fill(""),
  ];
  const headerCells = pad(grid[headerRowIndex]);
  // Trailing empty columns are artifacts of the export.
  let lastUsed = width - 1;
  const bodyAll = grid.slice(headerRowIndex + 1).map(pad);
  while (
    lastUsed >= 0 &&
    headerCells[lastUsed] === "" &&
    bodyAll.every((r) => r[lastUsed] === "")
  ) {
    lastUsed--;
  }
  const headers = headerCells
    .slice(0, lastUsed + 1)
    .map((h, i) => (h === "" ? `Column ${i + 1}` : h));

  let droppedTotalRows = 0;
  const rows: string[][] = [];
  for (const raw of bodyAll) {
    const row = raw.slice(0, lastUsed + 1);
    if (row.every((c) => c === "")) continue;
    if (isTotalRow(row)) {
      droppedTotalRows++;
      continue;
    }
    rows.push(row);
  }
  if (rows.length === 0) throw new ValidationError("The file has no data rows");
  if (rows.length > MIGRATION_MAX_ROWS) {
    throw new ValidationError("The file has too many rows (up to 2,000)");
  }
  return {
    delimiter: parsed.meta.delimiter,
    headerRowIndex,
    headers,
    rows,
    skippedTitleRows: headerRowIndex,
    droppedTotalRows,
  };
}
