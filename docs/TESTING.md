# Testing environment setup

This guide explains how to configure your machine to test Property Billing. It
covers three test tiers (unit, integration, end-to-end), the quality gates,
manual testing, and edge cases to check by hand.

Complete [Local setup](../README.md#local-setup) in the main README first.
The integration and end-to-end suites use the same local Supabase stack.

## Prerequisites

Confirm you have these before you continue.

- Node.js 22.12 or later.
- Docker. The local Supabase stack runs in Docker containers.
- The Supabase CLI. Run `npx supabase --version` to check.
- A running local Supabase stack. Run `npx supabase start` if it is not
  running yet.

## Environment variables for tests

The integration test suite reads three variables directly from your shell.
It does not read `.dev.vars`.

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_SECRET_KEY="<the service role key from `npx supabase start`>"
```

On Windows PowerShell, use `$env:DATABASE_URL = "..."` instead of `export`.

## Unit tests

Unit tests need no extra setup.

```bash
npm run test
```

The unit test suite covers core mathematical and domain rules, including:
- **Statement balance resolution** (`tests/unit/account-balance.test.ts`): Verifies `calculateStatementBalance`, ensuring outstanding debt is carried forward, available account credits offset new charges, amount due is floored at zero, and late fees / manual adjustments are incorporated.
- **Late-fee calculation** (`tests/unit/account-balance.test.ts`): Verifies `calculateLateFee`, verifying grace period evaluation, daily rate accrual, percentage caps, and zero fee behavior for settled accounts.
- **Invoice line item calculation** (`tests/unit/billing-calculation.test.ts`): Verifies decimal precision, VAT rates, and meter consumption formulas.
- **Invoice template schema & snapshot validation** (`tests/unit/invoice-template-schema.test.ts`): Verifies `createDefaultInvoiceTemplateConfig`, the mandatory-block repair pipeline (dedupe, force-visible, insert-missing, revalidate, fall back to default only if repair itself fails), rejection of duplicate block IDs, strict write-path rejection of legacy V1-shaped payloads, and versioned snapshot construction via `buildInvoiceTemplateSnapshot`.
- **Deterministic invoice rendering & XSS defense** (`tests/unit/invoice-html.test.ts`): Verifies `renderInvoiceHtml`, validating section block reordering, mandatory blocks always rendering regardless of a stored config's visibility flag, optional block hiding, custom text blocks with multiline `<br />` conversion and EN/RU translation fallback, bold emphasis and text alignment, charges table row overrides (`bold`, `spacingBefore` -- no `visible`, so a financially charged row can never disappear even from an obsolete V1-shaped stored config), locale-aware label/tariff/template-text rendering across `lv`/`en`/`ru` with identical financial figures in every locale, inline SEPA QR embedding and graceful omission for non-EUR/zero-due/missing-BIC/malformed-IBAN cases, and strict XSS defense (preventing attribute breakout from custom align strings).
- **Invoice/tariff localization** (`tests/unit/invoice-i18n.test.ts`): Verifies the versioned system-label dictionary (`translateInvoiceLabel`, including fallback for an unrecognized `labelSetVersion`), `pickLocalizedText`'s blank/missing-translation fallback to Latvian, and `parseInvoiceLocale`'s lenient query-param parsing.
- **Invoice template preview sync** (`tests/unit/invoice-template-preview.test.ts`): Verifies the editor's live-preview line/total builder reuses the same `decimal2.ts` arithmetic primitives `generateInvoice()` itself calls (never a duplicated formula), and `resolvePreviewPeriod`'s period-selection precedence.
- **SEPA QR** (`tests/unit/sepa-qr.test.ts`, `tests/unit/sepa-qr-generator-failure.test.ts`): Verifies the EPC069-12 payload builder (field order/count, LF separators, no trailing separator, IBAN mod-97 + structural validation against a known-country registry, BIC 8/11-char format, amount range and boundary values, 70-char beneficiary name and 140-char remittance limits with rejection rather than truncation, 331-byte UTF-8 payload limit, control-character rejection, `Rēķins {invoiceNumber}` remittance construction), correct UTF-8 byte encoding of the generated QR (not the QR library's lossy default), deterministic payload/SVG generation, and that the renderer wrapper never throws -- including when the QR library itself throws internally (simulated via a mocked module).
- **On-demand invoice PDF copies** (`tests/unit/invoice-pdf-response.test.ts`): Verifies the canonical-PDF 404 "not generated yet" branch, the shared "not ready" response used to gate translated copies, and the EN/RU copy response's locale-suffixed filename, content type, and header passthrough.

## Integration tests

Integration tests call the same domain functions the Astro Actions call.
They run against a real local Postgres, Supabase Storage, and Mailpit.

1. Set the three environment variables above.
2. Confirm the local Supabase stack is running.
3. Run the database migrations, if you have not run them yet.

   ```bash
   npm run db:migrate
   ```

4. Run the suite.

   ```bash
   npm run test:integration
   ```

### Financial reconciliation & payment coverage in integration tests

The integration test suite (`tests/integration/payments.test.ts`) verifies:
- **Bank CSV statement import**: Duplicate import hash prevention, invalid header handling, and transaction row ingestion.
- **Exact payment matching**: Candidate matching against invoice payment reference, match proposal confirmation, transaction and invoice status updates.
- **Idempotency and concurrency**: Repeated match confirmation idempotency, rejection handling, and double-claim prevention across concurrent match attempts.

*Recommended test additions for complete financial coverage:*
While implemented in the domain services and database schema, the following financial workflows should be added to the integration suite to ensure ongoing regression safety:
- **Partial payment reconciliation**: Matching a transaction where `amount < remainingBalance`, verifying that the transaction is fully credited to the dwelling ledger, an allocation is posted for the partial amount, the invoice remains open (`paidAt` is null), and a second payment can subsequently match against the remaining balance to mark the invoice `PAID`.
- **Overpayment reconciliation**: Matching a transaction where `amount > remainingBalance`, verifying that the invoice is marked `PAID`, allocation is capped at remaining balance, and the excess amount is held as unallocated dwelling account credit (`NEGATIVE` account balance).
- **Credit carry-forward cycle**: Verifying that unallocated dwelling credit from an overpayment is automatically consumed in `prepareInvoice` for the next billing period to reduce the new invoice's `amountDue`.
- **Append-only ledger triggers**: Verifying that executing an `UPDATE` or `DELETE` query against `account_entries`, `payment_allocations`, or `late_fee_adjustments` fails with a PostgreSQL trigger exception.

### Invoice template & snapshot coverage in integration tests

The integration test suite (`tests/integration/billing.test.ts`) verifies:
- **Template snapshot immutability across updates**: Verifies that updating an organization's invoice template (`updateInvoiceTemplate`) after an invoice has been generated does not alter the rendered HTML (`renderInvoiceHtml`) of the existing invoice (`htmlAfter === htmlBefore`), preserving historical document integrity.
- **Tariff/template synchronization**: Verifies that the template editor's preview (via `buildPreviewLines(getEffectiveRules(...))`) excludes disabled, archived, and foreign-organization billing rules through the real `getEffectiveRules()` boundary -- not a mocked/bypassed version of it.
- **Tariff label translation immutability**: Generates an invoice, renames a billing rule's `nameEn`/`nameRu` via `updateRule`, re-fetches the invoice from the database, and confirms its LV/EN/RU rendered output still shows the original labels -- because the full rule row was already snapshotted onto the invoice line at generation time.
- **Template text translation immutability**: Generates an invoice with a translated header, then changes the organization's current template translation via `updateInvoiceTemplate`, re-fetches the invoice, and confirms its frozen `headerText.en` (and rendered output) is unaffected.

These, like the rest of `tests/integration/`, require the real local Postgres/Supabase Storage stack described under "Integration tests" above -- they cannot run in an environment without one.

*Recommended test additions for complete template coverage:*
While supported by domain services, the following tests should be added to extend coverage:
- **Maximum block count rejection**: Verifying that attempting to save a template with >30 blocks via `actions.invoiceTemplates.update` returns a validation error.
- **Cross-tenant authorization check**: Verifying that an admin cannot update another organization's template.
- **Reset to default template execution**: Verifying that resetting layout properly clears custom blocks and row overrides in database storage.

## End-to-end tests

The end-to-end suite uses Playwright. Playwright builds the app and starts a
local Cloudflare Worker for you, so you do not need to run `npm run dev`
first.

1. Install the Playwright browsers. Do this once per machine.

   ```bash
   npx playwright install
   ```

2. Confirm `.dev.vars` exists and has valid values. See
   [Local setup](../README.md#local-setup) step 4.
3. Run the suite.

   ```bash
   npm run test:e2e
   ```

If every page hangs or fails to load during a test run, see
[Known Limitations: Local development quirks](KNOWN_LIMITATIONS.md#local-development-quirks).
Comment out the Browser Rendering binding in `wrangler.jsonc`, then restore
it before you commit or deploy.

## Quality gates

Run these checks before you open a pull request.

```bash
npm run format:check       # check code formatting with Prettier
npm run lint               # run ESLint
npm run typecheck          # run the TypeScript strict compiler check
npm run astro:check        # run the Astro diagnostic check
npm run test                # run unit tests
npm run test:integration    # run integration tests (needs the local stack)
npm run build                # verify the production build
```

## Manual testing

### Test the API directly

Most business logic (create a dwelling, generate an invoice, send an
invoice, import a bank statement, and so on) runs through Astro Actions. A
browser form posts to these, not a plain JSON endpoint. The integration test
suite above is the most direct way to exercise this logic outside a
browser.

A small number of routes are plain HTTP endpoints. Call these directly with
`curl` or a tool such as Postman.

- `POST /api/v1/auth/request-link` — public. Sends a resident sign-in link.
  Limited to 5 requests per email per 60 seconds.
- `GET /api/v1/admin/o/:orgId/dwellings/export` — admin only. Downloads a
  CSV of an organization's dwellings. Needs an admin session cookie.
- `GET /api/v1/admin/o/:orgId/invoices/:invoiceId/pdf` — admin only.
  Downloads an invoice PDF.
- `GET /api/v1/portal/invoices/:invoiceId/pdf?dwellingId=...` — resident
  only. Downloads an invoice PDF for the resident's own dwelling.
- `GET /invoice/access/:token` — public. Shows one invoice, using the token
  an invoice email links to. No session is needed.
- `GET /invoice/access/:token/pdf` — public. Downloads the same invoice's
  PDF. Limited to 30 requests per IP per 60 seconds.

To call an admin or resident endpoint with `curl`, sign in through the
browser first. Then copy the session cookie from your browser's developer
tools into the request.

### Test the UI by hand

Start a local server, then walk through the flows in
[Logging in](../README.md#logging-in) in the main README. There are two
ways to start a server.

```bash
npm run dev
```

This starts the Astro dev server at
[http://localhost:4321](http://localhost:4321) with fast reloads. Use this
for most day-to-day UI work.

```bash
npm run build && npx wrangler dev --port 4321
```

This builds the app and serves it through a local Cloudflare Worker, the
same runtime production uses. Use this to test anything that submits a
form, such as an Astro Action. Some environments do not run these forms
correctly under the plain dev server. If a form submit hangs or never
completes under `npm run dev`, rebuild and test again with `wrangler dev`
before you assume there is a bug.

Either way, then check the main areas.

- `/admin` and `/admin/organizations` — pick an organization, then manage
  its dwellings, billing periods, rules, and settings under
  `/admin/o/:orgId/...`.
- `/portal` and `/portal/dwellings` — a resident's own dwellings and
  invoices.

If every page fails to load or hangs with no response, see
[Edge cases to test](#edge-cases-to-test) below.

## Edge cases to test

- **Cross-tenant access.** Sign in as `admin.a@example.com`. Try to open an
  organization, dwelling, or invoice ID that belongs to the second seeded
  organization. The app must deny this, and it must not reveal whether the
  ID exists.
- **Cross-resident access.** Sign in as one resident. Try to open another
  resident's dwelling or invoice by guessing its ID. The app returns a
  plain not-found result, not a message that hints the ID is valid.
- **Missing meter readings.** A billing period can have a dwelling with no
  reading for that period. Its billing case shows `MISSING_DATA`, and the
  app blocks invoice generation for it until the reading exists.
- **Partial payment reconciliation.** Import a bank statement with a transaction
  amount less than an invoice's `amount_due`. Confirm the proposed match.
  Verify that an allocation is posted for the partial amount, the dwelling
  ledger is credited for the payment, and the invoice remains open (`paid_at`
  is null) with remaining balance due. Match a second transaction for the
  remainder and verify the invoice transitions to `PAID`.
- **Overpayment and credit carry-forward.** Import a transaction exceeding
  an invoice's remaining balance. Confirm the match. Verify that the invoice
  is marked `PAID`, the allocation is capped at the unpaid balance, and the
  excess creates dwelling account credit (`accountBalance < 0`). In the
  subsequent billing period, generate an invoice and verify that the credit
  is automatically applied to reduce the new `amount_due`.
- **Financial history immutability.** Attempt to execute an SQL `UPDATE` or
  `DELETE` on `account_entries`, `payment_allocations`, or
  `late_fee_adjustments`. Verify that the database trigger
  `prevent_financial_history_mutation` blocks the operation.
- **Late-fee adjustment.** On a prepared invoice with an accrued late fee,
  record an administrative adjustment before delivery. Verify the invoice
  snapshot reflects the adjustment and a corresponding record is created in
  `late_fee_adjustments`.
- **Invoice template customization and snapshot immutability.** Update the
  organization's invoice template under `/admin/o/:orgId/settings/invoice-template`
  (reorder section blocks, toggle visibility on the optional Default note/Footer
  sections, add custom text, configure row formatting). Confirm the four
  mandatory sections (Invoice details, Sender and recipient, Charges table,
  Payment details) have no Show/Hide control and cannot be removed. Generate an
  invoice and verify that the new structure renders on the invoice view,
  resident portal, and PDF. Then modify the organization's template again (e.g.
  delete the custom text or change section order). Re-open the previously
  generated invoice and verify that its rendered HTML and content remain
  completely unchanged, proving snapshot immutability.
- **Tariff sync and invoice language copies.** Create a new active billing
  rule with an English and Russian label, then open the invoice template
  editor: confirm the new tariff appears in the live preview automatically
  (no separate activation step), and switch the editor's document-language
  selector to English/Russian to confirm the tariff's translated label shows,
  falling back to the Latvian name for any tariff without a translation.
  Generate and send an invoice, then view it from the admin invoice detail
  page, the resident portal, and a public invoice link, switching each one's
  document-language selector between Latvian/English/Russian. Verify the
  amount, invoice number, and status never change across languages, that
  Latvian is the default, and that the payment block shows a scannable SEPA
  QR code next to the bank/IBAN/BIC text (for a EUR invoice with a valid IBAN
  and BIC on file) whose remittance reference always reads `Rēķins
  {invoiceNumber}` regardless of the selected document language. Confirm
  downloading the English/Russian PDF works and never changes the invoice's
  canonical (Latvian) stored PDF hash.
- **Double-clicking Send.** Sending an invoice is safe to repeat. Two
  clicks, or two people clicking at the same time, produce exactly one
  email and one delivery record, not two.
- **Invoice link expiry and revocation.** A token-based invoice link
  (`/invoice/access/:token`) stops working 90 days after it was sent. An
  admin can also revoke it early from the invoice detail page. Either way,
  the link then returns a generic not-found page, never a reason.
- **Rate limits.** The resident sign-in link endpoint allows 5 requests per
  email per 60 seconds. The public invoice-link endpoints allow 30
  requests per IP per 60 seconds. Repeated manual testing can trip a 429
  (too many requests) response. Wait 60 seconds and try again.
- **Local dev server hangs on every request.** See
  [Known Limitations: Local development quirks](KNOWN_LIMITATIONS.md#local-development-quirks)
  for the cause and the workaround.
