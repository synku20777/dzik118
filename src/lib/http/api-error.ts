// Phase D (Organizations/dwellings) - Shared API error shape (spec Section
// 11). "Do not expose whether a foreign tenant resource exists" -- a
// forbidden access and a genuinely missing resource both map to the same
// FORBIDDEN/NOT_FOUND-shaped response, never a distinguishable message.
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
  describeError,
} from "../../domain/errors";
import { getRequestContext, newRequestId } from "../logging/request-context";

function jsonError(status: number, code: string, message: string) {
  // The middleware's ID: the same one as the X-Request-Id header and the
  // audit rows, so a reported error can be traced.
  const requestId = getRequestContext()?.requestId ?? newRequestId();
  return new Response(
    JSON.stringify({ error: { code, message, requestId, fieldErrors: null } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export function toApiErrorResponse(err: unknown): Response {
  if (err instanceof RateLimitedError) {
    return jsonError(429, "TOO_MANY_REQUESTS", err.message);
  }
  if (err instanceof ForbiddenError || err instanceof NotFoundError) {
    return jsonError(
      403,
      "FORBIDDEN",
      "You do not have access to this resource."
    );
  }
  // Both carry a message written for the user (see src/actions/_errors.ts).
  if (err instanceof ValidationError) {
    return jsonError(400, "BAD_REQUEST", err.message);
  }
  if (err instanceof ConflictError) {
    return jsonError(409, "CONFLICT", err.message);
  }
  // The response is generic on purpose, so the log is the only trace left.
  console.error(describeError(err));
  return jsonError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}
