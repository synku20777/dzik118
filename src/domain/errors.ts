// Shared domain error taxonomy (spec Section 14). Every domain module
// throws these (never a locally-defined class of the same name) so
// src/actions/_errors.ts's toActionError can recognize them regardless of
// which domain module raised them and map them to a safe, specific
// client-facing message instead of a generic one.
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {}
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
  let message = e?.cause?.message ?? e?.message ?? String(err ?? "");

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
