// Phase C/M (Auth/security) - POST /api/v1/auth/admin-login
// Server-side admin password sign-in endpoint.
// Eliminates client-side session handling and ensures auth cookies are set
// with HttpOnly, Secure, and SameSite=Lax flags directly by the server.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return new Response("Cross-site submission forbidden", { status: 403 });
  }

  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.AUTH_IP_RATE_LIMITER) {
    const { success } = await env.AUTH_IP_RATE_LIMITER.limit({ key: clientIp });
    if (!success) {
      return redirect("/login?error=4", 303);
    }
  }

  try {
    const formData = await request.formData();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      return redirect("/login?error=1", 303);
    }

    const { supabase, applyPendingHeaders } = createSupabaseServerClient(
      request,
      cookies
    );

    const { error, data } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return applyPendingHeaders(redirect("/login?error=1", 303));
    }

    return applyPendingHeaders(redirect("/admin", 303));
  } catch {
    // A network/Supabase-availability hiccup, not a credential problem --
    // telling the admin "incorrect email or password" here would send them
    // chasing the wrong fix.
    return redirect("/login?error=5", 303);
  }
};
