# Production Deployment Runbook

Deployment runbook for deploying this multi-tenant property billing SaaS (Astro SSR `output: "server"` on the `@astrojs/cloudflare` adapter, deployed as a single Cloudflare Worker; Supabase for Postgres/Auth/Storage; AWS SES for production email) to a real Cloudflare + Supabase + AWS account for the first time.

## 1. Prerequisites

- A Cloudflare account able to use Browser Rendering and Cron Triggers -- Workers Paid is recommended for production-scale usage; check Cloudflare's current plan limits, since free-tier allowances for both have been expanding.
- The Cloudflare CLI (`wrangler`) installed and authenticated:

```bash
npx wrangler login
```

- A Supabase project (hosted, not local) with its project URL, publishable key, secret key. Use the JWT-format service role key, not the newer `sb_secret_` format, for anything that touches the Storage Admin API: with the SDK version this project currently pins, `sb_secret_` keys get rejected with a 403 "Invalid Compact JWS" against Storage specifically (confirmed empirically in local dev), even though other Supabase Admin operations accept them fine. Re-test this if the Supabase SDK is ever upgraded -- it may be a version-specific quirk rather than a permanent platform requirement.
- AWS SES access: a verified sending identity/domain, and SES moved out of sandbox mode (sandbox mode can only send to verified recipient addresses, which is unusable for real residents).

## 2. One-time Cloudflare resource setup (before the first deploy)

### Hyperdrive

Create a Hyperdrive config pointing at the production Supabase Postgres connection string:

```bash
wrangler hyperdrive create <name> --connection-string="<supabase-postgres-url>"
```

Copy the returned id into `wrangler.jsonc`'s `hyperdrive[0].id`, replacing the `<production-hyperdrive-id>` placeholder currently there.

**Production Invariant: Query Caching MUST Be Disabled**

Query caching MUST be disabled on this Hyperdrive configuration. This application requires fresh read-after-write behavior across all admin and billing operations (dwellings, meters, residents, tariffs, billing configuration/state, balances, period state, and settings). Writes are immediately followed by client-side revalidation reads that must never observe stale cached query results. This is a strict production invariant, not an optional performance tuning recommendation. Connection pooling and acceleration remain enabled.

- To disable caching at creation time:
  ```bash
  wrangler hyperdrive create <name> --connection-string="<url>" --caching-disabled
  ```
- To inspect and disable caching on an existing configuration:
  ```bash
  wrangler hyperdrive get <id>
  wrangler hyperdrive update <id> --caching-disabled
  ```

### Rate limiting

`wrangler.jsonc` already declares three Rate Limiting bindings (`AUTH_RATE_LIMITER`, `AUTH_IP_RATE_LIMITER`, `INVOICE_TOKEN_RATE_LIMITER`) with arbitrary `namespace_id` integers (`1001`, `1003`, `1002`). These are declarative -- Cloudflare provisions them automatically on deploy, no manual dashboard step needed. If this Cloudflare account already runs other Workers with their own rate limiter bindings, double-check these three `namespace_id` values don't collide with one of them.

### Browser Rendering

The `BROWSER` binding in `wrangler.jsonc` needs Browser Rendering enabled on the account (part of the Workers Paid plan). No extra provisioning step beyond having the binding declared.

### KV namespace for the SESSION binding

The @astrojs/cloudflare adapter auto-injects a KV binding named SESSION and an Images binding named IMAGES into the deployed Worker configuration, even though this app never uses Astro's session API or the Image component (confirmed: no `Astro.session`, `astro:assets`, or `<Image>` usage anywhere in src/). Neither binding is declared in this project's own wrangler.jsonc; they only appear in the generated dist/server/wrangler.json at build time. Recent Wrangler versions can auto-provision a KV namespace for a binding with no `id` configured, so the first `wrangler deploy` may just work without any extra step -- but this could not be confirmed without a real Cloudflare account in this environment. If the deploy fails complaining about the SESSION binding, fall back to provisioning one manually:

```bash
wrangler kv namespace create SESSION
```

Then add the returned id to wrangler.jsonc as a new `kv_namespaces` entry (`[{"binding": "SESSION", "id": "<returned-id>"}]`) and redeploy. Whether the IMAGES binding needs anything beyond being declared could also not be confirmed here -- verify both at the very first deploy attempt and update this document with what was actually required.

## 3. Database migrations

Set the explicit production migration target before deploying:

```bash
export PRODUCTION_DATABASE_URL="<production-supabase-postgres-connection-string>"
```

`npm run deploy` builds first, runs `drizzle-kit migrate` directly against this non-local Postgres target, and deploys the Worker only if both steps succeed. The migration runner rejects missing and localhost URLs; it does not reuse an ambient `DATABASE_URL`.

> **Warning:** `npm run db:seed` is demo/local-dev-only fixture data (two fake organizations, fake residents) and must never be run against a production database.

### Migration 0009/0010/0011 safety check

Run this check before deploying any release that includes migrations `0009_delivery_safety_indexes`, `0010_delivery_safety_convergence`, or `0011_resend_retryable_command_id`. Migration `0009` has existed in three different forms across this project's git history with genuinely different effects (see the comment at the top of `drizzle/migrations/0010_delivery_safety_convergence.sql`), and this repository's own deploy path (`npm run deploy` -> `db:migrate:production`) runs outside CI, so there is no automated record of what has actually been applied to production. Connect directly to the production database (read-only is enough) and run:

```sql
-- 1. How many migrations have been applied, in order? Drizzle's own
--    tracking table stores a content HASH and an applied timestamp, NOT
--    the migration's filename/tag -- it cannot tell you "0009" by name.
--    Row count tells you how far the chain has progressed (this repo has
--    12 migration files, 0000 through 0011, in `drizzle/migrations/`); to
--    identify a SPECIFIC historical form of 0009, rely on the SCHEMA
--    evidence in query 2/3 below, which is unambiguous.
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;

-- 2. What does the schema actually look like right now?
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename IN ('invoice_deliveries', 'invoice_send_attempts');

SELECT column_name FROM information_schema.columns
WHERE table_name IN ('invoice_deliveries', 'invoice_send_attempts')
ORDER BY table_name, ordinal_position;

-- 3. Were any historical PAPER rows backfilled as "verified" by the
--    second historical form of 0009? (Only meaningful once
--    is_initial_paper_dispatch exists -- query 2 confirms that.)
SELECT id, invoice_id, created_at, is_initial_paper_dispatch
FROM invoice_deliveries
WHERE method = 'PAPER'
ORDER BY created_at;
```

Interpret the results:

- **Query 1 has fewer than 9 rows**: migrations have not yet reached `0009`. Deploying the full chain (`0009` -> `0010` -> `0011`) in order is safe.
- **`invoice_deliveries_invoice_id_paper_idx` appears in query 2** (alongside, or instead of, `invoice_deliveries_invoice_id_initial_paper_idx`): the FIRST historical form of `0009` ran. Its `DELETE` already removed any duplicate historical PAPER rows before you can inspect them -- check query 3's row count against any independent record you have (a backup, an audit export) of how many PAPER rows existed before that deploy. If they don't match, the missing rows are unrecoverable from this database; only a pre-deploy backup can restore them. Deploying `0010`/`0011` afterward is still safe and required (they drop the bad index and converge the rest of the schema).
- **Query 3 shows rows with `is_initial_paper_dispatch = true` for invoices that predate the "Record paper dispatch" feature**: the SECOND historical form of `0009` ran (the backfill). Those `true` values are not verified manual dispatch. For each such row:
  1. Cross-check it against real evidence (physical mailing records, resident correspondence) that an administrator genuinely printed and posted/handed over that specific invoice.
  2. If you cannot confirm it, clear the false positive so the application stops treating it as verified and the "Record paper dispatch" action becomes available again for that invoice:
     ```sql
     UPDATE invoice_deliveries
     SET is_initial_paper_dispatch = false
     WHERE id = '<the specific row's id>';
     ```
     Do this ONE ROW AT A TIME with its own `id`, never as a bulk `UPDATE ... WHERE method = 'PAPER'` -- a row you DID confirm as genuine (or one created by the real "Record paper dispatch" action after this feature shipped) must not be cleared.
  3. Once cleared, an administrator can use "Record paper dispatch" again on that invoice to create a genuinely verified record. This does not touch the invoice's existing `sent_at`/case status -- see "Operator action required: old auto-PAPER-success data may show a contradictory delivery history" in `docs/KNOWN_LIMITATIONS.md`.
- **`invoice_send_attempts_invoice_id_command_id_idx`'s `indexdef` in query 2 includes `status = 'CLAIMED'` in its `WHERE` clause (not just `command_id IS NOT NULL`)**: `0011` has already applied. If it shows only `command_id IS NOT NULL`, `0011` has not yet run (safe to deploy) or ran before this narrowing was introduced.
- **All of the above show the fully-converged end state already**: this migration set has already been deployed; re-running `npm run deploy` is a safe no-op for this specific concern (all three migrations are idempotent).

## 4. Storage bucket setup

Run the storage initialization script once to create the private `invoices` bucket:

```bash
SUPABASE_URL="<production-url>" SUPABASE_SECRET_KEY="<production-JWT-service-role-key>" npm run storage:setup
```

This script is idempotent and safe to re-run.

## 5. Supabase Auth dashboard configuration (manual, required)

Refer to [docs/deployment/supabase-setup.md](supabase-setup.md) for the exact magic-link email template override and Site URL / redirect allow-list configuration. Restate these two concrete production values explicitly:

1. **Email template override** (under Authentication > Email Templates > Magic Link):

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">
  Sign in
</a>
```

2. **URL Configuration** (under Authentication > URL Configuration):
- **Site URL**: must equal the production `APP_BASE_URL` secret exactly.
- **Redirect URLs**: must contain exactly `<APP_BASE_URL>/auth/confirm` and nothing broader.

## 6. Worker secrets

`astro.config.ts` declares two kinds of env vars, and they are configured completely differently. Getting this wrong doesn't produce an error -- it silently ships local dev values to production.

### Runtime secrets (`access: "secret"`) -- set with `wrangler secret put`

These are read from the actual Cloudflare Worker at request time, so `wrangler secret put` is correct for them:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_PUBLISHABLE_KEY
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put APP_BASE_URL
wrangler secret put AWS_SES_ACCESS_KEY_ID
wrangler secret put AWS_SES_SECRET_ACCESS_KEY
wrangler secret put AWS_SES_REGION
wrangler secret put EMAIL_FROM
wrangler secret put INVOICE_TOKEN_SECRET
wrangler secret put INTERNAL_CRON_SECRET
```

- `INTERNAL_CRON_SECRET` has no default value anywhere in the code on purpose -- it alone gates an org-wide, financially-consequential automated action (invoice generation and sending). If it isn't set, requests to `POST /api/v1/internal/scheduled-jobs` (including the real Cron Trigger's own call) fail closed rather than silently accepting an insecure default.

### Build-time values (`access: "public"`) -- do NOT use `wrangler secret put`

`ADMIN_REQUIRE_AAL2` is declared with `access: "public"` in `astro.config.ts`. Astro resolves it during `npm run build`, using the value present in the environment (or a `.env` file) on the machine that runs the build -- **Cloudflare Worker secrets have no effect on it at all**, whether set before or after the build. Set it as a real environment variable (or in a `.env.production` file Vite will pick up) before running `npm run build`/`npm run deploy`:

```bash
export ADMIN_REQUIRE_AAL2="false"  # see the warning below before ever changing this
npm run deploy
```

If this isn't set on the build machine, the build can silently reuse `ADMIN_REQUIRE_AAL2=false` from a local `.dev.vars`/`.env` file present in that checkout. Always confirm what a given build machine's environment actually contains before deploying from it.

> **Warning -- do not set `ADMIN_REQUIRE_AAL2=true` yet.** Per [docs/decisions/0002-admin-aal2-boundary.md](../decisions/0002-admin-aal2-boundary.md), this codebase has no MFA enrollment UI at all -- there is no way for an admin to ever satisfy the AAL2 check this flag turns on. Flipping it to `true` before that enrollment flow exists and every admin has enrolled a factor **locks out every admin with no recovery path**. Leave it `false` for this deployment; treat enabling it as a separate future step blocked on building MFA enrollment first, tracked in that decision doc.

## 7. First admin bootstrap (manual, required -- no self-serve path exists)

There is no self-serve signup flow. The `organizations.create` action requires an already-authenticated ADMIN caller (`requireAdminRole`), which is circular for the very first admin. The first organization and admin account must be created by hand, following the same pattern already demonstrated for local dev in README.md's 'Local setup' step 7:

### Step A: Insert organization, admin user, and membership into Postgres

Connect directly to the production Postgres database and execute:

```sql
INSERT INTO organizations (
  id, name, address_line1, country_code, currency, timezone, locale, invoice_prefix, default_due_days
) VALUES (
  '<org-uuid>', '<organization-name>', '<address-line-1>', 'LV', 'EUR', 'Europe/Riga', 'lv', 'INV', 14
);

INSERT INTO app_users (
  id, role, email_snapshot, display_name
) VALUES (
  '<admin-user-uuid>', 'ADMIN', '<admin-email>', '<admin-display-name>'
);

INSERT INTO organization_memberships (
  organization_id, user_id
) VALUES (
  '<org-uuid>', '<admin-user-uuid>'
);
```

### Step B: Create matching Supabase Auth user

Create a matching Supabase Auth user with that exact same UUID as its id and a real password, via `POST <SUPABASE_URL>/auth/v1/admin/users` with the service role key, mirroring the curl example already in README.md step 7 but against the production Supabase URL/key instead of the local ones:

```bash
curl -X POST "<SUPABASE_URL>/auth/v1/admin/users" \
  -H "apikey: <SUPABASE_SECRET_KEY>" \
  -H "Authorization: Bearer <SUPABASE_SECRET_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"id":"<admin-user-uuid>","email":"<admin-email>","password":"<admin-password>","email_confirm":true}'
```

## 8. Deploy

Deploy the application to Cloudflare:

```bash
npm run deploy
```

`npm run deploy` is wired to build, migrate using `PRODUCTION_DATABASE_URL`, then deploy. The build step runs the postbuild script that wires the Cloudflare Cron `scheduled` handler automatically.

## 9. Post-deploy verification checklist

- [ ] The site loads over HTTPS.
- [ ] `/login` renders.
- [ ] An admin created in step 7 can sign in and reach `/admin`.
- [ ] A resident magic link (once one is provisioned via the admin UI) arrives and its link points at the production `APP_BASE_URL` (not Supabase's own default).
- [ ] The Cloudflare dashboard's Cron Triggers page shows the "15 2 * * *" trigger for this Worker.
- [ ] A Storage upload/download round-trip works (e.g. by sending one real invoice and confirming its PDF downloads).
- [ ] Verify via `wrangler hyperdrive get <id>` that the production Hyperdrive config shows caching disabled. Perform this explicit manual check every time a Hyperdrive config is created or modified (not just on first deploy).

## 10. Ongoing maintenance

- Every future schema change is applied by the migration gate in `npm run deploy`; keep `PRODUCTION_DATABASE_URL` explicit in the deployment environment.
- The scheduled Cron job (POST /api/v1/internal/scheduled-jobs) returns HTTP 500 if any organization's automated run failed, which is what actually marks a Cloudflare Cron Trigger execution "failed" in Cloudflare's own dashboard -- check that dashboard periodically, since there is no other alerting configured.
