// Shared localized decimal input handling (Latvia-first: comma is the
// everyday decimal separator). Used by every Zod action-input schema that
// accepts a user-typed decimal string (money, quantities, percentages,
// meter readings) so "0,35" is accepted everywhere "0.35" is, without each
// action re-implementing the same `.replace(",", ".")`.
import { z } from "astro/zod";

// "12,34" -> "12.34". Leaves anything else (including already-dot input,
// and genuinely malformed input like "12,3,4") untouched for the regex
// that runs next to reject -- this only ever swaps a single lone comma.
export function normalizeDecimalInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  const commaCount = (trimmed.match(/,/g) ?? []).length;
  if (commaCount === 1 && !trimmed.includes(".")) {
    return trimmed.replace(",", ".");
  }
  return trimmed;
}

// z.preprocess(normalizeDecimalInput, z.string().regex(pattern, message))
// with the boilerplate folded in -- `message` is a plain-language sentence
// (also used as the i18n dictionary key at render time, see
// src/lib/ui/i18n.ts's friendlyActionErrorMessage).
export function decimalInput(pattern: RegExp, message: string) {
  return z.preprocess(
    normalizeDecimalInput,
    z.string().regex(pattern, message)
  );
}
