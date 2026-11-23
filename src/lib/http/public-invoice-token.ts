// Shared by both public /invoice/access/[token] routes (the HTML view and
// the PDF download): the missing-token check, rate limiting, and the
// uniform "invalid or expired" response are identical; only what each
// route does with a successfully resolved token differs.
import { env } from "cloudflare:workers";
import { ConflictError, rethrowUnexpected } from "../../domain/errors";

// The answer to anything a token route catches. A bad, revoked or expired
// token gets one uniform response (spec Section 24: a public caller cannot
// tell these apart). A damaged invoice says so, and an outage goes to the
// error page: neither is a bad link, and the holder of a working link can
// read the invoice anyway.
export function invoiceTokenErrorResponse(err: unknown): Response {
  const headers = { "Content-Type": "text/plain; charset=utf-8" };
  if (err instanceof ConflictError) {
    return new Response(err.message, { status: 409, headers });
  }
  rethrowUnexpected(err);
  return new Response("This link is invalid or has expired.", {
    status: 404,
    headers,
  });
}

// Returns the raw token on success, or the Response the route should
// return immediately (missing token / rate limited).
//
// Reads the client IP from the CF-Connecting-IP header directly rather
// than Astro.clientAddress: @astrojs/cloudflare does not implement that
// API at all (confirmed by hitting these routes live -- every request
// 500'd with "ClientAddressNotAvailable ... File an issue with the
// adapter"), so relying on it would leave this route permanently broken,
// not just unable to rate limit.
export async function checkPublicInvoiceTokenRequest(
  rawToken: string | undefined,
  request: Request
): Promise<string | Response> {
  if (!rawToken) {
    return new Response("Not found", { status: 404 });
  }
  const clientIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";
  // Spec Section 33: "auth/public token rate limiting".
  const { success } = await env.INVOICE_TOKEN_RATE_LIMITER.limit({
    key: clientIp,
  });
  if (!success) {
    return new Response("Too many requests", { status: 429 });
  }
  return rawToken;
}
