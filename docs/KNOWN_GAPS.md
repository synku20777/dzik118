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
  away. The app blocks a duplicate.
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

## Checked and not gaps

- Test data in the demo database (`00-E2E-…`, "Zero price repro test", payers
  shown as IDs) comes from test runs. Run `npm run demo:reset`.
- Meter readings are entered in the period workbench by design.
- Admins can be removed on Settings > Users. The button is hidden for the
  signed-in admin.
- The organizations page has no sidebar because no organization is selected.
