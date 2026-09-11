// Phase C (Auth/security) - Supabase SSR session & tenant auth middleware
// (spec Section 15.3). Resolves identity only; org/dwelling-specific checks
// happen at the page/action level via src/domain/authorization/guards.ts,
// per Section 15.3's "avoid database-heavy authorization globally".
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { ADMIN_REQUIRE_AAL2 } from "astro:env/server";
import { createDb } from "./db/client";
import { loadAuthContext } from "./domain/authorization/context";
import { createSupabaseServerClient } from "./lib/supabase/server";

function applySecurityHeaders<T extends Response>(
  response: T,
  isHttps: boolean
): T {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none';"
  );
  if (isHttps) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, cookies, locals, redirect, url } = context;
  const isHttps = url.protocol === "https:";

  locals.auth = null;

  const { supabase, applyPendingHeaders } = createSupabaseServerClient(
    request,
    cookies
  );

  const respond = <T extends Response>(res: T): T =>
    applySecurityHeaders(applyPendingHeaders(res), isHttps);
  // getUser() revalidates the JWT against Supabase, unlike getSession()
  // which trusts the cookie's claims -- required since this decides identity.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const db = await createDb(env.HYPERDRIVE.connectionString);
    try {
      locals.auth = await loadAuthContext(db, user.id, user.email ?? "");
    } finally {
      locals.cfContext.waitUntil(db.$client.end());
    }
  }

  const isAdminPath = url.pathname.startsWith("/admin");
  const isResidentPath = url.pathname.startsWith("/portal");

  if (isAdminPath || isResidentPath) {
    if (!locals.auth) {
      // A valid Supabase session with no matching/enabled app_users row (a
      // resident never provisioned, an admin removed elsewhere, or a
      // disabled account) looks identical to a plain unauthenticated visit
      // if left unsurfaced -- the sign-in appears to just silently do
      // nothing. Distinguish it with an explicit, safe (no PII, no role
      // hint) query param rather than bouncing to a blank /login.
      return respond(redirect(user ? "/login?error=2" : "/login"));
    }
    if (isAdminPath && locals.auth.role !== "ADMIN") {
      return respond(redirect("/unauthorized"));
    }
    if (isResidentPath && locals.auth.role !== "RESIDENT") {
      return respond(redirect("/unauthorized"));
    }
  }

  // See docs/decisions/0002-admin-aal2-boundary.md. Also covers /_actions/**
  // and /api/v1/admin/** -- Astro Actions and the admin API are reachable
  // independently of the /admin/** page routes (same reasoning as every
  // action handler re-checking role/org access itself), so gating on
  // isAdminPath alone would let an AAL1 admin session bypass MFA by calling
  // an action or admin API route directly instead of through a page.
  const isAdminSensitivePath =
    isAdminPath ||
    url.pathname.startsWith("/_actions") ||
    url.pathname.startsWith("/api/v1/admin");
  if (
    isAdminSensitivePath &&
    ADMIN_REQUIRE_AAL2 &&
    locals.auth?.role === "ADMIN"
  ) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      return respond(redirect("/unauthorized"));
    }
  }

  // Disabled accounts never get a session in the first place (their
  // app_users row has disabled_at set, so loadAuthContext returns null
  // above and they're already redirected to /login by the block above for
  // protected paths). Public paths remain reachable, matching Section 15.3's
  // instruction to reject disabled users only where it matters.

  return respond(await next());
});
