// Drizzle wraps the driver error in a DrizzleQueryError; the real Postgres
// error (with the .code Postgres actually sets) is nested under .cause, not
// on the top-level error.
function pgErrorCode(err: unknown): unknown {
  const pgError = err instanceof Error ? (err.cause ?? err) : err;
  if (typeof pgError !== "object" || pgError === null || !("code" in pgError)) {
    return undefined;
  }
  return (pgError as { code: unknown }).code;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}
