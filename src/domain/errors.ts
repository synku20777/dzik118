// Shared domain error taxonomy (spec Section 14). Every domain module
// throws these (never a locally-defined class of the same name) so
// src/actions/_errors.ts's toActionError can recognize them regardless of
// which domain module raised them and map them to a safe, specific
// client-facing message instead of a generic one.
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {}
