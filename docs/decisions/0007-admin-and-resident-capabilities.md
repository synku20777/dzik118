# 0007 - Admin and resident capabilities are independent

**Status:** Accepted
**Date:** 2026-09-30
**Phase:** C (Auth/security) / D (Organizations)

## Context

The first design gave each person one role, `ADMIN` or `RESIDENT`, in
`app_users.role`. The product owner needs a person to be both. An owner who
lives in the building is an admin of the organization and a resident of a
dwelling. Several people in one dwelling can be admins as well.

## Decision

- A person has two independent capabilities. Access rows grant them:
  - **Admin:** a row in `organization_memberships` for each organization.
  - **Resident:** a row in `dwelling_access` for each dwelling.
- `app_users.role` records the capability that was granted first. No code
  reads it to decide access. Do not use it for authorization.
- `loadAuthContext` (`src/domain/authorization/context.ts`) reads both tables
  on every request. It returns `organizationIds` and `dwellingIds`. A disabled
  person gets no context.
- Every guard checks the capability it needs: `requireOrganizationAccess` for
  admin pages and actions, `requireDwellingAccess` for resident pages. A
  person with both can use both areas.
- Adding a person as an admin does not remove their resident access. Adding a
  person as a resident does not remove their admin access.

### Sign-in

- Anyone with admin capability signs in with a password only.
- `request-link` sends no magic link to an admin. `auth/confirm` also refuses
  a magic link session for an admin, because Supabase's link endpoint is public.
  The person sees a message to use the admin form.
- Password reset works for anyone with admin capability and needs a fresh
  one-time code from the email link.
- A resident without admin capability signs in with a magic link.

### Messages

- Each message records `sender_role` when it is sent. A person who holds only
  one capability for the conversation sends as that role.
- A person who holds both for the same conversation sends as the screen they
  used: `RESIDENT` from the resident portal, `ADMIN` from the admin inbox. The
  reply form sends the screen as `sentAs`. The server checks that the person
  holds that capability, so a forged value changes nothing. Without a value, a
  person who can be an admin sends as `ADMIN`.

### Limits

- An admin cannot be disabled on the dwelling page. Remove the admin on the
  Users page first.
- A person with access in more than one organization cannot be disabled by
  one of those organizations. The account is shared.
- The last admin of an organization cannot be removed.

## Consequences

- No migration is needed to add or remove a capability.
- Tests must cover a person with both capabilities for each new guard.
- A reviewer must reject code that reads `app_users.role` for access.
