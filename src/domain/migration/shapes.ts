// The "shape" of a column: what kind of values it holds, never the values. The
// mapping step uses it to reject impossible matches (an email column cannot be
// the area), and the optional Jev step sends only shapes, never cells
// (ADR 0013).
import { detectDecimalSeparator, parseDate, parseDecimal } from "./values";

export type PatternClass =
  | "empty"
  | "integer"
  | "decimal"
  | "date"
  | "email"
  | "phone"
  | "short_text"
  | "long_text"
  | "mixed";

export interface ColumnShape {
  // Share of rows with a value, in steps of 0.1.
  fillRate: number;
  pattern: PatternClass;
  distinct: "none" | "one" | "few" | "many" | "all";
  // Typical absolute size of the numbers, when the column is numeric.
  range: "none" | "lt1" | "1-10" | "10-200" | "200-10000" | "gt10000";
  hasNegative: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function classify(value: string, sep: "," | "." | null): PatternClass {
  if (EMAIL.test(value)) return "email";
  if (/^-?\d+$/.test(value)) return "integer";
  if (parseDate(value).ok) return "date";
  if (
    /^\+?[\d\s()-]{7,}$/.test(value) &&
    value.replace(/\D/g, "").length >= 7
  ) {
    return "phone";
  }
  if (parseDecimal(value, sep).ok) return "decimal";
  return value.length <= 40 ? "short_text" : "long_text";
}

export function columnShape(values: string[], delimiter?: string): ColumnShape {
  const filled = values.map((v) => v.trim()).filter((v) => v !== "");
  const fillRate =
    values.length === 0
      ? 0
      : Math.round((filled.length / values.length) * 10) / 10;
  if (filled.length === 0) {
    return {
      fillRate,
      pattern: "empty",
      distinct: "none",
      range: "none",
      hasNegative: false,
    };
  }
  const sep = detectDecimalSeparator(filled, delimiter);
  const counts = new Map<PatternClass, number>();
  for (const v of filled) {
    const c = classify(v, sep);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let pattern: PatternClass = "mixed";
  for (const [c, n] of counts) {
    if (n / filled.length >= 0.7) pattern = c;
  }
  // Integers mixed with decimals in one column are a decimal column.
  if (pattern === "mixed") {
    const numeric = (counts.get("integer") ?? 0) + (counts.get("decimal") ?? 0);
    if (numeric / filled.length >= 0.7) pattern = "decimal";
  }

  const distinctCount = new Set(filled).size;
  const ratio = distinctCount / filled.length;
  const distinct =
    distinctCount === 1
      ? "one"
      : distinctCount === filled.length && filled.length >= 3
        ? "all"
        : ratio > 0.5
          ? "many"
          : "few";

  let range: ColumnShape["range"] = "none";
  let hasNegative = false;
  if (pattern === "integer" || pattern === "decimal") {
    const nums = filled
      .map((v) => parseDecimal(v, sep))
      .flatMap((p) => (p.ok ? [Number(p.value)] : []))
      .sort((a, b) => Math.abs(a) - Math.abs(b));
    hasNegative = nums.some((n) => n < 0);
    const median = Math.abs(nums[Math.floor(nums.length / 2)] ?? 0);
    range =
      median < 1
        ? "lt1"
        : median < 10
          ? "1-10"
          : median < 200
            ? "10-200"
            : median < 10000
              ? "200-10000"
              : "gt10000";
  }
  return { fillRate, pattern, distinct, range, hasNegative };
}
