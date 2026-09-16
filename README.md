# Property Billing Platform

Property Billing is a multi-tenant property billing application. It serves
apartment buildings, housing associations, cooperatives, and small property
managers. It supports monthly billing cycles, dwelling-level financial accounts
with an append-only transaction ledger, bank payment reconciliation against
remaining invoice balances (handling exact, partial, and overpayments), credit
and debt carry-forward, automated late-fee policies, structured invoice template
customization, and resident self-service.

This README explains how to install the project and run it on your own
machine. For everything else, see [Documentation](#documentation) below.

## Documentation

- [Product specification](docs/product/ORCA_PROPERTY_BILLING_ASTRO_SPEC.md)
  — the full product and engineering specification.
- [Service design blueprint](docs/product/SERVICE_DESIGN_BLUEPRINT.md) —
  maps the service across the admin and resident roles.
- [User journeys](docs/product/USER_JOURNEYS.md) — step-by-step flows for
  each role.
- [UI specification](docs/product/UI_SPECIFICATION.md) — interface design
  principles and rules.
- [Full design specification](docs/product/FULL_DESIGN_SPECIFICATION.md) —
  the brand identity and visual design system.
- Decision records (`docs/decisions/`) — why the team made key
  architecture and security choices.
  - [0001: Tenant cross-reference integrity](docs/decisions/0001-tenant-cross-reference-integrity.md)
  - [0002: Admin MFA (AAL2) boundary](docs/decisions/0002-admin-aal2-boundary.md)
  - [0003: Dwelling account ledger and payment allocation](docs/decisions/0003-dwelling-account-ledger-and-payment-allocation.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md) — incomplete items,
  deferred work, and deliberate trade-offs. Read this before you rely on
  any part of the system.
- [Deployment runbook](docs/deployment/DEPLOYMENT_RUNBOOK.md) — how to
  deploy to a real Cloudflare, Supabase, and AWS account.
- [Supabase project setup](docs/deployment/supabase-setup.md) — manual
  Supabase configuration the application does not automate.
- [Testing environment setup](docs/TESTING.md) — how to install and run
  the test suite.

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

- **ADMIN**: manages one organization. This covers buildings, dwellings,
  dwelling account balances and adjustments, periods, meter readings,
  billing rules, invoice templates, invoices, payments, and messages.
- **RESIDENT**: has access to one or more dwellings. A resident can submit
  readings and view their own invoices, outstanding balance, payment history,
  and messages.

An admin from one organization cannot see another organization's data. A
resident cannot see another resident's dwelling. See
[Edge cases to test](docs/TESTING.md#edge-cases-to-test) for how to check
this.

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

3. Enable local SMTP delivery. Open `supabase/config.toml` and find the Mailpit block (search for `smtp_port`). Remove the comment mark from that line and set it to `smtp_port = 54325`. Then apply the change.

   ```bash
   npx supabase stop
   npx supabase start
   ```

   This does not delete your data. Local email (magic links and invoice delivery) now lands in Mailpit at [http://127.0.0.1:54324](http://127.0.0.1:54324) instead of a real inbox.

4. Create your local secrets file.

   ```bash
   cp .env.example .dev.vars
   ```

   Edit `.dev.vars`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PUBLIC_SUPABASE_URL`, and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the values `supabase start` printed in step 2. Set `APP_BASE_URL` to `http://localhost:4321`. Leave the `AWS_SES_*` fields blank so the app uses local SMTP instead of real email.

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

9. In the Supabase Studio at [http://127.0.0.1:54323](http://127.0.0.1:54323), set the magic-link email template and the auth redirect allow-list. Follow the exact steps in [Supabase project setup](docs/deployment/supabase-setup.md). Skip this step and resident sign-in fails, even though the application code is correct.

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

A successful sign-in redirects to `/portal`. The confirmation button exists on purpose. It stops email scanners from consuming the link before the real user clicks it.

If a sign-in attempt fails, check that you created the matching Supabase Auth account (step 7) and that the email address matches exactly.

## Testing

See [Testing environment setup](docs/TESTING.md) for how to install and
run the test suite. That guide covers unit tests, integration tests,
end-to-end tests, the quality gates, manual testing of the API and the UI,
and edge cases to check by hand.
