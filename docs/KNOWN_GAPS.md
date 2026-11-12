# Known gaps

This file lists missing features and dead ends found in the discovery pass of
2026-09-29. Codex read the code against the spec. Agy reviewed the live admin
screens. A person re-checked each item against the code. Deliberate limits and
trade-offs are in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). This file
lists work that is not done yet.

Status: `[ ]` open, `[~]` in progress, `[x]` done, `[?]` needs a decision.

## Backend exists, no screen reaches it

- [x] **Late-fee waiver and invoice adjustment on a draft invoice.**
  `accounts.adjustLateFee` and `accounts.setInvoiceManualAdjustment` work and
  have tests. No page calls them.
- [x] **Status override.** `billing.overrideStatus` works and writes an audit
  event. No page calls it.
- [x] **Period history link.** On the dwelling page, a `MISSING_DATA` row shows
  "—" with no link to the period workbench, where readings are entered.
- [x] **Confirmed payment rows.** The Confirmed tab shows no link to the
  invoice or the dwelling.

## Missing capability

- [x] **Edit a meter.** Only create and archive exist. The spec requires a
  `METER_UPDATED` audit event. No code writes it.
- [x] **Disable or enable a resident account.** Done. An admin can disable or
  enable a resident on the dwelling page. The action needs a person who has
  access in this organization only and holds no admin role.
- [x] **Reading deadline uses UTC.** Done. The deadline now ends at midnight in
  the organization timezone.
- [x] **Resident invoice page shows the frozen amount.** Done. The page now
  shows the amount paid and the amount still due.
- [x] **Audit page.** Done. The page has a date range, an actor filter, an
  entity type list, and a CSV export of up to 5,000 rows. Every new row stores a
  request ID and a hashed IP.
- [x] **Payments page.** Done. The current tab now has a search box and a date
  range.
- [x] **Operations.** Done. `GET /api/health` checks the database, and alerts
  are set up (see below). Single request errors stay in the Cloudflare logs.
- [x] **Pagination.** Done. The periods list and the messages inbox now show one
  page at a time. The inbox no longer loads every message.
- [x] **Tests.** Done. `statements.test.ts` and `case-readiness.test.ts` now
  cover both modules.
- [ ] **Smaller items.** Organization archive and resident data export are
  done (see batch 6). The `invoice_templates.logo_object_key` column is unused.
  The template editor has no test print.
## Follow-ups from batch 1

- [x] **Status override accepts any status in the action.** The screen does not
  offer `SENT` or `PAID`, but `billing.overrideStatus` still accepts them. The
  domain function does not check the invoice or payment state. Add transition
  rules there.
- [x] **New meter row has no Edit control until the page reloads.** The
  client script builds the row after an add. It does not copy the edit form.

## Decided on 2026-09-30

See [ADR 0006](decisions/0006-payment-corrections-manual-entry-and-alerts.md).

- [x] **Manual payment entry.** Done. "Record a payment" on the Payments page
  takes a bank transfer that is not in a statement. The payment applies right
  away. The app blocks a duplicate. Cash and a payment to a dwelling with no open
  invoice were added later (ADR 0014).
- [x] **Reverse a confirmed payment.** Done. "Reverse" on the Confirmed tab
  posts a cancelling entry. The payment returns to Unmatched.
- [x] **Match an unmatched payment to an invoice.** Done. This was missing. The
  Unmatched tab had no action.
- [x] **Error alerts.** Done without a vendor. The app emails `ALERT_EMAIL` when
  the scheduled job fails or cannot deliver invoices. A free uptime monitor
  watches `GET /api/health`. See
  [the monitoring guide](deployment/monitoring.md).
- [ ] **Admin MFA enrollment.** Deferred by the owner. This differs from spec
  Section 15.2 and [ADR 0002](decisions/0002-admin-aal2-boundary.md). Build it
  before the app holds real resident data.
## Second review on 2026-09-30

Three readers checked security, the resident side, and operations. See
[WORK_LOG.md](WORK_LOG.md), batch 5.

- [x] **Magic link for an admin.** Fixed. The confirm step refuses it.
- [x] **Zero and negative bank rows.** Fixed, in the import, in matching, and in
  the database.
- [x] **Resident deadline in UTC.** Fixed on the resident page.
- [x] **Domain errors shown in English.** Fixed. 92 messages now have LV and RU
  text. A test keeps it that way.
- [x] **Hardening.** Done: bulk and CSV limits, CSP rules, rate limits, safe
  logs, and cache headers on exports and PDFs.
- [x] **Bounces and complaints.** Done. See
  [ADR 0008](decisions/0008-bounce-and-complaint-handling.md).
- [x] **Auto send on one day only.** Done. It now retries for seven days.
- [x] **Deploy safety.** Done: a secrets check, and backup and rollback steps.
- [x] **Mobile tables, captions, and the language switch.** Done.
- [x] **Resident portal.** Done in batch 6: payment history, an editable
  display name, and a meter history for every meter type. The owner decided that
  a resident cannot leave a dwelling, so that is not built.
- [ ] **Invoice checks in the database.** Nothing ties an invoice total to its
  lines. The delivery status is free text.
- [ ] **Validate the new bank checks.** They protect new rows only. Clean old
  rows, then run `VALIDATE CONSTRAINT`.
- [ ] **Invoice logo, template test print.** Unchanged from the list above.

## Batch 6 (2026-09-30)

See [ADR 0009](decisions/0009-organization-archive-and-personal-data-export.md).

- [x] **Organization archive.** Done. An archived organization is read-only for
  admins. Residents see a closed page. Old invoice links stop working. Restore
  undoes all of it.
- [x] **Resident data export.** Done. An admin exports one person from the
  dwelling page. A resident exports their own data from the profile page.
- [ ] **Archive race.** A request that started before the archive can still
  finish. Each request reads the archive state once.
- [ ] **Retention.** No rule decides when the app may delete an archived
  organization. The owner has not decided.

## Guided setup (2026-10-05)

See [ADR 0012](decisions/0012-guided-setup-and-starting-readings.md).

- [x] **Guided setup.** Done. Six steps, progress from saved data, honest
  readiness. A new organization opens it.
- [x] **First-month meter reading.** Done. Starting readings are stored in a
  locked opening period, typed or imported from CSV.
- [x] **Range entry and CSV templates.** Done.
- [x] **Period-wide reading grid.** Done.
- [ ] **Opening balances.** Debt or credit from the old system. The ledger has
  the `OPENING_BALANCE` type, but no audited import exists.
- [ ] **Meters added later.** A meter added after the first billing month has
  no starting reading. Its first reading counts as its whole value. Enter the
  real first value with care, or set it to the dial at installation.
- [x] **Progress speed.** Done on 2026-10-06. Progress now loads its data in a
  fixed number of queries (a test guards this). It was one set of queries per
  dwelling.

## Manual payments (2026-10-28)

See [ADR 0014](decisions/0014-payment-to-dwelling-account-cash-and-row-edit.md).

- [x] **Payment to a dwelling account, cash, edit of an unmatched row.** Done.
- [ ] **Resident payment history.** It starts from allocations, so a payment
  posted to a dwelling account does not show there. The dwelling account page
  does. The owner has not decided whether a resident should see advance or cash
  payments.
- [ ] **Move a dwelling payment.** A payment posted to the wrong dwelling is
  reversed and typed in again. There is no "move" action.
- [ ] **Reversal refusal is strict.** Any later invoice that applied credit
  blocks the reversal of a dwelling payment, even if other credit covers it. Fix
  the balance with an adjustment.
- [ ] **Booking date has no lower bound.** Only a future date is refused.
- [ ] **Unmatched rows that are not rent.** There is no "ignore" for a statement
  row that is not a resident payment. It stays in Unmatched.
- [ ] **Bank row duplicates.** Editing an imported row changes the values that
  the repeat check compares. The original values are in `raw_data` and the audit
  history.

## Migration Center (2026-10-07)

See [ADR 0013](decisions/0013-migration-center.md).

- [x] **Dwellings, recipients and delivery import (phase 1).** Done. Column
  mapping, Latvian Excel files (Windows-1257, `;`, comma decimals), saved
  mappings, issue list download, one transaction, audit trail with before
  values.
- [x] **Opening debt and credit (phase 2).** Done. One audited ledger entry
  per dwelling, a reconciliation report, and migrated debt that is not late-fee
  principal until paid. The owner must still confirm that payments settle
  migrated debt first (ADR 0013, item 18).
- [ ] **Opening balance currency column.** There is none. Amounts are in the
  organization currency, and a cell with a different currency sign or code is an
  error. A file with mixed currencies must be split by currency.
- [ ] **Opening balances change late fees.** A late fee on an invoice with
  unpaid migrated debt is lower than before, because the principal excludes that
  debt. Tell managers before they import.
- [ ] **Balance date before the first invoice.** If no billing period exists
  yet, the date cannot be checked. An invoice issued before the balance date
  does not show the balance (the review warns about this).
- [ ] **A draft invoice keeps its old balance** until it is prepared.
  Preparing recalculates it.
- [x] **Meters and latest readings (phase 3).** Done. Missing meters are
  created, and the latest reading of each meter becomes its starting reading.
- [ ] **Reading history.** Only the latest reading of a meter is kept. Older
  readings in the file are skipped. The reading date is checked but not stored.
- [ ] **A meter added by hand during an import** is used by the import, but a
  meter added right after it can still repeat the same serial number. There is
  no uniqueness rule for serial numbers.
- [ ] **Pasted cells with three-decimal readings** ("123,456" copied from
  Excel) stay ambiguous: the paste has no delimiter to tell a decimal comma from
  a thousands comma. Save the sheet as CSV instead.
- [ ] **AI column suggestions (phase 4).** Not built. Needs the subprocessor
  list, a privacy page change (separate repo) and an offline evaluation first.
- [ ] **XLSX (phase 5).** Not built. Save the sheet as CSV for now.
- [ ] **Large updates.** Update mode groups rows with the same patch into one
  statement. A file where every row changes different fields still costs one
  statement per row (2,000 rows is the cap).
- [ ] **Case sync loads organization-wide readiness data.** The batch loader
  behind `syncCasesForDwellings` reads every meter and reading of the
  organization, not only the imported dwellings. This is fine at the current
  size. Limit the queries to the given dwelling ids when an organization has
  tens of thousands of meters.
- [ ] **Short Cyrillic files.** A file with very few Cyrillic letters in
  Windows-1251 can be read as Windows-1252. The page shows the file name and
  the encoding, and the upload form has an encoding picker.
- [ ] **File names are stored.** The import history keeps the file name. A name
  can contain a person's name. Cell values are never stored.

## Admin dashboard (2026-10-28)

See [DASHBOARD_GUIDELINES.md](product/DASHBOARD_GUIDELINES.md) for the evidence
and the backlog status, and [ADR 0015](decisions/0015-dashboard-redesign.md) for
the decisions. The redesign was built on 2026-10-28. These were fixed then:
the money block (it reconciles on "Total to pay"), the next step and the
four-step progress (also after a lock), the amount and due date on overdue rows,
the unmatched-payment and delivery-failure counts, the deadlines line, the
READY and OVERDUE colours, 16 px text and 44 px controls, the database error
state, and the dead CSS.

- [x] **Stale guide screenshot.** Refreshed all nine guide screenshots from the
  current local demo on 2026-11-12 and added the invoice-template screenshot.
- [ ] **Guide step wording.** The guide step about the dashboard still describes
  the old page. Reword it for the next-step band, the money block and the
  attention list.
- [x] **Overdue rows link to plain Payments.** Fixed: the row links to
  `/payments?q=<dwelling number>`.
- [x] **Phone: primary button below the fold (2026-11-11).** Fixed: where the
  money card is one column, the breakdown starts closed behind "Invoice
  breakdown", and the button sits at 722-766 px at 390 x 812. The breakdown is
  one tap away on phones. A script closes it after load, so there is a brief
  open state before it collapses.
- [ ] **Status chip covers content.** The fixed `MutationStatus` chip overlaps
  the right edge of the dashboard panels. At 1024 px in Russian it covered the
  overdue group count (seen 2026-11-11).
- [ ] **Unused after the 2026-11-11 pass.** `installDismissableDetails`
  (`src/lib/ui/dismissable-details.ts`) has no `details[data-dismiss]` left to
  serve, and the strings "Invoice breakdown", "of total to pay", "Earlier month"
  and "Next" are no longer used by the dashboard.
- [ ] **Workbench (2026-11-11).** The second pass is described in
  [CURRENT_MONTH_REDESIGN.md](product/CURRENT_MONTH_REDESIGN.md). Still open: the
  status badge is 16 px in the table; the stage tabs take four rows on a phone;
  `ui.spec.ts` "admin routes" fails at login because the demo admin lands on the
  organization list, so its workbench checks do not run.
- [ ] **Validation messages in English.** Zod's built-in messages reach the
  screen in English. "Invalid email address" is translated since 2026-11-12;
  others (wrong type, too small, too long) are not. The dwelling page caps
  lengths with `maxlength`, so there they cannot occur.
- [ ] **Adjustments have no idempotency key from the client.** Each
  `createDwellingAccountAdjustment` call makes a new random ledger key, so the
  server cannot recognise a repeat. The dwelling page offers no Retry for an
  adjustment; a proper fix is a client mutation id on the action.
- [ ] **Latvian wording.** No native review of the new strings.
- [ ] **Drawer previous reading.** The readings drawer (opened from a dashboard
  row) shows "Iepriekšējais rādījums: —" for a dwelling that does have an earlier
  reading. `listMetersWithReadingForPeriod` in `src/domain/periods/cases.ts` uses
  only the stored previous value of the current period's reading. Entering a
  value lower than the earlier reading returns 409 with no hint. Fix: look up the
  last reading before the period and show it.
- [ ] **Drawer save feedback.** Saving in the drawer gives no `MutationStatus`
  chip feedback beyond the idle state.
- [ ] **Compact layout CSS not verified in a browser.** The last fixes of the
  compact layout were not run: money panel icon and baseline, 1024 title
  truncation, the Russian 2 by 2 progress strip, and chip clearance at 1024.
  Codex has not reviewed the final layout (usage limit until 23:26 on
  2026-10-28). The v5 live review (lv and ru, four widths) found no text
  collisions before these fixes.
- [ ] **Less-dense final pass not browser-verified (2026-10-30).** The last small
  pass after the v7 live review was not run in a browser: the action column
  `nowrap` at 1280, the 375 "Tagad/Сейчас" overlap fix, the shortened period
  navigation on mobile (375 height 46 px), the "+N vēl" cue and the one-line
  reason clamp. Also re-measure the 375 Russian progress strip and the section 10
  table of `DASHBOARD_GUIDELINES.md` (the 1280 row has no v7 numbers). The new
  strings ("līdz", "Tagad", the group titles) have no native Latvian review, and
  the less-dense layout has not been user-tested.
- [ ] **Not built.** Supplier-cost comparison, water-difference alert,
  status badge (14 px) and eyebrow (12 px) sizes, and `getCurrentOpenPeriod`
  can still return the starting-readings period (the dashboard skips it itself).

## Checked and not gaps

- Test data in the demo database (`00-E2E-…`, "Zero price repro test", payers
  shown as IDs) comes from test runs. Run `npm run demo:reset`.
- Meter readings are entered in the period workbench by design. The dashboard
  also opens the same readings drawer from a `MISSING_DATA` row.
- Admins can be removed on Settings > Users. The button is hidden for the
  signed-in admin.
- The organizations page has no sidebar because no organization is selected.
