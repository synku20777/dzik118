# Property Billing Platform

This is a multi-tenant property billing SaaS application. It serves apartment buildings, housing associations, cooperatives, and small property managers.

See the full product and engineering specification in [docs/product/ORCA_PROPERTY_BILLING_ASTRO_SPEC.md](docs/product/ORCA_PROPERTY_BILLING_ASTRO_SPEC.md).

## Technology stack

- **Framework**: [Astro](https://astro.build) (SSR, `output: "server"`)
- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com) (`@astrojs/cloudflare`)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com) (`@tailwindcss/vite`)
- **Interactivity**: [React](https://react.dev) islands (`@astrojs/react`)
- **Database and ORM**: PostgreSQL through [Drizzle ORM](https://orm.drizzle.team)
- **Auth and storage**: [Supabase](https://supabase.com) (Auth SSR and private invoice storage)
- **Email**: Amazon SES in production, local SMTP to Mailpit in development
- **Testing**: [Vitest](https://vitest.dev) (unit and integration) and [Playwright](https://playwright.dev) (end-to-end)
- **Quality gates**: TypeScript strict mode, ESLint, Prettier, Astro check

## Roles and access control

- **ADMIN**: manages one organization. This covers buildings, dwellings, periods, meter readings, billing rules, invoices, payments, and messages.
- **RESIDENT**: has access to one or more dwellings. A resident can submit readings and view their own invoices, payment history, and messages.

An admin from one organization cannot see another organization's data. A resident cannot see another resident's dwelling. See [Edge cases to test](#edge-cases-to-test) for how to check this.

## Prerequisites

- Node.js 22.12 or later
- Docker (the local Supabase stack runs in Docker containers)
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase --version` also works without a separate install)

## Local setup

Run these steps in order.

1. Install the project dependencies.

   ```bash
   npm install
   ```

2. Start a local Supabase stack. If this project has no `supabase/` folder yet, create one first.

   ```bash
   npx supabase init   # only if supabase/ does not exist yet
   npx supabase start
   ```

   The `start` command prints local URLs and keys. Keep this output. You need the API URL, the anon key, and the service role key in the next step.

3. Turn on local SMTP delivery. Open `supabase/config.toml` and find the Mailpit block (search for `smtp_port`). Remove the comment mark from that line and set it to `smtp_port = 54325`. Then apply the change.

   ```bash
   npx supabase stop
   npx supabase start
   ```

   This does not delete your data. Local email (magic links and invoice delivery) now lands in Mailpit at [http://127.0.0.1:54324](http://127.0.0.1:54324) instead of a real inbox.

4. Create your local secrets file.

   ```bash
   cp .env.example .dev.vars
   ```

   Edit `.dev.vars` and fill in `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PUBLIC_SUPABASE_URL`, and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` with the values `supabase start` printed in step 2. Set `APP_BASE_URL` to `http://localhost:4321`. Leave the `AWS_SES_*` fields blank so the app uses local SMTP instead of real email.

   The Cloudflare adapter reads `.dev.vars` for both `npm run dev` and `npm run build`.

5. Export the database and Supabase variables in your shell. The migration, seed, and storage scripts read these directly and do not read `.dev.vars`.

   ```bash
   export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
   export SUPABASE_URL="http://127.0.0.1:54321"
   export SUPABASE_SECRET_KEY="<the service role key from step 2>"
   ```

   On Windows PowerShell, use `$env:DATABASE_URL = "..."` instead of `export`.

6. Run the database migrations, then load the seed data.

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

   The seed data creates two organizations, a set of dwellings, and both an admin user and several resident users in the app's own `app_users` table. It does not yet create matching Supabase Auth accounts. Step 7 does that.

7. Create Supabase Auth accounts that match the seed data. The seed script fixes these IDs so that Supabase Auth and `app_users` agree on who each person is. Read `scripts/seed.ts` for the full list. The two accounts below are enough to sign in and explore the app.

   ```bash
   # Admin for the main demo organization (sign in with a password)
   curl -X POST "$SUPABASE_URL/auth/v1/admin/users" \
     -H "apikey: $SUPABASE_SECRET_KEY" \
     -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{"id":"10000000-0000-4000-8000-0000000000a1","email":"admin.a@example.com","password":"ChangeMe123!","email_confirm":true}'

   # Resident for dwelling 1 in the main demo organization (sign in with a magic link, no password)
   curl -X POST "$SUPABASE_URL/auth/v1/admin/users" \
     -H "apikey: $SUPABASE_SECRET_KEY" \
     -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{"id":"20000000-0000-4000-8000-000000000001","email":"resident1@example.com","email_confirm":true}'
   ```

8. Create the private invoice storage bucket.

   ```bash
   npm run storage:setup
   ```

9. In the Supabase Studio at [http://127.0.0.1:54323](http://127.0.0.1:54323), set the magic-link email template and the auth redirect allow-list. Follow the exact steps in [docs/deployment/supabase-setup.md](docs/deployment/supabase-setup.md). Skip this step and resident sign-in fails, even though the application code is correct.

10. Start the local development server.

    ```bash
    npm run dev
    ```

    Open [http://localhost:4321](http://localhost:4321).

## Logging in

The app has two sign-in forms on the same page, [http://localhost:4321/login](http://localhost:4321/login).

**Admin sign-in** uses a password. Use the email and password you set in step 7 above (`admin.a@example.com` / `ChangeMe123!` if you used the example command as written). A successful sign-in redirects to `/admin`.

**Resident sign-in** uses a one-time link, not a password.

1. Enter the resident's email address (for example `resident1@example.com`) and submit the form.
2. Open Mailpit at [http://127.0.0.1:54324](http://127.0.0.1:54324) and open the newest message.
3. Click the sign-in link inside the email, then click the **Confirm sign-in** button on the page that opens.

A successful sign-in redirects to `/portal`. The confirmation button exists on purpose: it stops email scanners from consuming the link before the real user clicks it.

If a sign-in attempt fails, check that you created the matching Supabase Auth account (step 7) and that the email address matches exactly.

## Testing the API

Most business logic (create a dwelling, generate an invoice, send an invoice, import a bank statement, and so on) runs through Astro Actions. A browser form posts to these, not a plain JSON endpoint. The most direct way to exercise this logic outside a browser is the integration test suite, which calls the same domain functions the actions call, against a real local Postgres, Supabase Storage, and Mailpit.

```bash
npm run test:integration
```

This needs `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` set in your shell, the same as in setup step 5.

A small number of routes are plain HTTP endpoints, and you can call these directly with `curl` or a tool like Postman:

- `POST /api/v1/auth/request-link` — public. Sends a resident sign-in link. Limited to 5 requests per email per 60 seconds.
- `GET /api/v1/admin/o/:orgId/dwellings/export` — admin only. Downloads a CSV of an organization's dwellings. Needs an admin session cookie.
- `GET /api/v1/admin/o/:orgId/invoices/:invoiceId/pdf` — admin only. Downloads an invoice PDF.
- `GET /api/v1/portal/invoices/:invoiceId/pdf?dwellingId=...` — resident only. Downloads an invoice PDF for the resident's own dwelling.
- `GET /invoice/access/:token` — public. Shows one invoice, using the token an invoice email links to. No session needed.
- `GET /invoice/access/:token/pdf` — public. Downloads the same invoice's PDF. Limited to 30 requests per IP per 60 seconds.

To call an admin or resident endpoint with `curl`, sign in through the browser first, then copy the session cookie from your browser's developer tools into the request.

## Testing the UI

Run the automated end-to-end suite. Playwright builds the app and starts a local Cloudflare Worker for you.

```bash
npm run test:e2e
```

To test by hand, start the dev server (`npm run dev`, or `npm run build && npx wrangler dev --port 4321` for a closer match to production) and walk through the flows in [Logging in](#logging-in) above. Then check the main areas:

- `/admin` and `/admin/organizations` — pick an organization, then manage its dwellings, billing periods, rules, and settings under `/admin/o/:orgId/...`.
- `/portal` and `/portal/dwellings` — a resident's own dwellings and invoices.

If every page fails to load or hangs with no response, see [Edge cases to test](#edge-cases-to-test) below.

## Quality gates

```bash
npm run format:check  # check code formatting with Prettier
npm run lint          # run ESLint
npm run typecheck     # run the TypeScript strict compiler check
npm run astro:check   # run the Astro diagnostic check
npm run test          # run Vitest unit tests
npm run test:integration  # run Vitest integration tests (needs a local Postgres/Supabase stack)
npm run build         # verify the production build
```

## Edge cases to test

- **Cross-tenant access.** Sign in as `admin.a@example.com` and try to open an organization, dwelling, or invoice ID that belongs to the second seeded organization. The app must deny this, and it must not reveal whether the ID exists.
- **Cross-resident access.** Sign in as one resident and try to open another resident's dwelling or invoice by guessing its ID. The app returns a plain not-found result, not a message that hints the ID is valid.
- **Missing meter readings.** A billing period can have a dwelling with no reading for that period. Its billing case shows `MISSING_DATA`, and the app blocks invoice generation for it until the reading exists.
- **Double-clicking Send.** Sending an invoice is safe to repeat. Two clicks, or two people clicking at the same time, produce exactly one email and one delivery record, not two.
- **Invoice link expiry and revocation.** A token-based invoice link (`/invoice/access/:token`) stops working 90 days after it was sent. An admin can also revoke it early from the invoice detail page. Either way, the link then returns a generic not-found page, never a reason.
- **Rate limits.** The resident sign-in link endpoint allows 5 requests per email per 60 seconds. The public invoice-link endpoints allow 30 requests per IP per 60 seconds. Repeated manual testing can trip a 429 (too many requests) response. Wait 60 seconds and try again.
- **Local dev server hangs on every request.** In some environments, declaring the Cloudflare Browser Rendering binding in `wrangler.jsonc` blocks every request to the local dev server, not only the ones that render a PDF. If this happens, comment out the `"browser"` block in `wrangler.jsonc`, restart the dev server, and confirm plain pages load again. Restore the binding before testing invoice sending or PDF downloads, and before committing.
