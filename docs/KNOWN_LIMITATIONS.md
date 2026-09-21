# Known Limitations

This document lists items across the project that are incomplete, deferred, or intentional design trade-offs, as opposed to bugs. Future contributors and operators should use this reference to understand existing system boundaries, local development quirks, and operational gotchas.

## Local development quirks

### Browser Rendering binding hangs local wrangler dev

Merely declaring the Cloudflare Browser Rendering binding in `wrangler.jsonc` makes every request to `wrangler dev` hang indefinitely in this local sandbox, not just requests that call `renderPdf`. As documented in `wrangler.jsonc` and `src/lib/pdf/render.ts`, the browser process launches, but the DevTools connection times out in this specific environment. To work around this, comment out the `browser` block in `wrangler.jsonc` before running `wrangler dev` or the Playwright e2e suite locally, then restore it before committing or deploying. Real Cloudflare deployments are unaffected, as this is a local-sandbox-only limitation.

### Local Cron Trigger routes skip scheduled handler

Neither `wrangler dev --test-scheduled`'s `/__scheduled` route nor the `/cdn-cgi/local/scheduled` route invokes the real `scheduled` handler for this project. This was diagnosed empirically (both routes silently no-op) and by reading Wrangler's own bundler source; the working theory is that the Astro Cloudflare adapter's `no_bundle: true` setting skips the middleware-injection step Wrangler needs to wire either route to a real handler, though no single file in this repo states that explanation outright. To verify the scheduler locally, call `POST /api/v1/internal/scheduled-jobs` directly with the correct `INTERNAL_CRON_SECRET`. Real Cloudflare Cron Triggers work correctly in production, so this is a local Wrangler tooling limitation only.

## Financial accounting boundaries

### Single-invoice allocation per transaction (no arbitrary multi-invoice splits)

Candidate payment matching matches an incoming bank transaction to a single candidate invoice, allocating up to `min(transaction.amount, invoice.amountDue - allocated)`. Arbitrary manual multi-invoice split allocations (e.g., splitting one payment across three older invoices) are not supported. If a resident's payment exceeds the target invoice's remaining balance, the transaction is fully credited to the dwelling's ledger, the invoice is marked `PAID`, and the surplus becomes an unallocated dwelling account credit (`NEGATIVE` ledger balance). This credit is automatically carried forward and applied to reduce the next generated invoice statement.

### Simple daily late-fee model (no compounding or statutory penalty schedules)

The late-fee calculation engine (`src/domain/accounts/late-fees.ts`) applies a configurable daily percentage rate (`daily_rate_percent`), grace period (`grace_days`), and maximum cap (`max_fee_percent`) calculated as simple interest against the overdue balance. It does not implement compounding interest, variable national reference rate tables, or tiered statutory interest schedules (such as Polish statutory delay interest, *odsetki ustawowe za opóźnienie*).

### Append-only auditability requiring compensating adjustments (no direct financial mutations)

The financial history (`account_entries`, `payment_allocations`, and `late_fee_adjustments`) is strictly immutable and protected by PostgreSQL database triggers (`prevent_financial_history_mutation`). There are no direct delete, edit, or void operations on posted financial records. Correcting billing errors, settling disputes, or waiving fees requires posting compensating entries: either a manual adjustment (`CHARGE` or `CREDIT`) via `accounts.createAdjustment` or a manual late-fee adjustment via `invoices.adjustLateFee` prior to invoice delivery.

### Single-entity dwelling ledger (no double-entry ERP or tax export)

Dwelling accounts track net debits and credits per dwelling for property management operations. The platform does not implement double-entry chart-of-accounts bookkeeping (assets, liabilities, equity) or native export integration with external Polish enterprise accounting software (e.g., Comarch Optima, Symfonia, JPK_V7).

## Invoice template boundaries

### Structured template composer (no arbitrary HTML, CSS, or freeform canvas)

The invoice template editor (`/admin/o/[orgId]/settings/invoice-template`) is a structured document composer rather than an unrestricted WYSIWYG or canvas page builder:
- **Constrained section model**: Only the 6 predefined block types (`meta`, `parties`, `line-items`, `payment` -- mandatory; `default-note`, `footer` -- optional) and custom `text` blocks are supported. Freeform canvas placement, arbitrary pixel coordinates, multi-column dragging, and custom widget components are not supported.
- **Maximum block count**: The server schema (`invoiceTemplateConfigV2Schema`) and client editor enforce a strict cap of 30 blocks per template to prevent document bloat and browser rendering issues.
- **Formatting scope**: Bold weight and text alignment (`left`, `center`, `right`) are configurable on custom text blocks; charges table row overrides support bold weight and spacing only (no visibility override -- see below). Built-in text fields (header, footer, payment instructions, default note) render plain escaped text with preserved newlines, with optional EN/RU translations. Custom font families, font sizes, colors, and arbitrary CSS classes are not configurable.
- **Mandatory sections cannot be hidden**: `meta`, `parties`, `line-items`, and `payment` always render and have no visibility toggle, in the editor UI or the schema. Only `default-note` and `footer` are genuinely optional (may be entirely absent, not just hidden).
- **No row-hiding**: A charges-table row that contributes to the invoice total cannot be hidden by template configuration -- the `visible` row-override field that existed in the V1 schema was removed entirely (not merely deprecated), so this is enforced by the type system and the renderer, not just a UI restriction.
- **No arbitrary row reordering**: Reordering applies to document section blocks. Individual fee rows inside the charges table are generated in deterministic billing rule sort order; dragging or reordering individual charge rows is not supported.
- **Security & XSS protection**: Administrators cannot inject raw HTML, inline CSS attributes, `<style>` tags, or JavaScript. All user-entered text (including every EN/RU translation) is passed through `escapeHtml()` during HTML and PDF rendering.

### SEPA QR: BIC required, not the full EEA domestic-transfer exemption

The EPC069-12 standard allows omitting the BIC for domestic transfers within certain EEA corridors. This app instead requires an organization to have a BIC on file at all before it will generate a QR code for that organization's invoices; if the BIC field is empty, the QR is silently omitted (the human-readable bank name/IBAN text still renders normally). This is a deliberate simplification of the EEA-domestic-optional-BIC determination logic, not a bug -- implementing the full country/corridor determination was judged unnecessary complexity for this app's actual usage.

### SEPA QR: IBAN country registry is not exhaustive

`src/domain/billing/sepa-qr.ts`'s per-country IBAN length table covers SEPA/EEA countries and the European microstates that also issue IBANs -- the set an organization using this app could realistically hold a bank account in. An IBAN from a country outside that list is rejected outright (not skip-checked), so the QR is omitted, again with the human-readable IBAN text still rendering normally.

### EN/RU PDF copies are generated on demand, not cached

Downloading an invoice as an English or Russian PDF re-renders and re-generates the PDF via Cloudflare Browser Rendering on every request; unlike the canonical Latvian PDF, it is never uploaded to storage or reused across requests. This keeps the data model simple (exactly one persisted PDF artifact per invoice) at the cost of a fresh render on every translated-copy download. If this becomes a meaningful cost or latency concern in practice, a per-locale cache could be added later without changing the canonical-PDF guarantee.

## Deferred features and refactors

### Resolved: Manual quantity and amount billing rules now supported

Earlier specification drafts deferred `MANUAL_QUANTITY` and `MANUAL_AMOUNT` billing rules. These were subsequently implemented in migration `0005` via the `manual_rule_inputs` table, allowing admins to record per-dwelling, per-period quantity or amount values that are verified during case readiness and applied during invoice generation.

### Resolved: sendInvoice retry-safety gap, with a remaining unavoidable provider-ambiguity boundary

`sendInvoice` previously used the invoice's own `sentAt` column as both the concurrency claim lock and the durable "delivered" fact, which created two failure windows: a lost provider response after acceptance could cause a duplicate email on retry, and a Worker crash after claiming could permanently strand an invoice as unsendable. This was fixed by introducing a durable `invoice_send_attempts` table (migration `0008`) as the sole concurrency claim, gated by a partial unique index so at most one non-terminal attempt can exist per invoice at a time; `sentAt` now means only "confirmed successful delivery," never "a Worker currently owns this."

The email provider adapters (`src/lib/email/ses.ts`, `src/lib/email/smtp.ts`) now classify every failure as either `DEFINITIVE` (the provider explicitly rejected the request, or a local validation failed before any network call was attempted -- safe to retry) or `AMBIGUOUS` (a network-level exception occurred with no way to prove whether the provider processed the request first -- for SES, any exception thrown by `fetch()` itself; for SMTP, any failure at or after the DATA payload is transmitted). An `AMBIGUOUS` outcome moves the attempt to a durable `UNKNOWN` state, which is never auto-retried by the admin UI or the scheduler -- a subsequent `sendInvoice` call throws a clear "needs attention" error instead of silently resending, and `bulkSendInvoices`/the scheduler correctly skip it with that same safe reason. An administrator can still explicitly resend once they've verified the actual outcome (checking the mailbox, or Mailpit/SES logs), since `resendInvoice`'s gate was widened to permit this for an invoice whose only attempt is `UNKNOWN`.

**Remaining boundary, not fixable by this application alone:** AWS SES's `SendEmail` v2 API has no client-supplied idempotency token and no practical way to look up "did I already send this" after a lost response, without building SNS/webhook-based reconciliation infrastructure (deliberately out of scope -- see the "Out of scope" notes in the relevant implementation). This means a genuinely ambiguous provider outcome can never be resolved to an exact-once guarantee automatically; it is held as `UNKNOWN` and surfaced for manual admin judgment (visible in the invoice's delivery history), which is the safest correct behavior given the provider's actual capabilities, not a workaround for an application bug.

### Operator action required: old auto-PAPER-success data may show a contradictory delivery history

Before migration `0009`, `sendInvoice`/`deliver` treated a dwelling's `invoiceByPaper` preference being enabled as automatic delivery success -- it populated `invoices.sent_at`, transitioned the billing case to `SENT`, and inserted a PAPER delivery row, with zero administrator action. Migration `0009` correctly stopped treating those old rows as verified (`is_initial_paper_dispatch` defaults to `false` for all historical data, and the admin UI renders them as "Paper (unverified legacy record)," never "Paper dispatched"), but it cannot retroactively fix the OLD business facts those rows already caused: `invoices.sent_at` and the billing case's `SENT` status.

This means a real, pre-existing invoice can now legitimately display:

- Invoice status: **SENT**
- Delivery history: **Paper (unverified legacy record)**
- No delivery marked as verified

This is not a new bug -- it is the old bug's already-committed business fact, now correctly labeled as unverified rather than hidden behind a falsely-confident "Paper dispatched" label. It cannot be auto-corrected by any migration: the application has no way to know whether an administrator genuinely printed and physically posted/handed over that specific invoice at the time. If this matters for a given deployment, it requires a manual operator review -- for example, cross-referencing old PAPER-flagged invoices against physical mailing records or resident correspondence -- and, where warranted, an administrator can use the current "Record paper dispatch" action to add a new, genuinely verified record for that invoice (it does not touch or require clearing the old `sent_at`).

### Accepted: a Worker crash between a delivery outcome and its audit event is not retroactively reconstructed

`markAttemptTerminalWithAudit` makes the attempt-status transition and its audit event atomic *once execution reaches that helper*. It does not cover every earlier step: `deliver()` inserts the `invoice_deliveries` row (the SENT/FAILED/UNKNOWN outcome) *before* the caller reaches the point where it records the attempt status and audit event together. If the Worker crashes in that specific window -- after the delivery row is written, before the attempt-status+audit write -- a later stale-attempt reconciliation (`reconcileAttemptForInvoice`) correctly restores the *attempt status and invoice/case state* from the delivery row's evidence (this is the crash-safety property this pass added), but it does not reconstruct the *audit event* that would normally have accompanied that specific attempt's outcome (`INVOICE_SEND_FAILED`, `INVOICE_RESEND_FAILED`) in every case -- only the SENT-evidence reconciliation path (`reconcileAttemptForInvoice`'s `FINALIZED` branch) records a corresponding `INVOICE_SENT`/`INVOICE_RESENT` event; the FAILED-evidence reconciliation path (which returns `RETRY_CLAIM` so the caller claims a fresh attempt) does not emit an audit event for the stale attempt's own FAILED transition.

This is a genuine, disclosed gap in audit completeness under this specific crash window, not a delivery-safety or duplicate-send risk: the delivery outcome itself (what actually happened, and whether a retry is safe) is always correctly recovered from the immutable `invoice_deliveries` row regardless of whether its audit event was ever written. Fully closing it would mean teaching every reconciliation path to reconstruct the audit trail for an attempt it didn't originate (including correctly picking `INVOICE_SEND_FAILED` vs `INVOICE_RESEND_FAILED` for context the reconciler doesn't have), which was judged a larger, separate piece of work from the crash-recovery correctness this pass targeted. If exact audit completeness across every crash window becomes a compliance requirement, this needs a dedicated design pass rather than an incremental patch here.

### Accepted: the first EMAIL send after an earlier PAPER dispatch is audited as `INVOICE_RESENT`

When PAPER is dispatched first (setting `invoices.sent_at`) and an administrator later sends the invoice by EMAIL for the very first time, `sendInvoice`'s finalization sees `sentAt` already set (by PAPER) and records `INVOICE_RESENT` rather than `INVOICE_SENT`, even though this is genuinely the first EMAIL attempt. This is defensible from an overall-invoice perspective (the invoice itself was already "sent," just through a different channel) but is a slightly imprecise audit label for what is channel-wise a first send. Not fixed in this pass: introducing a richer audit vocabulary (e.g. distinguishing `INVOICE_EMAIL_SENT`/`INVOICE_EMAIL_RESENT`/`PAPER_DISPATCH_RECORDED`) is a reasonable longer-term improvement, but changing audit action names has broader ripple effects (audit log display, any downstream consumers) that aren't warranted for this one label's imprecision alone.

### Accepted: an explicit resend after a lost HTTP response can send a genuine duplicate

The Resend action's `commandId` (a fresh value rendered into the form on each page load) deduplicates two submissions of the *same* rendered form -- a double-click or a browser's automatic retry of one POST. It deliberately does not survive a hard page reload: if the provider actually succeeded but the admin's browser never saw the response (a lost connection, a closed tab), reloading the page and clicking Resend again generates a new `commandId` and will send a genuine second email. This is accepted, not a bug: explicit resend is an intentionally repeatable admin action, and the alternative (a durable, reload-surviving idempotency key) is unwarranted complexity for a rare, admin-supervised, low-volume operation. An admin who suspects a lost response should check the invoice's delivery history or the mailbox/provider logs before resending, exactly as the UNKNOWN-outcome guidance already advises.

### Deferred authorization middleware and action wrapper refactors

Two opportunities to reduce duplication were identified but deliberately deferred because of regression risks. Centralizing repeated `requireOrganizationAccess` and `requireDwellingAccess` guards into Astro middleware based on route parameters is technically feasible, but it touches every page's authorization boundary simultaneously. Similarly, creating an `orgAction(schema, handler)` wrapper would collapse roughly 25 near-identical `defineAction` blocks across `src/actions/*.ts` that repeat access checks and database wiring. Both refactors were deferred because modifying every admin mutation and route gate carries meaningful risk for what is fundamentally a style improvement rather than a bug fix.

## Design trade-offs

### Uniform error responses on sensitive token endpoints

Several endpoints intentionally return uniform, non-specific errors to prevent information leakage. The public invoice-access-token flow returns an identical "invalid or expired" response for an unknown token, a revoked token, or an expired token. Similarly, the resident magic-link confirmation flow does not distinguish between a link that never existed, an expired link, or an already used link. Revealing specific failure reasons would inform an attacker whether a given token or link was ever valid, which the application must not leak.

### Content-Security-Policy allows unsafe-inline scripts and styles

The Content-Security-Policy declared in `src/middleware.ts` includes `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'`. The actual inline HTML this accommodates comes from raw HTML strings built directly in `.ts` files, not from `.astro` pages: `src/pages/auth/confirm.ts`'s confirmation page uses inline `style="..."` attributes, and `src/domain/billing/invoice-html.ts`'s emailed/rendered invoice template embeds a `<style>` block, rather than either linking to a shared stylesheet. `'unsafe-inline'` weakens script-injection protection compared to a stricter policy. Astro does support a hash-based CSP mechanism (`security.csp` in `astro.config.ts`) that could tighten this without `'unsafe-inline'`, but adopting it requires updating both of those HTML generators and was deferred, not included in the pass that introduced CSP.

## Deployment gotchas discovered while writing the deployment runbook

### Astro Cloudflare adapter auto-injects unused bindings

The `@astrojs/cloudflare` adapter automatically adds a KV binding named `SESSION` and an Images binding named `IMAGES` to the deployed Worker configuration. Neither binding is declared in `wrangler.jsonc` or used by the application, appearing only in the generated `dist/server/wrangler.json` at build time. Whether a real first deployment needs a manually provisioned KV namespace for this, or whether Wrangler auto-provisions one, could not be confirmed without a real Cloudflare account -- this behavior was discovered by running `wrangler deploy --dry-run` locally, which doesn't validate real resource existence either way. Verify at the first real deploy attempt; the manual fallback command is documented in `docs/deployment/DEPLOYMENT_RUNBOOK.md`.

### Manual bootstrap required for initial admin and organization

There is no self-serve workflow to create the initial admin account or organization. The `organizations.create` action requires an already-authenticated `ADMIN` caller, creating a circular dependency on a fresh deployment with no users. The first organization and admin must be provisioned manually through direct database inserts and the Supabase Auth admin API. These manual steps are detailed in `docs/deployment/DEPLOYMENT_RUNBOOK.md` section 7, mirroring the bootstrap process described in `README.md` step 7.

## Infrastructure

### Hyperdrive query caching must remain disabled

Hyperdrive query caching is disabled in production and must stay disabled. The application requires fresh read-after-write behavior across all domains (dwellings, meters, residents, tariffs, billing configuration/state, balances, period state, and admin settings). When query caching is enabled, client-side revalidation reads immediately following a mutation hit stale cached `SELECT` results, causing the UI to overwrite optimistic updates with stale data and making newly created or updated entities appear to vanish or misbehave.

Connection pooling and connection acceleration via Hyperdrive remain enabled. For verification and configuration commands, see the Hyperdrive section in [docs/deployment/DEPLOYMENT_RUNBOOK.md](deployment/DEPLOYMENT_RUNBOOK.md#hyperdrive). For details on the mutation feedback architecture and distinguishing cache staleness from network lost-response recovery, see [docs/decisions/0005-admin-mutation-feedback.md](decisions/0005-admin-mutation-feedback.md).
