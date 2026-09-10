# Property Billing Platform

Multi-tenant property billing SaaS application for apartment buildings, housing associations, cooperatives, and small property managers.

See the comprehensive product and engineering specification in [docs/product/ORCA_PROPERTY_BILLING_ASTRO_SPEC.md](docs/product/ORCA_PROPERTY_BILLING_ASTRO_SPEC.md).

## Technology Stack

- **Framework**: [Astro](https://astro.build) (SSR / `output: "server"`)
- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com) (`@astrojs/cloudflare`)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com) (`@tailwindcss/vite`)
- **Interactivity**: [React](https://react.dev) islands (`@astrojs/react`)
- **Database & ORM**: PostgreSQL via [Drizzle ORM](https://orm.drizzle.team)
- **Auth & Storage**: [Supabase](https://supabase.com) (Auth SSR + private invoice storage)
- **Testing**: [Vitest](https://vitest.dev) (unit/integration) and [Playwright](https://playwright.dev) (E2E)
- **Quality Gates**: TypeScript strict mode, ESLint, Prettier, Astro check

## Roles & Access Control

- **ADMIN**: Organization-scoped management (buildings, dwellings, periods, readings, rules, invoices, payments, messages).
- **RESIDENT**: Dwelling-scoped access (assigned dwellings, readings submission, invoices, payment history, messages).

## Local Development Flow

Per specification Section 39:

```bash
# 1. Install dependencies
npm install

# 2. Configure local environment
cp .env.example .env.local

# 3. Database migrations and seed (Phase B)
npm run db:migrate
npm run db:seed

# 4. Start local development server
npm run dev
```

## Validation and Cloudflare Compatibility

```bash
# Build for production
npm run build

# Preview Worker locally using Wrangler
npm run preview
```

## Quality Gates

```bash
npm run format:check  # Verify code formatting with Prettier
npm run lint          # Run ESLint checks
npm run typecheck     # TypeScript strict compiler check
npm run astro:check   # Astro diagnostic check
npm run test          # Run Vitest unit tests
npm run build         # Verify production build
```
