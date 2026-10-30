// Limits and small helpers shared by the Migration Center (ADR 0013).
// A Worker request has a time limit and the file travels between steps in a
// hidden form field, so the caps are lower than the older importers' 2 MB and
// 5,000 rows.
export const MIGRATION_MAX_BYTES = 1_000_000;
export const MIGRATION_MAX_ROWS = 2_000;

export function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}
