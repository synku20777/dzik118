// Phase C (Auth/security) - Cookie-based SSR Supabase client (spec Section 3.3).
// Supabase authenticates identity; our database decides authorization
// (spec Section 8) -- this client is only ever used to resolve *who* the
// caller is, never to decide *what* they can do.
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "astro:env/server";

export function createSupabaseServerClient(
  request: Request,
  cookies: AstroCookies
) {
  const pendingHeaders = new Headers();
  const isHttps = new URL(request.url).protocol === "https:";

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    // Cookies must never be sent over plain HTTP once deployed (spec
    // Section 33). Derived from the actual request scheme, not build mode,
    // so local http:// dev/preview still works.
    cookieOptions: {
      secure: isHttps,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "");
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          // @supabase/ssr's own DEFAULT_COOKIE_OPTIONS hardcodes
          // httpOnly: false (it assumes a browser client may also need to
          // read the cookie) and is already merged into `options` by the
          // time it reaches here -- placing our own choices before
          // `...options` would spread right over them, silently reverting
          // to that library default. Placing them after, like `secure`
          // already was, is what actually makes them win.
          cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            secure: isHttps,
          });
        }
        // Responses that set auth cookies must never be cached by a CDN
        // (Cloudflare in front of this Worker) or one user's session could
        // be served to another (see @supabase/ssr's SetAllCookies contract).
        // APIContext has no shared mutable "response" to write these onto
        // directly, so they're collected here and applied by the caller via
        // applyPendingHeaders() to whichever Response it ends up returning.
        for (const [key, value] of Object.entries(headers)) {
          pendingHeaders.set(key, value);
        }
      },
    },
  });

  function applyPendingHeaders<T extends Response>(response: T): T {
    for (const [key, value] of pendingHeaders) {
      response.headers.set(key, value);
    }
    return response;
  }

  return { supabase, applyPendingHeaders };
}
