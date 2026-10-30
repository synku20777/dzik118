// Proposes and checks the column mapping (ADR 0013). The dictionary here is
// the first and the testable proposer; an optional AI step (jev.ts) only
// covers columns this one cannot place, and the admin confirms every mapping.
import { sha256Hex } from "../../lib/hash";
import { columnShape, type ColumnShape } from "./shapes";
import {
  aliasesOf,
  TARGETS,
  type MigrationKind,
  type TargetField,
} from "./targets";
import { foldText } from "./values";

export type MappingSource = "DICTIONARY" | "JEV" | "USER" | "SAVED";

export interface ColumnProposal {
  index: number;
  header: string;
  field: string | null;
  score: number;
  source: MappingSource;
  shape: ColumnShape;
  candidates: { field: string; score: number }[];
}

// A column is only proposed for a field at or above this score.
export const ACCEPT_SCORE = 0.7;

const tokens = (folded: string) => folded.split(" ").filter(Boolean);

// 1.0 the header is an alias; 0.85 it contains every word of an alias;
// 0.7 every word of the header is inside an alias ("nr" in "dzivokla nr").
export function scoreHeader(header: string, field: TargetField): number {
  const folded = foldText(header);
  if (folded === "") return 0;
  const headerTokens = new Set(tokens(folded));
  let best = 0;
  for (const alias of aliasesOf(field)) {
    if (alias === folded) return 1;
    const aliasTokens = tokens(alias);
    if (aliasTokens.every((t) => headerTokens.has(t))) {
      best = Math.max(best, aliasTokens.length >= 2 ? 0.85 : 0.8);
    } else if ([...headerTokens].every((t) => aliasTokens.includes(t))) {
      best = Math.max(best, headerTokens.size >= 2 ? 0.72 : 0.7);
    }
  }
  return best;
}

export function proposeMapping(
  kind: MigrationKind,
  headers: string[],
  rows: string[][],
  // The file's delimiter, which tells a decimal comma from a thousands comma
  // when the values alone cannot.
  delimiter?: string
): ColumnProposal[] {
  const fields = TARGETS[kind];
  const proposals: ColumnProposal[] = headers.map((header, index) => {
    const shape = columnShape(
      rows.map((r) => r[index] ?? ""),
      delimiter
    );
    const candidates = fields
      .map((f) => {
        let score = scoreHeader(header, f);
        // A column of the wrong kind of value is not the field, whatever its
        // header says.
        if (
          score > 0 &&
          shape.pattern !== "empty" &&
          !f.expects.includes(shape.pattern)
        ) {
          score *= 0.5;
        }
        return { field: f.key, score: Math.round(score * 100) / 100 };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    return {
      index,
      header,
      field: null,
      score: 0,
      source: "DICTIONARY" as const,
      shape,
      candidates,
    };
  });

  // Each field belongs to one column: the highest score wins.
  const claims = proposals
    .flatMap((p) => p.candidates.map((c) => ({ p, ...c })))
    .filter((c) => c.score >= ACCEPT_SCORE)
    .sort((a, b) => b.score - a.score);
  const takenFields = new Set<string>();
  for (const claim of claims) {
    if (claim.p.field !== null || takenFields.has(claim.field)) continue;
    claim.p.field = claim.field;
    claim.p.score = claim.score;
    takenFields.add(claim.field);
  }
  return proposals;
}

// Same header set, whatever the column order -> same fingerprint, so a saved
// mapping is offered again when the admin uploads next month's file.
export async function fingerprintHeaders(headers: string[]): Promise<string> {
  const folded = headers.map(foldText).sort().join("|");
  return sha256Hex(new TextEncoder().encode(folded));
}

// A saved mapping holds column names only, never values.
export type SavedMapping = Record<string, string | null>;

// Keys are the folded headers; a header that appears again gets "#2", "#3", so
// two columns named "Name" are not merged.
function savedKeys(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const folded = foldText(h);
    const n = (seen.get(folded) ?? 0) + 1;
    seen.set(folded, n);
    return n === 1 ? folded : `${folded}#${n}`;
  });
}

export function toSavedMapping(
  headers: string[],
  fields: (string | null)[]
): SavedMapping {
  const saved: SavedMapping = {};
  savedKeys(headers).forEach((key, i) => {
    saved[key] = fields[i] ?? null;
  });
  return saved;
}

export function applySavedMapping(
  proposals: ColumnProposal[],
  saved: SavedMapping
): ColumnProposal[] {
  const keys = savedKeys(proposals.map((p) => p.header));
  return proposals.map((p, i) => {
    const key = keys[i];
    return key in saved
      ? { ...p, field: saved[key], score: 1, source: "SAVED" as const }
      : p;
  });
}

export type MappingProblem = {
  code: "MISSING_REQUIRED" | "DUPLICATE" | "UNKNOWN_FIELD" | "WRONG_LENGTH";
  field?: string;
};

// The mapping arrives from a form, so it is checked again on every step: known
// fields only, none twice, every required field present.
export function validateMapping(
  kind: MigrationKind,
  columnCount: number,
  fields: (string | null)[]
): MappingProblem[] {
  const known = new Map(TARGETS[kind].map((f) => [f.key, f]));
  const problems: MappingProblem[] = [];
  if (fields.length !== columnCount) problems.push({ code: "WRONG_LENGTH" });
  const seen = new Set<string>();
  for (const field of fields) {
    if (field === null) continue;
    if (!known.has(field)) problems.push({ code: "UNKNOWN_FIELD", field });
    else if (seen.has(field)) problems.push({ code: "DUPLICATE", field });
    seen.add(field);
  }
  for (const f of known.values()) {
    if (f.required && !seen.has(f.key)) {
      problems.push({ code: "MISSING_REQUIRED", field: f.key });
    }
  }
  return problems;
}
