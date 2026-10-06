// Range entry for the setup: "1-12, 14, 20A" becomes dwelling numbers 1..12,
// 14 and 20A. The setup shows them in an editable preview, then turns the
// rows into CSV text for the existing import (csv-import.ts), so validation,
// duplicate checks and the write path are the dwelling import's own.
import Papa from "papaparse";
import { ValidationError } from "../errors";
import { DWELLINGS_CSV_TEMPLATE } from "./csv-import";

const MAX_PER_RANGE = 500;
const MAX_TOTAL = 5_000;

export function parseDwellingRange(text: string): string[] {
  const tokens = text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new ValidationError("Enter at least one dwelling number");
  }
  const numbers: string[] = [];
  for (const token of tokens) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (!range) {
      if (token.length > 50) {
        throw new ValidationError(
          "A dwelling number has more than 50 characters"
        );
      }
      numbers.push(token);
      continue;
    }
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from > to) {
      throw new ValidationError(
        "A range must go from the smaller number to the larger one"
      );
    }
    if (to - from + 1 > MAX_PER_RANGE) {
      throw new ValidationError("A range can have up to 500 dwellings");
    }
    for (let n = from; n <= to; n++) numbers.push(String(n));
  }
  if (numbers.length > MAX_TOTAL) {
    throw new ValidationError("Enter up to 5,000 dwellings at a time");
  }
  const seen = new Set<string>();
  for (const n of numbers) {
    if (seen.has(n)) {
      throw new ValidationError(
        `Dwelling number "${n}" appears more than once`
      );
    }
    seen.add(n);
  }
  return numbers;
}

export interface DwellingRangeRow {
  number: string;
  type: string;
  areaM2: string;
  residentCount: string;
}

// The import requires all eleven headers, even blank ones.
export function dwellingRangeToCsv(rows: DwellingRangeRow[]): string {
  const fields = DWELLINGS_CSV_TEMPLATE.trim().split(",");
  return Papa.unparse(
    {
      fields,
      data: rows.map((r) => ({
        number: r.number,
        type: r.type,
        area_m2: r.areaM2,
        resident_count: r.residentCount,
      })),
    },
    { escapeFormulae: true }
  );
}
