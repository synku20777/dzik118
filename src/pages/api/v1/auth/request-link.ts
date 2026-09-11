// Phase C (Auth/security) - POST /api/v1/auth/request-link (spec Section
// 11, 15.1, AUTH-001). Public/callback-shaped endpoint, not an Astro Action,
// since it must work for an unauthenticated caller (spec Section 3.1).
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import {
  APP_BASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "astro:env/server";
import { appUsers } from "../../../../db/schema/auth";
import { withRequestDb } from "../../../../lib/db-request";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEUTRAL_REDIRECT = "/login?sent=1";

export const POST: APIRoute = async ({ request, redirect }) => {
  // Every branch below, including any unexpected error, falls through to
  // the same neutral redirect: known vs unknown email, admin vs resident,
  // rate-limited vs not, and any Supabase/DB error must all be
  // indistinguishable to the caller (spec Section 15.1, AUTH-001).
  try {
    const formData = await request.formData();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();

    if (EMAIL_PATTERN.test(email)) {
      const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
      const ipLimit = env.AUTH_IP_RATE_LIMITER
        ? await env.AUTH_IP_RATE_LIMITER.limit({ key: clientIp })
        : { success: true };
      const emailLimit = await env.AUTH_RATE_LIMITER.limit({ key: email });
      if (ipLimit.success && emailLimit.success) {
        await withRequestDb(async (db) => {
          const [existing] = await db
            .select({ role: appUsers.role })
            .from(appUsers)
            .where(eq(appUsers.emailSnapshot, email))
            .limit(1);

          // Admins sign in with a password (spec Section 15.2), never a
          // magic link -- sending one would let them skip that boundary
          // entirely while ADMIN_REQUIRE_AAL2 is off (spec AUTH-002/Section 15).
          if (!existing || existing.role === "RESIDENT") {
            const supabase = createClient(
              SUPABASE_URL,
              SUPABASE_PUBLISHABLE_KEY
            );
            await supabase.auth.signInWithOtp({
              email,
              options: {
                // Does not auto-create a resident (spec Section 15.1); the
                // resident must already have a dwelling_access row from an
                // admin-driven assignment.
                shouldCreateUser: false,
                // Explicit redirect allow-list of one: never derived from
                // request input (spec Section 15.1's "redirect URL allow-list").
                emailRedirectTo: `${APP_BASE_URL}/auth/confirm`,
              },
            });
          }
        });
      }
    }
  } catch {
    // Swallowed deliberately -- see neutral-response note above.
  }

  return redirect(NEUTRAL_REDIRECT, 303);
};
