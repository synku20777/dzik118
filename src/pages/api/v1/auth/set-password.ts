// POST /api/v1/auth/set-password -- final step of the admin password reset.
// Only works for a session created by verifying a recovery link at
// /auth/confirm (see hasFreshOtpSession): a normal signed-in session
// can't change the password here without the old one.
import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { checkNewPassword } from "../../../../lib/auth/password";
import { hasFreshOtpSession } from "../../../../lib/auth/otp-session";

export const POST: APIRoute = async ({
  request,
  cookies,
  redirect,
  url,
  locals,
}) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return new Response("Cross-site submission forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const problem = checkNewPassword(
    password,
    String(formData.get("confirm") ?? "")
  );
  if (problem) return redirect(`/reset-password?error=${problem}`, 303);

  const { supabase, applyPendingHeaders } = createSupabaseServerClient(
    request,
    cookies
  );
  if (locals.auth?.role !== "ADMIN" || !(await hasFreshOtpSession(supabase))) {
    return redirect("/forgot-password?error=1", 303);
  }
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      // e.g. Supabase's own rules, or "same as old password".
      return applyPendingHeaders(redirect("/reset-password?error=failed", 303));
    }
    // Ends every session of this admin (this one included): they sign in
    // again with the new password.
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    return applyPendingHeaders(redirect("/reset-password?error=failed", 303));
  }
  return applyPendingHeaders(redirect("/login?reset=1", 303));
};
