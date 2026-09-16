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

## Deferred features and refactors

### Resolved: Manual quantity and amount billing rules now supported

Earlier specification drafts deferred `MANUAL_QUANTITY` and `MANUAL_AMOUNT` billing rules. These were subsequently implemented in migration `0005` via the `manual_rule_inputs` table, allowing admins to record per-dwelling, per-period quantity or amount values that are verified during case readiness and applied during invoice generation.

### Retry-safety gap in sendInvoice idempotency protocol

The `sendInvoice` function claims a send by flipping the invoice's `sentAt` column away from null, attempts delivery, and reverts `sentAt` to null if delivery fails. If the email provider accepts the email but the response times out, the claim is reverted and a subsequent manual retry or automated daily run can send a duplicate email. Conversely, if the Worker process dies after claiming the send but before the provider call completes, `sentAt` remains set and future automated bulk-sends silently skip the invoice forever. This is a pre-existing design limitation that requires either email provider idempotency keys or a background delivery reconciliation job, neither of which has been built.

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
