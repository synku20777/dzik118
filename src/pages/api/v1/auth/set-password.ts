// POST /api/v1/auth/set-password -- final step of the admin password reset.
// Only works for a session created by verifying a recovery link at
// /auth/confirm (see hasFreshOtpSession): a normal signed-in session
// can't change the password here without the old one.
import type { APIRoute } from "astro";
import { describeError } from "../../../../domain/errors";
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

  // A body that is not a form reads as an empty password, which is refused.
  const formData = await request.formData().catch(() => null);
  const password = String(formData?.get("password") ?? "");
  const problem = checkNewPassword(
    password,
    String(formData?.get("confirm") ?? "")
  );
  if (problem) return redirect(`/reset-password?error=${problem}`, 303);

  const { supabase, applyPendingHeaders } = createSupabaseServerClient(
    request,
    cookies
  );
  if (
    !locals.auth ||
    locals.auth.organizationIds.length === 0 ||
    !(await hasFreshOtpSession(supabase))
  ) {
    return redirect("/forgot-password?error=1", 303);
  }
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      // Supabase attaches a real error code -- surface the specific,
      // known-safe reason instead of a generic message. Anything not in
      // this list falls back to "failed" rather than showing raw error text.
      const key =
        error.code === "same_password"
          ? "same"
          : error.code === "weak_password"
            ? "weak"
            : error.code === "over_request_rate_limit" ||
                error.code === "over_email_send_rate_limit"
              ? "rate_limited"
              : "failed";
      if (key === "failed") {
        console.error("set-password failed", describeError(error));
      }
      return applyPendingHeaders(redirect(`/reset-password?error=${key}`, 303));
    }
    // Ends every session of this admin (this one included): they sign in
    // again with the new password.
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "global",
    });
    // The password is already changed, so the reset did not fail. Other
    // sessions can stay alive, and the log is the only trace of that.
    if (signOutError) {
      console.error(
        "set-password: global sign-out failed",
        describeError(signOutError)
      );
    }
  } catch (err) {
    console.error("set-password failed", describeError(err));
    return applyPendingHeaders(redirect("/reset-password?error=failed", 303));
  }
  return applyPendingHeaders(redirect("/login?reset=1", 303));
};
