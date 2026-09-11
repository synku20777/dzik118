// Shared by both public /invoice/access/[token] routes (the HTML view and
// the PDF download): the missing-token check, rate limiting, and the
// uniform "invalid or expired" response are identical; only what each
// route does with a successfully resolved token differs.
import { env } from "cloudflare:workers";

// A function, not a shared module-level constant: constructing a Response
// outside a request handler is disallowed in the Workers runtime
// ("Disallowed operation called within global scope").
export function invalidInvoiceLinkResponse(): Response {
  return new Response("This link is invalid or has expired.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
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
