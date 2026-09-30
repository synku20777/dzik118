// A YYYY-MM-DD value from a query string or form field, or undefined when it
// is missing, malformed, or not a real calendar date (Postgres rejects year 0).
export function parseDateInput(value: string | null): string | undefined {
  if (!value || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    ? value
    : undefined;
}
