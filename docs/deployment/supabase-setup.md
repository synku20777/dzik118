# Supabase project setup (Phase C requirements)

Configuration a real Supabase project needs beyond what application code
controls, discovered while building and verifying Phase C against a local
Supabase stack (`supabase init && supabase start`).

## Magic link email template (required)

By default, Supabase's magic-link email links to Supabase's own
`/auth/v1/verify` endpoint, which verifies the OTP itself and then redirects.
That is **not** what spec Section 15.1 wants: our app verifies the OTP
itself, server-side, at `/auth/confirm?token_hash=...&type=...`
(`src/pages/auth/confirm.ts`).

In the Supabase Dashboard, under Authentication > Email Templates > Magic
Link, set the link to:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">
  Sign in
</a>
```

Without this change, `GET /auth/confirm` never receives real traffic and the
resident magic-link flow is broken end to end, even though every unit of
application code is correct.

Note that `GET /auth/confirm` only *renders* a confirmation button; it does
not verify the OTP itself. Email security scanners routinely prefetch links
in inboxes, which would otherwise silently consume the one-time token before
the real user clicks it (spec Section 15.1). Only a real user click, which
`POST`s the token, actually calls `verifyOtp`.

## Admin password reset templates (required)

Admins reset a forgotten password from `/forgot-password`. Like the magic link,
the reset link must go to our own `/auth/confirm` (not Supabase's `/verify`).
In the Dashboard under Authentication > Email Templates:

- **Reset Password**: link to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
  (`supabase/templates/recovery.html`).
- **Notifications > Password changed**: enable it
  (`supabase/templates/password_changed_notification.html`). This is the
  security notice sent whenever an admin's password changes; keep it on.

Also set the minimum password length to 8 (Authentication > Providers >
Email), matching `PASSWORD_MIN_LENGTH` in `src/lib/auth/password.ts`. There is
no character-class requirement. Sending real email in production needs the
project's SMTP settings configured (the built-in sender is rate limited).

Only enabled `ADMIN` accounts are ever emailed a reset link; residents have no
password. Signing in again is required after a reset (all sessions end). When
`ADMIN_REQUIRE_AAL2` is turned on, re-check this flow: a recovery session is
AAL1 and Supabase may require the second factor before allowing a password
change.
## Auth Site URL and redirect allow-list (required)

Set:

- **Site URL**: the app's real base URL (matches `APP_BASE_URL`).
- **Redirect URLs**: exactly `<APP_BASE_URL>/auth/confirm` -- nothing
  broader. `signInWithOtp`'s `emailRedirectTo` is silently ignored by
  Supabase and falls back to the default Site URL if the requested redirect
  isn't in this allow-list (this is Supabase enforcing spec Section 15.1's
  "redirect URL allow-list must be explicit" for us; it isn't optional).

## Verified locally

Both requirements above were configured in a disposable local Supabase stack
(`supabase/config.toml`'s `[auth]` and `[auth.email.template.magic_link]`)
and the full flow was proven working: request link -> real email captured by
Mailpit -> `/auth/confirm` -> session cookie set -> redirect to `/portal`.
Admin password sign-in, cross-role redirects (resident to `/admin`, admin to
`/portal`), unauthenticated access, and disabled-account handling were all
verified the same way.
