// Admin password rule: length only, no character-class requirements.
// 72 is bcrypt's limit (what Supabase hashes with); longer input is ignored.
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = "short" | "long" | "mismatch";

export function checkNewPassword(
  password: string,
  confirm: string
): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "short";
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES)
    return "long";
  if (password !== confirm) return "mismatch";
  return null;
}
