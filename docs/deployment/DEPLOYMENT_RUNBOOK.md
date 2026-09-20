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
