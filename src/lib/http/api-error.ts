// Phase D (Organizations/dwellings) - Shared API error shape (spec Section
// 11). "Do not expose whether a foreign tenant resource exists" -- a
// forbidden access and a genuinely missing resource both map to the same
// FORBIDDEN/NOT_FOUND-shaped response, never a distinguishable message.
import { ForbiddenError } from "../../domain/authorization/guards";
import { NotFoundError } from "../../domain/organizations/organizations";

function jsonError(status: number, code: string, message: string) {
  const requestId = `req_${crypto.randomUUID()}`;
  return new Response(
    JSON.stringify({ error: { code, message, requestId, fieldErrors: null } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export function toApiErrorResponse(err: unknown): Response {
  if (err instanceof ForbiddenError || err instanceof NotFoundError) {
    return jsonError(
      403,
      "FORBIDDEN",
      "You do not have access to this resource."
    );
  }
  return jsonError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}
