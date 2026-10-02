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

## Batch 7: typography from the marketing site

The owner asked for the typography of the marketing site in the app. The
specification is `docs/TYPOGRAPHY.md` in the `namkopa-website` repository.
[ADR 0010](decisions/0010-typography.md) records the decision and the limits.

| Change | Where |
| --- | --- |
| Replace Source Sans 3 with Switzer. Add Overused Grotesk as the fallback (it has Cyrillic). | `global.css`, `src/fonts` |
| Use Fraunces with the axes SOFT 40 and WONK 0. Weight 700 above 36px, 600 below. | `global.css`, three pages |
| Add letter-spacing +0.03em to all sans text with one token. | `global.css` |
| Serve all fonts from the app. Remove Google from the CSP. | `src/fonts`, `middleware.ts` |
| Fix eight layouts that the wider font broke or made worse. | Portal header, dwelling page, audit page, tables |
| Update the UI specification. | `docs/product/UI_SPECIFICATION.md` |

Agy did three scopes: an audit of every font, weight, and letter-spacing in the
pages, the weight changes in three pages, and the layout fixes. A person wrote
the central CSS and reviewed each diff.

Checks:

- A test measured 216 page views before and after (admin, resident portal, and
  public pages, in three languages, at desktop, tablet, and phone widths). Page
  views with a horizontal scroll: 8 before, 0 after. Tables that scroll: 17 and
  17. Buttons that wrap: 303 and 295.
- A second test checked the admin pages and the portal at 320px and 360px, in
  light and dark, in three languages. No page has a horizontal scroll.
- The acceptance checks of the specification pass. The browser reports Switzer
  for sans text and Fraunces for display text. The letter-spacing ratio is 0.03
  at 12px, 13px, and 14px, also in inputs and table cells. Display weights are
  700 at 40px and 44px, and 600 at 33.6px and below. Latvian macrons are over
  their own letters at weights 400 to 800. Russian sans text is Overused
  Grotesk. All font requests go to the app's own domain.
- Lint, type check, `astro check`, formatting, and 279 unit tests pass.

Three buttons now wrap onto two lines (two on Messages on a phone, one on the
workbench on a tablet). They stay inside the page.

## Rename: the app is "Namkopa"

The owner renamed the product from "Property Billing" to "Namkopa", the name of
the marketing site.

- Every page title, the brand in the sidebar and the headers, the sign-in pages,
  and the subject of the alert email now say "Namkopa".
- The name is not translated. The Latvian and Russian dictionary entries for the
  old name are removed, so all three languages show "Namkopa".
- `README.md` and `docs/TESTING.md` use the new name.
- Not changed: the package name and the Worker name (`property-billing`). The
  Worker name is the deployed identifier. A new name there makes a new Worker
  without the secrets and the domain.
- Not changed: the product specifications in `docs/product` (they are the
  record of the first design), the admin guide screenshots in `public/guide`
  (they show the old name), and sent invoices (they never showed the name).

Checks: lint, type check, `astro check`, formatting, 279 unit tests, and the
build pass. The sign-in page shows "Namkopa" in the title and the brand in
English, Latvian, and Russian.

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

## Invoice eligibility (2026-10-02)

Problem: a billing case was READY when it had no missing inputs. A case with no
billable rule also had no missing inputs. It showed READY, and invoice generation
then refused it.

- `resolveInvoiceEligibility` in `src/domain/periods/case-readiness.ts` is now
  the one answer to "can this dwelling be invoiced?". Case readiness stores its
  blockers. `generateInvoice` calls it again in its transaction and builds the
  invoice lines from its rules. READY now means that generation succeeds.
- Two new blockers are stored in `billing_cases.missing_data`:
  `NO_APPLICABLE_RULES` (no rule can make an invoice line) and
  `NO_ACTIVE_METER_FOR_RULE` (a meter rule is assigned to the dwelling by name,
  and the dwelling has no active meter of that type). An organization-wide meter
  rule on a dwelling without that meter is not a blocker.
- Each rule change now recalculates open cases. Before, a FIXED, AREA, or
  RESIDENT_COUNT rule did not.
- Codex review found three stale-readiness paths. All are fixed: a meter edit now
  recalculates, the CSV import makes the cases after the meters, and bulk
  generation no longer skips on the stored blockers.
- The period workbench, the dashboard, and the admin guide show the new blockers
  in EN, LV, and RU (Agy).
- Checks: typecheck, lint, `astro check`, 279 unit tests. Integration tests are
  at the usual 41 local failures (SMTP, PDF, Storage). Two new integration tests
  cover the blockers. The new UI items were not run in a browser.
- Old cases keep their stored status until the next recalculation. Generation is
  safe before that, because it resolves the blockers live.

## Tariff applicability on the period page (2026-10-02)

- The rule resolver is unchanged. A tariff applies when its effective dates
  overlap the period, and the editor accepts an earlier `Effective from` date.
- The period workbench has a new "Tariffs in this period" panel. It lists each
  tariff, with its effective dates, and one reason: applies to all dwellings,
  applies only to the assigned dwellings (with their numbers), no dwelling
  assigned, disabled, archived, starts after the period, or ended before it.
- `ruleStatusForPeriod` in `src/domain/billing/rules.ts` gives the reason. A unit
  test covers it. It must stay in step with `getEffectiveRules`.
- The "No billing rule applies" item on a case now links to this panel.
- LV and RU text by Agy. A browser check ran the panel in EN, LV, and RU, and at
  phone width. The demo data has only tariffs that apply, so the "does not
  apply" lines were not seen in a browser.

## Retroactive billing (2026-10-02)

See `docs/decisions/0011-retroactive-billing.md`.

- New on the period page: "Reopen period" on a locked period, and a "Dwellings
  not in this period" panel with "Add to period" on an open period.
- New domain functions in `src/domain/periods/periods.ts`: `reopenPeriod`,
  `addDwellingToPeriod`, `listDwellingsWithoutCase`. New actions:
  `periods.reopen`, `periods.addDwelling`.
- Codex review found that a reopened older period became the "current" period.
  Fixed: `getCurrentOpenPeriod` returns the newest period only when it is open,
  and a new dwelling gets a case in the current period only. Also fixed: the
  add action locks the dwelling row, and a reopen does not touch cases that have
  an invoice.
- Not changed: a retroactive invoice shows the account balance of the day it is
  generated. The owner selected to keep the period dates.
- LV and RU text by Agy.
- Checks: typecheck, lint, `astro check`, 282 unit tests. Integration tests are
  at the usual 41 local failures. A new integration test covers reopen, add,
  reading, and invoice. The two new buttons were not run in a browser.

## Carry-forward readings after the deadline (2026-10-02)

- After the reading deadline of a period, a required meter with no reading gets
  a reading from the system. The value is the previous reading, so the
  consumption is zero. The next real reading then bills the full difference.
- The reading has the new source `CARRIED_FORWARD` and no user. Each one writes
  the audit event `METER_READING_CARRIED_FORWARD`. Migration
  `0018_reading_carried_forward.sql` adds the enum value.
- `carryForwardMissingReadings` in `src/domain/periods/readings.ts` does the
  work. The daily scheduler calls it for the current period of each
  organization. Bulk generation calls it first. The deadline day is not
  included. A period with no deadline is never carried.
- A meter with no earlier reading stays a `NO_READING` blocker.
- An admin can replace a carried reading. The usual limits apply: not after a
  later period has a reading, and an invoice that exists must be regenerated or
  corrected.
- The reading drawer shows a note on a carried reading. The resident portal
  shows the source as "Previous reading reused". EN, LV, and RU.
- Codex review: the function now resolves the blockers live. The other findings
  are limits of reading edits that existed before.
- The feature is off by default. The toggle "Reuse the previous reading after
  the deadline" on the billing settings page turns it on for an organization
  (column `carry_forward_readings_enabled`, migration
  `0019_carry_forward_setting.sql`).
- Fixed on the way: a save of the organization settings page switched the
  automation toggles off, because its form sent no value for them. The form now
  sends their current values. A browser check confirmed the fix.
- Checks: typecheck, lint, `astro check`, unit tests. A new integration test
  covers the function. The drawer note was not run in a browser.

## Knowledge graph for the agents (2026-10-02)

- `graphify` made a knowledge graph of `src`, `docs`, `tests`, `drizzle`, and
  `scripts` in `graphify-out/` (not in git). The SQL migrations are included.
- Agy reads the rule in `.agents/rules/graphify.md`. Codex reads `AGENTS.md` and
  `.codex/hooks.json`. Both can run `graphify query`, `graphify affected`, and
  `graphify path` before they open files.
- `.graphifyignore` keeps agent tooling, build output, and static files out of
  the graph. Without it, `graphify update .` doubles the graph.
- `graphify update .` renames the communities after their hub node. Only a full
  `/graphify` run gives readable names again.

## Summary of 2026-10-02 and open items

Work of the day, in order: knowledge graph, invoice eligibility, tariff
applicability panel, retroactive billing, carry-forward readings, and the
carry-forward setting. Each has its own section above. Nothing is committed.

What a deploy needs:

- Migrations `0018_reading_carried_forward.sql` and
  `0019_carry_forward_setting.sql`.

Behavior that changed for admins:

- A case with no billable tariff shows MISSING DATA, not READY.
- A new dwelling gets a case in the current period only. Add it to an earlier
  open period with "Add to period".
- The current period is the newest period, when it is open.
- A save of the organization settings page no longer switches the automation
  toggles off.

Open items:

- Old cases keep their stored status until the next recalculation. A one-time
  backfill script can refresh them.
- The status name MISSING DATA also covers "no tariff applies". A new name needs
  an enum change.
- A retroactive invoice shows the account balance of the day it is generated.
- With auto generation and carry-forward both on, the scheduler can send an
  invoice with zero consumption. A later real reading then needs a regenerated
  or corrected invoice.
- A carried reading cannot be replaced after a later period has a reading for
  the same meter.
- Not run in a browser: the two new blockers on the period page, the "does not
  apply" lines of the tariff panel, "Reopen period", "Add to period", and the
  carry-forward note in the reading drawer.
- Codex did not review the tariff panel or the carry-forward setting.

## Property change history (2026-10-02)

- Agy implemented the change through the Orca CLI; Codex reviewed and fixed it.
- Audit events have nullable `scopeDwellingId`. Dwelling events get it from
  `entityId` in the shared writer. Meter, reading (including carry-forward),
  invoice delivery and billing, payment, account adjustment, manual rule input,
  case, and conversation events store their dwelling explicitly. Resident
  assignments/removals use the dwelling default; enable/disable events are
  recorded for every dwelling the resident can access in the organization.
- The dwelling History panel now filters by organization and dwelling scope,
  keeping its existing 20-event limit. Entity types and IDs are unchanged.
- Migration `0020_dwelling_scoped_audit.sql` adds the column and timeline index
  and backfills historical events from same-organization relationships.
  Manual payment events use their recorded invoice ID; credit events use the
  actual payment ledger entry. Ambiguous or unresolved events stay unscoped.
  Historical resident enable/disable events cannot be reliably backfilled.
  Scope has no foreign key, so deleting a dwelling cannot erase the association.
- Codex fixed ambiguous payment backfill, unsafe JSON-to-UUID casts, missing
  resident scope, and a missing dwelling field in the manual-payment query.
- Checks: typecheck, lint, Astro check (zero diagnostics), 282 unit tests,
  and 71 targeted integration tests passed. The migration test uses temporary
  tables and covers all backfill types, organization isolation, malformed
  payloads, ambiguous credits, and retained scope after dwelling deletion.
- Graphify code output refreshed with `graphify update .`. No browser check,
  commit, or deployment. Deployment also needs migration 0020, after 0018/0019.

## Move to app.namkopa.com (2026-10-02, deployed)

- The owner requested the domain move and publication of the pending features.
  Cloudflare already has `app.namkopa.com` connected to `property-billing`, with
  working HTTPS and database health. Supabase remains project
  `ovsdkhrxnvpjelqprxmk`; no database or user-account move is needed.
- The route is now in `wrangler.jsonc`, with preview URLs disabled. Middleware
  redirects the old Worker hostname to `APP_BASE_URL`, preserving path/query.
  The deploy workflow and environment example use the production app URL.
  The live Worker secret `APP_BASE_URL` was updated to `https://app.namkopa.com`.
  Supabase Auth Site URL and the exact redirect allow-list were updated and
  verified through the CLI after access became available. Existing SMTP
  settings were preserved. `EMAIL_FROM` matches its `billing@namkopa.com` sender.
- Added `node scripts/check-app-domain.mjs` for post-deploy verification.
  Build, typecheck, lint, and Wrangler deployment dry-run passed. Graph updated.
- Production migrations 0018, 0019, and 0020 were applied through Supabase,
  with matching Drizzle journal hashes. All 143 audit events were retained;
  108 received a dwelling scope. The enum, setting, and scope index verified.
  A pre-migration snapshot of the affected organization, reading, audit, and
  Drizzle-journal data is saved outside the repository at
  `C:/Users/nesto/.codex/backups/dzik118/2026-10-02-pre-domain-migration.json`.
- The owner configured the SES credentials; the required-secret check passed.
  Published the pending features as Worker version
  `1890a7b5-772d-4cc3-ad3f-0531ddfb7381`, including the scheduled trigger.
  The domain check passed after brief edge propagation: old home, login, and
  confirmation URLs return 308 with path/query preserved; new home, login,
  and database health return 200. Supabase Auth uses the new domain.
- Supabase security advisors reported existing function search-path and leaked
  password-protection warnings; no new tables or RLS policy changes were made.
  References: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
  and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
  No real invoice email was sent as part of the domain check.
