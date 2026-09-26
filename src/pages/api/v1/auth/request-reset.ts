// POST /api/v1/auth/request-reset -- admin password reset request. Same
// shape as request-link.ts: public endpoint, every outcome (unknown email,
// resident, disabled, rate-limited, error) redirects to the same neutral
// page, so it can't be used to discover which emails are admins.
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "astro:env/server";
import { appUsers } from "../../../../db/schema/auth";
import { withRequestDb } from "../../../../lib/db-request";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEUTRAL_REDIRECT = "/forgot-password?sent=1";

export const POST: APIRoute = async ({ request, redirect, url, locals }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return new Response("Cross-site submission forbidden", { status: 403 });
  }
  const formData = await request.formData().catch(() => null);
  const email = String(formData?.get("email") ?? "")
    .trim()
    .toLowerCase();
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";

  // Everything account-dependent runs after the response is sent, so the
  // response time is the same for admins, residents and unknown addresses.
  locals.cfContext.waitUntil(
    sendResetLink(email, clientIp).catch(() => {
      // Swallowed deliberately -- see the neutral-response note above.
    })
  );
  return redirect(NEUTRAL_REDIRECT, 303);
};

async function sendResetLink(email: string, clientIp: string) {
  if (!EMAIL_PATTERN.test(email)) return;
  const ipLimit = env.AUTH_IP_RATE_LIMITER
    ? await env.AUTH_IP_RATE_LIMITER.limit({ key: clientIp })
    : { success: true };
  // Own key prefix: must not share a budget with magic-link requests.
  const emailLimit = await env.AUTH_RATE_LIMITER.limit({
    key: `reset:${email}`,
  });
  if (!ipLimit.success || !emailLimit.success) return;

  const [user] = await withRequestDb((db) =>
    db
      .select({ role: appUsers.role, disabledAt: appUsers.disabledAt })
      .from(appUsers)
      .where(eq(appUsers.emailSnapshot, email))
      .limit(1)
  );
  // Residents have no password; only enabled admins get a link.
  if (user?.role === "ADMIN" && !user.disabledAt) {
    await createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY
    ).auth.resetPasswordForEmail(email);
  }
}
