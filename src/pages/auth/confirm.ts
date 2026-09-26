// Phase C (Auth/security) - Supabase OTP confirmation endpoint (spec Section
// 9.1, 15.1). Two token types, both verified here server-side:
//  - "email": resident magic link (admins sign in with a password, spec
//    Section 15.2; request-link.ts never sends them one) -> /portal
//  - "recovery": admin password reset (request-reset.ts) -> /reset-password
// Any other OTP type is rejected, as defense in depth.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { appUsers } from "../../db/schema/auth";
import { withRequestDb } from "../../lib/db-request";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { escapeHtml } from "../../lib/html-escape";
import { translate, uiLocale } from "../../lib/ui/i18n";

const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]+$/;
const isOtpType = (type: unknown): type is "email" | "recovery" =>
  type === "email" || type === "recovery";

// GET renders a confirmation page instead of verifying immediately. Email
// security scanners routinely prefetch links in inboxes, which would
// silently consume a one-time token before the real user clicks it (spec
// Section 15.1: "must avoid accidental consumption by link scanners where
// practical"). Only a real user click (POST) actually verifies the OTP.
export const GET: APIRoute = ({ url, redirect, cookies }) => {
  const locale = uiLocale(cookies, url);
  const t = (text: string) => translate(locale, text);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!tokenHash || !isOtpType(type) || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    return redirect(
      type === "recovery" ? "/forgot-password?error=1" : "/login?error=3"
    );
  }
  const recovery = type === "recovery";
  const heading = t(recovery ? "Reset your password" : "Confirm sign-in");
  const intro = t(
    recovery
      ? "Click below to choose a new password."
      : "Click below to finish signing in."
  );
  const button = t(recovery ? "Continue" : "Confirm sign-in");

  const languageNav = `<nav aria-label="Language" style="position: absolute; top: 1rem; right: 1rem; font-size: 0.75rem; font-weight: 600;">${(
    ["en", "lv", "ru"] as const
  )
    .map((code) => {
      if (code === locale)
        return `<span aria-current="true">${code.toUpperCase()}</span>`;
      const query = new URLSearchParams({
        token_hash: tokenHash,
        type,
        lang: code,
      });
      return `<a href="?${escapeHtml(query.toString())}" lang="${code}" style="color: #58666C; margin-left: 0.5rem;">${code.toUpperCase()}</a>`;
    })
    .join(" ")}</nav>`;

  const html = `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(heading)} - ${escapeHtml(t("Property Billing"))}</title>
  </head>
  <body style="font-family: 'Source Sans 3', 'Segoe UI', sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; background: #F7F4EE; color: #17242B;">
    ${languageNav}
    <div style="max-width: 28rem; width: 100%; padding: 2rem; background: #FFFCF7; border: 1px solid #D5CEC2; border-radius: 0.625rem;">
      <h1 style="margin: 0 0 0.5rem; font-family: Georgia, 'Times New Roman', serif; font-weight: 600;">${escapeHtml(heading)}</h1>
      <p style="color: #58666C;">${escapeHtml(intro)}</p>
      <form method="POST">
        <input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}" />
        <input type="hidden" name="type" value="${type}" />
        <button type="submit" style="width: 100%; min-height: 40px; padding: 0.6rem 1rem; background: #274B5B; color: #FFFCF7; border: 1px solid #274B5B; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer;">
          ${escapeHtml(button)}
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

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return new Response("Cross-site submission forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const tokenHash = String(formData.get("token_hash") ?? "");
  const rawType = formData.get("type");
  const type = isOtpType(rawType) ? rawType : null;
  // Where each flow goes back to when something is wrong.
  const failure =
    type === "recovery" ? "/forgot-password?error=1" : "/login?error=3";

  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.AUTH_IP_RATE_LIMITER) {
    const { success } = await env.AUTH_IP_RATE_LIMITER.limit({ key: clientIp });
    if (!success) {
      return redirect(
        type === "recovery" ? "/forgot-password?error=1" : "/login?error=4"
      );
    }
  }

  if (!tokenHash || !type || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    return redirect(failure);
  }

  const { supabase, applyPendingHeaders } = createSupabaseServerClient(
    request,
    cookies
  );
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  // Expired/already-used tokens land here too (spec AUTH-002).
  if (error) {
    return applyPendingHeaders(redirect(failure));
  }

  if (type === "recovery") {
    // Supabase's recovery endpoint is public, so a link can exist for any
    // account (a resident, or an admin disabled since asking). Only an
    // enabled admin may go on to set a password.
    const userId = data.user?.id;
    const [row] = userId
      ? await withRequestDb((db) =>
          db
            .select({ role: appUsers.role, disabledAt: appUsers.disabledAt })
            .from(appUsers)
            .where(eq(appUsers.id, userId))
            .limit(1)
        )
      : [];
    if (row?.role !== "ADMIN" || row.disabledAt) {
      await supabase.auth.signOut();
      return applyPendingHeaders(redirect(failure));
    }
    return applyPendingHeaders(redirect("/reset-password"));
  }

  return applyPendingHeaders(redirect("/portal"));
};
