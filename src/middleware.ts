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

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, cookies, locals, redirect, url } = context;

  locals.auth = null;

  const { supabase, applyPendingHeaders } = createSupabaseServerClient(
    request,
    cookies
  );
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
      return applyPendingHeaders(redirect("/login"));
    }
    if (isAdminPath && locals.auth.role !== "ADMIN") {
      return applyPendingHeaders(redirect("/unauthorized"));
    }
    if (isResidentPath && locals.auth.role !== "RESIDENT") {
      return applyPendingHeaders(redirect("/unauthorized"));
    }
  }

  // See docs/decisions/0002-admin-aal2-boundary.md.
  if (isAdminPath && ADMIN_REQUIRE_AAL2) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      return applyPendingHeaders(redirect("/unauthorized"));
    }
  }

  // Disabled accounts never get a session in the first place (their
  // app_users row has disabled_at set, so loadAuthContext returns null
  // above and they're already redirected to /login by the block above for
  // protected paths). Public paths remain reachable, matching Section 15.3's
  // instruction to reject disabled users only where it matters.

  return applyPendingHeaders(await next());
});
