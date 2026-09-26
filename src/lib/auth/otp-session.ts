// True for a session created by an email OTP (recovery link) in the last
// 15 minutes. Supabase records this in the signed JWT (`amr`, method "otp" --
// the same value for magic links and recovery), so it can't be forged with a
// cookie and an ordinary password session never qualifies. It proves control
// of the mailbox just now, which is the guarantee a password reset needs.
// Callers must also require an enabled ADMIN (locals.auth).
import type { SupabaseClient } from "@supabase/supabase-js";

const OTP_WINDOW_SECONDS = 15 * 60;

export async function hasFreshOtpSession(
  supabase: SupabaseClient
): Promise<boolean> {
  const { data } = await supabase.auth.getClaims();
  const now = Date.now() / 1000;
  return (data?.claims.amr ?? []).some(
    (entry) =>
      typeof entry === "object" &&
      entry.method === "otp" &&
      now - entry.timestamp < OTP_WINDOW_SECONDS
  );
}
