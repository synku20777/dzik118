# 0009 - Organization archive and personal data export

**Status:** Accepted
**Date:** 2026-09-30
**Phase:** D (Organizations) / Resident portal

## Context

An organization can stop using the app. Until now the `archived_at` column
existed, but nothing set it, and nothing read it except the scheduler. A person
can also ask what data the app holds about them. There was no way to answer.
The owner decided both rules on 2026-09-30.

## Decision: archive an organization

- **Soft flag only.** `organizations.archived_at` is the one switch. No data is
  deleted. No schema change.
- **Read-only for admins.** An admin of an archived organization can open every
  page and download every file. Every change is refused with the message "This
  organization is archived. Restore it in Settings to make changes."
- **Locked out for residents.** A resident of an archived organization cannot
  use the portal. The sign-in works, and then the app shows "This organization is
  closed". A person who belongs to two organizations keeps the open one.
- **Invoice links stop working.** An old email link gives the same "invalid or
  expired" answer as any wrong link. The links work again after a restore.
- **Jobs stop.** The scheduler skips an archived organization. It asks again
  before each step that changes data, so an archive during a run stops the run.
- **Restore.** An admin restores the organization on the same Settings page.
  Everything returns. Archive needs a reason of 1 to 500 characters. Archive and
  restore each write an audit event (`ORGANIZATION_ARCHIVED`,
  `ORGANIZATION_RESTORED`), and a repeated call writes nothing.

### How the rule is enforced

- `loadAuthContext` lists the archived organizations of the person
  (`archivedOrganizationIds`) and leaves the dwellings of archived organizations
  out of `dwellingIds`. Every resident page and API already checks
  `dwellingIds`, so one change locks all of them.
- `requireActiveOrganization` replaces `requireOrganizationAccess` in every
  action that changes data. A unit test (`action-guards.test.ts`) fails when an
  action uses the read guard without being on its short list of read-only
  actions. A new action cannot skip the rule by accident.
- Some changes do not go through an action. Each one has its own check: the two
  CSV import pages, `reply` in messaging, `markConversationRead`, the invoice
  link lookup, and the scheduler.

## Decision: personal data export

- An admin downloads the data of one person from the resident row on the
  dwelling page. A resident downloads their own data from the profile page.
  Both give one JSON file.
- The file holds: the person (email, display name, disabled flag), and for each
  dwelling the person can access: the dwelling details, sent invoices with their
  lines and delivery records, payments and reversals (date, amount, invoice,
  payer name, reference), account entries, meter readings, messages, and what the
  person did in the app (action, kind of record, time).
- The file never holds: token hashes, payer account numbers, raw bank rows,
  ledger metadata, idempotency keys, internal notes, reasons written by an admin,
  request IDs, IP hashes, the email address of another person, or any dwelling
  the person cannot access. Other senders in a message thread appear only as a
  role.
- The query starts from the person's own dwelling access, so it cannot read a
  dwelling that the person does not hold. Every query lists its columns. A new
  column never reaches the export by default.
- An admin can export only a person who has access in the admin's organization.
  The answer is the same for "no such person" and "person of another
  organization".
- The download is rate limited, sent with `Cache-Control: no-store`, and writes
  an audit event `PERSONAL_DATA_EXPORTED` for each organization in the file.

## Decision: portal upgrades

- **Payment history.** A resident sees date, amount, invoice, and status for each
  payment. A reversed payment shows a second row marked "Reversed". The resident
  never sees the reason, the payer name, the payer account, or the bank
  reference. Only invoices that the resident can already see (sent, paid,
  overdue) appear.
- **Display name.** A resident can change their display name (1 to 100
  characters). The email address stays fixed. Sign-in, the suppressed list, and
  invoice link revocation all find a person by email. An admin invites a person
  again when the address must change.
- **Meter history.** The table shows every meter type that has a reading.
  Several meters of one type add up. Two units of one type stay in two columns.
- **Not built:** a resident cannot leave a dwelling. The owner said no.

## Limits

- An archive that commits while another request is running does not stop that
  request. Each request reads its archive state once, at the start. The window is
  the length of one request. A full fix needs a lock on the organization row in
  every change.
- A late bounce or complaint from SES still adds an address to the suppressed
  list of an archived organization. This is data from the mail provider, and the
  address stays blocked after a restore.
- Opening a conversation in an archived organization does not mark it read.
- The export follows the dwelling, not the person alone. Text that a co-resident
  of the same dwelling wrote (a message) or that names another person on the
  dwelling (occupant or billing name, payer name) stays in the file. The email
  address of another person does not. The dwelling records belong to everyone who
  lives there.
- The export is a snapshot of the current data. It does not include old versions
  of a row.
- There is no retention rule. An archived organization keeps its data until the
  owner decides on one.

## Consequences

- One more page (`/closed`) and two more API routes.
- Every new action that changes data must use `requireActiveOrganization`. The
  unit test enforces this for actions. A new page that changes data outside an
  action needs its own check.
