# Work log: gap batches 1 and 2

This log lists the changes made from [KNOWN_GAPS.md](KNOWN_GAPS.md). Agy wrote
the first code for each item. A person reviewed each change. Codex reviewed each
change a second time and audited it for extra code.

## Batch 1

| Change | Where |
| --- | --- |
| Link a `MISSING_DATA` period row to the workbench. | Dwelling page |
| Link each confirmed payment to its invoice and dwelling. | Payments page |
| Add a late-fee waiver and a manual adjustment for a draft invoice. | Invoice page |
| Add "Override status" with a required reason and a confirm dialog. | Invoice page |
| Add meter edit and the `METER_UPDATED` audit event. | Dwelling page |
| Block a status override that does not match the invoice. | `overrideCaseStatus` |
| Show the Edit control on a meter that was just added. | Dwelling page |

## Batch 2

| Change | Where |
| --- | --- |
| End the resident reading deadline at midnight in the organization timezone. | `readings.ts` |
| Show the amount paid and the amount still due to the resident. | Resident invoice page |
| Add `GET /api/health`. It returns 200 when the database answers. | `src/pages/api/health.ts` |
| Add date range, actor, and entity type filters. | Audit page |
| Add disable and enable for a resident account. | Dwelling page |
| Add tests for statements and case readiness. | `tests/integration` |

## Batch 3

| Change | Where |
| --- | --- |
| Add a search box and a date range to the current tab. | Payments page |
| Show the periods list and the messages inbox one page at a time. | Periods, Messages |
| Load only the last message and the unread flag for each conversation. | `conversations.ts` |
| Add CSV export of the audit log, up to 5,000 rows. | Audit page, `audit/export.ts` |
| Share one date parser for the audit page, the audit export, and payments. | `src/lib/date-input.ts` |
| Update the admin guide for the new controls, in English, Latvian, and Russian. | Guide page |

## Batch 4: decisions from the owner

The owner answered the open questions. [ADR 0006](decisions/0006-payment-corrections-manual-entry-and-alerts.md)
records the answers.

| Change | Where |
| --- | --- |
| Record a bank transfer by hand. The payment applies right away. | Payments page, `manual.ts` |
| Reverse a confirmed payment with a reason. | Confirmed tab, `reversal.ts` |
| Match an unmatched payment to an invoice. | Unmatched tab, `manual.ts` |
| Show a Reversed tab. | Payments page |
| Add the `payment_reversals` table and the `PAYMENT_REVERSAL` ledger entry. | Migration 0015 |
| Email `ALERT_EMAIL` when the scheduled job fails or cannot deliver invoices. | `scheduled-jobs.ts` |
| Describe the alerts and the uptime monitor. | `docs/deployment/monitoring.md` |

Admin MFA stays off by the owner's choice. This differs from the spec.

Codex found these problems in its review. All are fixed:

- One bank payment could be confirmed against two invoices. The second
  confirmation now fails.
- Two identical manual entries at the same time could both apply. A lock now
  lets only one pass.
- A reversal could race with a new invoice that uses the credit. The reversal
  now locks the organization row. It also checks the invoice update time.
- Failed invoice delivery did not send an alert. It does now.
- The alert text could hold an email address or a long number. The alert now
  hides both.
- An import with a reversed payment showed the same bank row twice. It shows
  one row now.
- The Reversed status had no translated label. It has one now.
- A paid invoice from before payment records showed "Paid so far: 0.00". It now
  shows the full amount.

Reversal has one known limit. A reversal does not change the "previous
outstanding" amount on a later invoice that was already issued. The next
invoice picks up the correct balance from the ledger.

## Batch 5: hardening, translations, audit trail, bounces

The owner asked for another batch and chose the audit trail and the clean-up.
A fresh review by three readers (security, resident side, operations) added more
items. Each finding was checked in the code before work began.

| Change | Where |
| --- | --- |
| Refuse a magic link for an admin. Refuse it for a disabled user. | `auth/confirm.ts` |
| Store email addresses in lowercase. Migration 0016 fixes old rows. | `organizations.ts`, `dwellings.ts`, `context.ts` |
| Refuse zero and negative bank rows, in the import, in matching, and in the database. | `bank-import.ts`, migration 0016 |
| Use the organization timezone for the reading deadline on the resident page. | Resident dwelling page |
| Close invoice links when the person who received them leaves. | `removeResidentAccess` |
| Limit bulk lists to 200, cap the dwelling CSV, add three CSP rules, log no SQL parameters. | Actions, middleware, `errors.ts` |
| Rate limit PDF downloads, messages, and reading entry. Add a per-email login limit. | `rate-limit.ts`, actions |
| Translate 92 more domain error messages. A test now fails when one has no translation. | `i18n.ts`, `i18n-errors.test.ts` |
| Choose the language from the browser on the first visit. | `middleware.ts` |
| Store a request ID and a hashed IP in every audit row. Show the ID on the audit page. | `request-context.ts`, `audit.ts` |
| Print quantities without trailing zeros on new invoices. | `decimal-trim.ts`, label set 3 |
| Stack nine more tables on phones. Add table captions and header scopes. Enlarge the language switch. | Pages, `LanguageSwitch.astro` |
| Handle bounces and complaints. Keep a suppressed list. | `ses-events.ts`, `suppression.ts`, migration 0017 |
| Send automatically on the send day and for seven days after it. | `send-window.ts`, `scheduler.ts` |
| Check Worker secrets before a deploy. Write backup and rollback steps. | `check-worker-secrets.mjs`, runbook |
| Write ADR 0007 (admin and resident) and ADR 0008 (bounces). | `docs/decisions` |

Codex reviewed the work. These are the problems it found. All are fixed:

- An admin could keep a session from a magic link. A disabled or unprovisioned
  person could also keep one. The confirm step now checks the account.
- The deploy check for secrets skipped itself on any error. It now skips only
  when the Worker does not exist yet.
- Auto send picked the oldest 50 invoices first. Paper-only invoices and
  invoices without an email could fill the batch every day. The selection now
  leaves them out and counts them.
- A failed send on day 28 was not tried again after the month changed. The send
  window now reaches across a month end.
- The new quantity format would also change how an invoice that was sent before
  prints. The format is now pinned to the label set of each invoice, as the label
  wording already is.
- The bounce endpoint trusted a secret in the URL. A logged URL could forge an
  event. The endpoint now also verifies the SNS signature.
- One translated message was stored in a constant. The translation test did not
  see it. The test now reads constants as well.
- A person who is both admin and resident replied as `ADMIN` from the resident
  portal. The reply now records the screen it came from.
- The request size check ran after the body was read. It now checks the header
  first and then the real byte size.

Limits:

- The two new database checks on bank rows use `NOT VALID`. They protect new
  rows and skip old ones. Clean old rows, then run `VALIDATE CONSTRAINT`.
- Auto send still retries a permanent failure every day for seven days. A
  bounce is the common case, and the suppressed list stops it.
- I could not reproduce a skip-link problem. The link works on the admin pages.

## Batch 6: organization archive, data export, portal upgrades

The owner chose these items and set the rules. [ADR 0009](decisions/0009-organization-archive-and-personal-data-export.md)
records them. The owner decided that a resident cannot leave a dwelling.

| Change | Where |
| --- | --- |
| Archive and restore an organization. A reason is required. Both write an audit event. | `organizations.ts`, Settings > Organization |
| Make an archived organization read-only. Every action that changes data uses `requireActiveOrganization`. | `guards.ts`, `src/actions` |
| Keep the dwellings of an archived organization out of the resident context. | `context.ts` |
| Show "This organization is closed" to a resident of an archived organization. | `/closed`, `middleware.ts`, `auth/confirm.ts` |
| Stop invoice email links of an archived organization. | `invoice-tokens.ts` |
| Show a banner and an Archived badge. | `AdminLayout.astro`, organizations page |
| Fail a test when an action uses the read guard by mistake. | `action-guards.test.ts` |
| Export the data of one person as JSON. An admin and the resident each have a route. | `person-export.ts`, two API routes |
| Add "Export data" on the dwelling page and "Download my data" on the profile. | Pages |
| Add a payment history page. A reversal shows as "Reversed" with no reason. | `resident-history.ts`, portal |
| Let a resident change the display name. | `profile.ts` |
| Show a meter history for every meter type. Sum meters of one type. | `cases.ts`, portal dashboard |
| Add four guide entries in English, Latvian, and Russian. | Guide page |

Codex reviewed the work. These are the problems it found:

- Fixed: the scheduled job chose its organizations once. An archive during a run
  could still send an invoice email. The job now asks again before each step
  that changes data.
- Fixed: opening the inbox of an archived organization marked messages as read.
  `markConversationRead` now does nothing there.
- Not fixed, by decision: a request that started before the archive can still
  finish. The window is the length of one request. A fix needs a lock in every
  change.
- Not fixed, by decision: a late bounce from SES still adds an address to the
  suppressed list of an archived organization. The address stays blocked after a
  restore.

I found one more problem in the browser. The banner did not show on the page that
ran the archive, because the auth data loaded before the action. The page now
passes the new state to the layout.

Checks:

- Lint, type check, `astro check`, and 279 unit tests pass.
- The integration suite fails in the same 5 files and the same 41 tests as
  before. The new tests pass: `organization-archive`, `person-export`, and
  `portal-upgrades`, and the two changed tests in `resident-ux` and
  `authorization`.
- A browser test ran the whole flow: export, archive, refused write, organization
  list, closed page in English, Latvian, and Russian, restore, payment history in
  three languages, display name, meter history with an electricity column, and
  both downloads.
- No test used a live invoice link in the browser. An integration test covers the
  link, including the restore.

## Guide update

The guide now describes meter edit, the unit lock, the reading deadline, draft
adjustments, payment search, override status, resident disable, what a resident
sees, the audit log, manual payments, payment reversal, and matching an
unmatched payment, bounced emails, automatic sending with a catch-up, and why
an administrator cannot use a sign-in link. It has nine new questions. The
confirmation answer now lists every action that asks for confirmation. Codex
checked each claim against the code and checked the English against the STE
rules. Its corrections are in the text. The LV and RU text uses the same terms
as the screens.

## Rules that the code enforces

- A meter unit cannot change after a reading exists.
- An override to `SENT` needs a sent invoice. An override to `PAID` needs a paid
  invoice. An override to `MISSING_DATA` or `READY` fails when an invoice exists.
- An admin cannot disable a person who has an admin role, has access in another
  organization, or is the admin who acts.
- A disabled resident gets no sign-in link and cannot use an old session.

## Problems that review found

- A status override and an invoice generation could race. The override now
  locks the case row.
- Two grants of access could race with a disable. The disable now locks the
  person row first.
- An unknown date or a bad UUID in the audit URL could cause a server error. The
  page now ignores both.
- A paid invoice from before payment allocations showed the full amount as due.
  It now shows zero.
- The CSV export did not neutralize a formula that starts with a space or a new
  line. It now does.
- Two messages with the same time could swap places as the last message. The
  query now breaks the tie with the row ID.
- A message page other than the first selected a conversation from page one.
  It now selects the first conversation on the current page.
- The audit export ignored a bad filter and exported more rows. It now returns
  an error for a bad filter.

## How the work was checked

- Lint, type check, `astro check`, and 278 unit tests pass.
- The integration suite fails in the same 5 files as before, because the local
  SMTP, PDF, and Browser Rendering services are not present. Batch 5 adds one
  failing test there: the catch-up test in `automation.test.ts`. It sends an
  invoice, so it fails in this sandbox like the tests beside it. Unit tests cover
  the same rules (`send-window.test.ts`).
- Browser tests ran the new screens. A real magic link for an admin was refused,
  and one for a resident worked. A Latvian browser got Latvian on the first visit.
  Phone-width pages stack their tables.
- The resident balance panel was not run in a browser. An integration test covers
  its numbers.
- The bounce endpoint was tested with generated RSA keys and real signatures. It
  was not tested against live AWS.

## Still open

- The unused logo column, and a test print in the template editor.
- Checks that total an invoice from its lines, and an enum for the delivery
  status.
- Admin MFA enrollment. The owner deferred it. Build it before real resident data.
- Run `VALIDATE CONSTRAINT` on the two bank checks after old rows are clean.

## Local setup note

Windows can reserve the ports that Supabase uses after Docker restarts. Then
`npx supabase start` fails on port 54322. Run `net stop winnat` and then
`net start winnat` in an administrator shell. Then start Supabase again.
