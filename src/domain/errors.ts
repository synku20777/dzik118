// Shared domain error taxonomy (spec Section 14). Every domain module
// throws these (never a locally-defined class of the same name) so
// src/actions/_errors.ts's toActionError can recognize them regardless of
// which domain module raised them and map them to a safe, specific
// client-facing message instead of a generic one.
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {}

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
    err instanceof ValidationError
  ) {
    return err.message;
  }
  console.error(err);
  return "An unexpected error occurred.";
}
