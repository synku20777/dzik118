// Phase C (Auth/security) - Supabase SSR session & tenant auth middleware
// (spec Section 15.3). Resolves identity only; org/dwelling-specific checks
// happen at the page/action level via src/domain/authorization/guards.ts,
// per Section 15.3's "avoid database-heavy authorization globally".
import { getActionContext } from "astro:actions";
import { defineMiddleware } from "astro:middleware";
import { env, tracing } from "cloudflare:workers";
import {
  ADMIN_REQUIRE_AAL2,
  APP_BASE_URL,
  AUDIT_HASH_SECRET,
} from "astro:env/server";
import { createDb } from "./db/client";
import { loadAuthContext } from "./domain/authorization/context";
import { ForbiddenError } from "./domain/authorization/guards";
import { toApiErrorResponse } from "./lib/http/api-error";
import {
  getRequestContext,
  hashIp,
  newRequestId,
  runWithRequestContext,
} from "./lib/logging/request-context";
import { createSupabaseServerClient } from "./lib/supabase/server";
import { localeFromAcceptLanguage } from "./lib/ui/i18n";

function applySecurityHeaders<T extends Response>(
  response: T,
  isHttps: boolean
): T {
  // The same ID is stored in audit_logs.request_id, so a person who reports a
  // problem can give the ID from the response and support can trace it.
  const requestId = getRequestContext()?.requestId;
  if (requestId) response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Content-Security-Policy",
    // Fonts are self-hosted (src/fonts, declared in global.css), so font-src
    // is 'self' only: no third party sees a visitor's address for fonts.
    // Never load these from a CDN: this policy would block them.
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.supabase.co; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none';"
  );
  if (isHttps) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
  return response;
}

const handle = defineMiddleware(async (context, next) => {
  const { request, cookies, locals, redirect, url } = context;
  const isHttps = url.protocol === "https:";

  if (url.hostname === "property-billing.nestor-kulik.workers.dev") {
    const destination = new URL(url);
    const appOrigin = new URL(APP_BASE_URL);
    destination.protocol = appOrigin.protocol;
    destination.host = appOrigin.host;
    return applySecurityHeaders(redirect(destination.href, 308), isHttps);
  }

  locals.auth = null;

  // First visit: choose the language from the browser. uiLocale reads this
  // cookie, and an explicit ?lang= still wins (uiLocale overwrites it).
  if (
    !url.pathname.startsWith("/api") &&
    !url.searchParams.has("lang") &&
    !cookies.has("ui_locale")
  ) {
    cookies.set(
      "ui_locale",
      localeFromAcceptLanguage(request.headers.get("accept-language")),
      { path: "/", sameSite: "lax", httpOnly: true }
    );
  }

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
  } = await tracing.enterSpan("auth.getUser", () => supabase.auth.getUser());

  if (user) {
    const db = await tracing.enterSpan("auth.db.connect", () =>
      createDb(env.HYPERDRIVE.connectionString)
    );
    try {
      locals.auth = await tracing.enterSpan("auth.context", () =>
        loadAuthContext(db, user.id, user.email ?? "")
      );
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
    if (isAdminPath && locals.auth.organizationIds.length === 0) {
      return respond(redirect("/unauthorized"));
    }
    if (isResidentPath && locals.auth.dwellingIds.length === 0) {
      // ADR 0009: a resident of an archived organization sees why.
      return respond(
        redirect(locals.auth.closedDwellingCount ? "/closed" : "/unauthorized")
      );
    }
  }

  // Default deny for every page and API whose path names an organization or
  // a dwelling, so a new page cannot forget the check (guards are in-memory,
  // so Section 15.3's "no database-heavy authorization globally" holds).
  const orgId = /^\/(?:api\/v1\/)?admin\/o\/([^/]+)/.exec(url.pathname)?.[1];
  const dwellingId = /^\/portal\/dwellings\/([^/]+)/.exec(url.pathname)?.[1];
  if (
    (orgId && !locals.auth?.organizationIds.includes(orgId)) ||
    (dwellingId && !locals.auth?.dwellingIds.includes(dwellingId))
  ) {
    return respond(
      url.pathname.startsWith("/api/")
        ? toApiErrorResponse(new ForbiddenError())
        : redirect("/unauthorized")
    );
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
    (locals.auth?.organizationIds.length ?? 0) > 0
  ) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      // Distinct from the plain role/scope mismatch below: this admin DOES
      // have permission, they just haven't completed their second factor
      // yet -- "verify your MFA" is a different, actionable remedy from
      // "you don't have access", so it gets its own reason code.
      return respond(redirect("/unauthorized?reason=mfa"));
    }
  }

  // Disabled accounts never get a session in the first place (their
  // app_users row has disabled_at set, so loadAuthContext returns null
  // above and they're already redirected to /login by the block above for
  // protected paths). Public paths remain reachable, matching Section 15.3's
  // instruction to reject disabled users only where it matters.

  // Post/redirect/get for every plain HTML form action: after a success the
  // browser is sent back to the page with a GET, so a refresh cannot submit
  // again. The result travels in a cookie only that page receives. A failure
  // renders in place, so the form keeps what the user typed.
  const { action, setActionResult, serializeActionResult } =
    getActionContext(context);
  const stored = cookies.get(ACTION_RESULT_COOKIE);
  let restored: { name?: unknown; path?: unknown; result?: unknown } = {};
  try {
    restored = stored?.json() ?? {};
  } catch {
    // A malformed cookie only loses the success message.
  }
  // The cookie path also matches child pages, so only the page that set it
  // takes it, and only a success: nothing else may plant an error message.
  if (request.method === "GET" && restored.path === url.pathname) {
    cookies.delete(ACTION_RESULT_COOKIE, { path: url.pathname });
    const result = restored.result as { type?: unknown } | undefined;
    if (
      typeof restored.name === "string" &&
      (result?.type === "data" || result?.type === "empty")
    ) {
      setActionResult(restored.name, result as never);
    }
  } else if (action?.calledFrom === "form") {
    const result = serializeActionResult(await action.handler());
    const value = JSON.stringify({
      name: action.name,
      path: url.pathname,
      result,
    });
    if (result.type !== "error") {
      // shortcut: a result over ~3 KB cannot fit a cookie, so the page
      // reloads without its success message; move to Astro sessions or
      // return less from that action if a message goes missing.
      if (encodeURIComponent(value).length <= 3000) {
        cookies.set(ACTION_RESULT_COOKIE, value, {
          path: url.pathname,
          httpOnly: true,
          secure: isHttps,
          sameSite: "lax",
          maxAge: 60,
        });
      }
      const target = new URL(url);
      target.searchParams.delete("_action");
      return respond(redirect(target.pathname + target.search, 303));
    }
    setActionResult(action.name, result);
  }

  return respond(await tracing.enterSpan("route.render", () => next()));
});

const ACTION_RESULT_COOKIE = "action_result";

// Every audit row written while this request runs carries its request ID and
// hashed IP (see src/lib/logging/request-context.ts).
export const onRequest = defineMiddleware(async (context, next) => {
  const requestId = newRequestId();
  const ipHash = await hashIp(
    context.request.headers.get("cf-connecting-ip"),
    AUDIT_HASH_SECRET
  );
  // handle() returns a Response on every path (each branch goes through
  // respond()), which its declared `void | Response` type does not say.
  return runWithRequestContext(
    { requestId, ipHash },
    () => handle(context, next) as Promise<Response>
  );
});
