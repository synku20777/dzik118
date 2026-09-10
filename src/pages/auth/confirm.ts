// Phase C (Auth/security) - Supabase OTP/magic-link confirmation endpoint
// (spec Section 9.1, 15.1). Residents only -- admins sign in with a
// password (spec Section 15.2); request-link.ts refuses to send an OTP to
// an admin's email in the first place, but this also rejects any OTP type
// other than the one we ever issue, as defense in depth.
import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]+$/;

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// GET renders a confirmation page instead of verifying immediately. Email
// security scanners routinely prefetch links in inboxes, which would
// silently consume a one-time token before the real user clicks it (spec
// Section 15.1: "must avoid accidental consumption by link scanners where
// practical"). Only a real user click (POST) actually verifies the OTP.
export const GET: APIRoute = ({ url, redirect }) => {
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!tokenHash || type !== "email" || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    return redirect("/login?error=1");
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Confirm sign-in - Property Billing</title>
  </head>
  <body style="font-family: system-ui, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0;">
    <div style="max-width: 28rem; width: 100%; padding: 2rem; border: 1px solid #e5e5e5; border-radius: 0.75rem;">
      <h1 style="margin: 0 0 0.5rem;">Confirm sign-in</h1>
      <p style="color: #555;">Click below to finish signing in.</p>
      <form method="POST">
        <input type="hidden" name="token_hash" value="${escapeHtmlAttribute(tokenHash)}" />
        <input type="hidden" name="type" value="email" />
        <button type="submit" style="width: 100%; padding: 0.5rem 1rem; background: #171717; color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer;">
          Confirm sign-in
        </button>
      </form>
    </div>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = formData.get("type") === "email" ? "email" : null;

  if (!tokenHash || !type || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    return redirect("/login?error=1");
  }

  const { supabase, applyPendingHeaders } = createSupabaseServerClient(
    request,
    cookies
  );
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  // Expired/already-used tokens land here too (spec AUTH-002).
  if (error) {
    return applyPendingHeaders(redirect("/login?error=1"));
  }

  return applyPendingHeaders(redirect("/portal"));
};
