# 0002 - Admin MFA (AAL2) boundary: feature-flagged, not yet built

**Status:** Accepted (temporary)
**Phase:** C (Auth/security)

## Context

Spec Section 15.2: "At production readiness, `/admin/**` requires an admin
session satisfying configured MFA assurance. If initial development
temporarily permits AAL1, this must be feature-flagged and forbidden in
production."

Phase C's scope (spec Section 47 task brief C) is the "admin auth/MFA
boundary" -- the gate, not a full passkey/TOTP enrollment flow. Building
enrollment UI is a separate, larger UX effort with no clear owner yet in the
phase plan, and there is no live Supabase project in this environment to
enroll a real MFA factor against anyway (only a local disposable stack used
for verifying this phase, spec Section 40's production Supabase project
doesn't exist yet).

## Decision

- `src/middleware.ts` calls `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`
  and enforces `currentLevel === "aal2"` for an authenticated ADMIN hitting
  `/admin/**`, `/_actions/**`, or `/api/v1/admin/**` (Astro Actions and the
  admin API are reachable independently of the page routes, so the boundary
  has to cover them too, not just `/admin/**` literally) when the
  `ADMIN_REQUIRE_AAL2` env var (`astro:env`, boolean, default `false`) is
  true; the check is skipped entirely while the flag is off.
- Default is `false` (AAL1 permitted) so `/admin` is reachable in local dev
  and in this repo's CI without an MFA enrollment flow existing yet.
- The check itself (reading the assurance level and the gate for when the
  flag is on) is real and wired now, so a later phase only has to build the
  enrollment UI and flip the flag -- not add the boundary from scratch.

## Must happen before production

Set `ADMIN_REQUIRE_AAL2=true` as a Cloudflare Worker secret/var, and ship an
MFA enrollment flow for admin accounts before that flag is flipped, or every
admin will be locked out. Track this in the Phase N (Final integration)
production readiness checklist.
