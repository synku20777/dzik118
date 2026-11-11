// Shared domain error taxonomy (spec Section 14). Every domain module
// throws these (never a locally-defined class of the same name) so
// src/actions/_errors.ts's toActionError can recognize them regardless of
// which domain module raised them and map them to a safe, specific
// client-facing message instead of a generic one.
export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {}
// Thrown by the CSV imports (dwellings, bank, opening readings) for a problem
// with the file as a whole. Its message is safe to show an admin verbatim.
export class ImportHeaderError extends Error {}
export class RateLimitedError extends Error {
  constructor(message = "Too many requests. Try again in a minute.") {
    super(message);
    this.name = "RateLimitedError";
  }
}

export function describeError(err: unknown): {
  name?: string;
  code?: string | number;
  message: string;
} {
  const e =
    typeof err === "object" && err !== null
      ? (err as {
          name?: string;
          code?: string | number;
          message?: string;
          cause?: { message?: string };
        })
      : null;
  const name = typeof e?.name === "string" ? e.name : undefined;
  const code =
    typeof e?.code === "string" || typeof e?.code === "number"
      ? e.code
      : undefined;
  // A thrown value can carry any `message`; only a string is safe to read.
  const str = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  let message = str(e?.cause?.message) ?? str(e?.message) ?? String(err ?? "");

  if (name === "DrizzleQueryError" || message.startsWith("Failed query:")) {
    const newlineIdx = message.indexOf("\n");
    if (newlineIdx !== -1) {
      message = message.slice(0, newlineIdx);
    }
    const paramsIdx = message.indexOf("params:");
    if (paramsIdx !== -1) {
      message = message.slice(0, paramsIdx);
    }
  }

  return { name, code, message };
}

function isDomainError(err: unknown): boolean {
  return (
    err instanceof ForbiddenError ||
    err instanceof NotFoundError ||
    err instanceof ConflictError ||
    err instanceof ValidationError ||
    err instanceof RateLimitedError
  );
}

// For the catch around a page's data load. A domain error (not found, no
// access) returns, and the page answers it as before. Anything else (a
// database outage, a bug) is logged without the query text and thrown again,
// so Astro shows src/pages/500.astro.
export function rethrowUnexpected(err: unknown): void {
  if (isDomainError(err)) return;
  const described = describeError(err);
  console.error(described);
  throw new Error(described.message);
}

// How the scheduler treats one skipped item of a bulk operation. A
// ValidationError is data the admin must fix, another domain error is a
// routine skip (already sent, period locked), anything else is a failure.
export type SkipKind = "NEEDS_ATTENTION" | "ROUTINE" | "FAILED";
export function skipKind(err: unknown): SkipKind {
  if (err instanceof ValidationError) return "NEEDS_ATTENTION";
  return isDomainError(err) ? "ROUTINE" : "FAILED";
}

// Shared with every bulk-operation domain function (bulkGenerateInvoices,
// bulkPrepareInvoices, bulkSendInvoices): each catches per-item errors
// itself and returns them as data in a "skipped" list, which bypasses
// src/actions/_errors.ts's toActionError sanitization entirely (that only
// runs on errors that actually escape an action handler). Without this, an
// unexpected error's raw .message -- which can embed SQL text and bound
// parameters -- would reach the client verbatim. Mirrors toActionError's
// same allowlist of safe, domain-authored message classes.
export function toSafeSkipReason(err: unknown): string {
  if (
    err instanceof NotFoundError ||
    err instanceof ConflictError ||
    err instanceof ValidationError ||
    err instanceof RateLimitedError
  ) {
    return err.message;
  }
  console.error(describeError(err));
  return "An unexpected error occurred.";
}
