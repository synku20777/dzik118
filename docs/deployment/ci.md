# CI/CD

## CI (`.github/workflows/ci.yml`)

Job `Quality Gates` on every push/PR to `master`/`main`: astro sync -> format ->
lint -> typecheck -> astro:check -> unit tests -> migration drift check ->
dependency audit (non-blocking for now) -> build. Superseded runs on the same
ref are cancelled.

The migration drift check runs `drizzle-kit generate`; if the schema changed
without a committed migration it produces a new file and the job fails. Fix by
running `npx drizzle-kit generate --name <name>` locally and committing it.

Not in CI yet: integration tests (need local Supabase via Docker) and Playwright
E2E (need `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`; `ui.spec.ts`
has a known 390px overflow failure).

## Branch protection (configured outside the repo)

Require the `Quality Gates` status check on `master` (admins may still push):

```
gh api -X PUT repos/synku20777/dzik118/branches/master/protection --input - <<'JSON'
{"required_status_checks":{"strict":false,"contexts":["Quality Gates"]},
 "enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}
JSON
```

## Deploy (`.github/workflows/deploy.yml`)

Manual (`workflow_dispatch`) only, runs in the `production` environment, refuses
to run unless CI succeeded for the commit, then `npm run deploy` (build ->
production migrations -> `wrangler deploy`). Configure a required reviewer on the
`production` environment. Secrets to add: `PRODUCTION_DATABASE_URL`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_BASE_URL`,
`INTERNAL_CRON_SECRET`. Worker runtime secrets stay in Cloudflare
(`wrangler secret put`), see DEPLOYMENT_RUNBOOK.md section 6.
