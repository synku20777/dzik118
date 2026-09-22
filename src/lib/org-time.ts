// "Today" as YYYY-MM-DD in a given IANA timezone (spec Section 32: "organization
// billing decisions use organizations.timezone") -- en-CA formats as
// YYYY-MM-DD directly, which sorts/compares correctly against date-typed
// columns without a date-math library. Shared by the scheduler (its own
// "is this due today" checks) and the billing domain (dwelling page's
// "what's live right now" tariff resolution) -- UTC (`new
// Date().toISOString().slice(0, 10)`) is wrong near local midnight for any
// organization not on UTC.
export function orgLocalDateString(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
