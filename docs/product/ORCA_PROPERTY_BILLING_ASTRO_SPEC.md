# Property Billing Platform — Orca ADE Developer Specification

**Document ID:** PBILL-ORCA-ASTRO-001  
**Version:** 2.0  
**Date:** 2026-09-10  
**Status:** Build contract / source of truth  
**Reference product:** B118 public guide (`https://b118.lv/docs`)  
**Target:** Small production SaaS, initially up to ~1,000 users  
**Primary roles:** `ADMIN`, `RESIDENT`

---

# 0. Instruction to Orca, Antigravity, Claude and OpenAI agents

This document is the authoritative product and engineering specification for v1.

Agents MUST:

1. Read this entire file before implementing.
2. Inspect the existing repository before scaffolding or replacing anything.
3. Preserve exactly two end-user access levels: `ADMIN` and `RESIDENT`.
4. Enforce all permissions server-side.
5. Scope every organization-owned query by authorized `organization_id`.
6. Scope every resident-owned query by authorized `dwelling_id`.
7. Use PostgreSQL exact numeric/decimal values for money and meter readings.
8. Treat a sent invoice as an immutable financial record.
9. Create migrations, tests, seed data and error states as part of each feature.
10. Avoid inventing major functionality not in this specification.
11. Record material architectural deviations as ADRs in `docs/decisions/`.
12. Never declare a task complete solely because a page renders.
13. Run relevant quality gates before reporting `worker_done`.
14. Prefer simple, maintainable code over speculative abstractions.

The product's core loop is:

**collect data → calculate → verify → deliver → reconcile → preserve history**

---

# 1. Product definition

Build a multi-tenant property billing web application for apartment buildings, housing associations, cooperatives and small property managers.

The administrator manages:

- organizations/buildings;
- dwellings/units;
- residents and access assignments;
- monthly billing periods;
- meters and readings;
- recurring billing rules/tariffs;
- invoice generation and review;
- invoice PDF generation;
- invoice email delivery;
- invoice status;
- bank CSV import;
- payment reconciliation;
- resident communication;
- CSV import/export;
- organization/admin settings;
- audit history;
- optional automatic invoice generation/sending.

The resident can:

- access only dwellings explicitly assigned to them;
- view current and historical invoices;
- view/download/print invoice PDFs;
- inspect invoice calculation lines;
- see consumption history;
- submit missing readings while permitted;
- send messages to the administrator.

Canonical hierarchy:

```text
Organization
└── Dwelling
    ├── Resident access
    ├── Meters
    ├── Billing periods / billing cases
    │   ├── Readings / manual rule inputs
    │   └── Generated charges
    │
    ├── Invoices
    │   ├── Current charges
    │   ├── Previous outstanding balance
    │   ├── Credit applied
    │   ├── Late fees & adjustments
    │   ├── Manual adjustments
    │   ├── Amount due
    │   ├── Balance & penalty snapshots
    │   ├── Invoice lines
    │   ├── Canonical PDF
    │   └── Deliveries
    │
    └── Financial account
        └── Append-only ledger (account_entries)
            ├── Opening balance
            ├── Invoice charges
            ├── Payments (from bank transactions)
            ├── Payment allocations (payment_allocations)
            ├── Late fees & adjustments
            ├── Manual adjustments
            ├── Credit carry-forward
            └── Debt carry-forward
```

Reconciliation flow:

```text
Bank transaction
    ↓
Payment match (propose against invoice remaining balance)
    ↓
Payment allocation (allocated portion) + Dwelling ledger payment credit (full amount)
    ↓
Invoice settlement (PAID only if fully settled) & Account credit (excess payment)
```

The public B118 guide confirms the reference workflow of organization → objects → monthly periods → readings → invoice preparation → sending → bank CSV reconciliation, as well as owner-only object access and owner-submitted water readings.

---

# 2. Scope

## 2.1 v1 goals

The application is complete when a seeded organization can execute a full monthly billing cycle:

1. create/select a billing period;
2. collect missing readings and manual rule inputs;
3. calculate invoice lines;
4. generate invoices with statement balance resolution;
5. prepare invoices, snapshotting financial state and posting charges to the dwelling ledger;
6. generate canonical PDF;
7. email invoices according to dwelling delivery preferences;
8. resident opens own invoice;
9. admin imports bank CSV;
10. system proposes matches against remaining invoice balances (exact, partial, or overpayment);
11. admin confirms match, creating dwelling ledger payment entries and payment allocations;
12. invoice becomes paid if fully settled (or retains remaining unpaid balance if partial; excess becomes account credit if overpaid);
13. history remains reproducible and auditable.

## 2.2 Supported financial scope vs. non-goals

### Supported financial accounting scope

The v1 application implements a dwelling-level financial account model with:

- **Dwelling-scoped append-only ledger (`account_entries`)**: Tracks debits, credits, and running balance per dwelling and currency; immutable via database trigger;
- **Payment matching against remaining balance**: Matches bank transactions against the invoice's unpaid remainder (`amount_due - sum(allocated_amount)`) rather than original face value;
- **Partial payment allocation**: Partial payments allocate against the open invoice, reducing its unpaid balance while leaving the invoice and case unsettled until fully paid;
- **Overpayment and account credit**: Payments exceeding the remaining invoice balance settle the invoice and retain the excess on the dwelling account as an available credit balance;
- **Debt carry-forward**: Outstanding unpaid balances from prior periods carry forward into the next invoice's `previous_outstanding` field;
- **Credit carry-forward**: Available dwelling credit carries forward into the next invoice's `previous_credit_applied` field, reducing the net `amount_due`;
- **Late-fee engine**: Configurable organization policy (`daily_rate`, `grace_days`, `start_rule: DAY_AFTER_DUE_DATE`, `max_penalty_percent`, `stops_at_cap`) calculated on oldest unpaid overdue invoice principal;
- **Late-fee adjustments & waivers**: Explicit auditable adjustments (`late_fee_adjustments`) with structured reason codes and optional notes;
- **Manual financial adjustments**: Dwelling-level manual adjustments (`createDwellingAccountAdjustment`) and draft invoice adjustments (`setInvoiceManualAdjustment`);
- **Immutable invoice financial snapshots**: Invoices snapshot `current_charges`, `previous_outstanding`, `previous_credit_applied`, `late_fee_applied`, `manual_adjustment`, `amount_due`, `remaining_credit`, `balance_snapshot`, and `penalty_snapshot` upon preparation.

### Non-goals

Do NOT implement in v1:

- native mobile applications;
- online card payments;
- open banking / automated bank sync (manual CSV statement import is supported);
- IoT meter integration;
- OCR meter photos;
- maintenance/work orders;
- building access control;
- general-ledger / double-entry ERP accounting integrations (the ledger is dwelling-scoped for tenant billing, not an enterprise general ledger);
- arbitrary multi-invoice allocation ordering or automated multi-invoice splitting from a single transaction;
- direct payment reversals or refunds (unwinding confirmed bank payments is not supported; corrections require compensating manual adjustment entries);
- debt collection workflows or legal recovery cases;
- compounding interest or statutory tiered penalty schedule engines (late fees follow a single-rate policy with grace days and percentage caps);
- debt write-off workflows;
- arbitrary workflow builders;
- drag-and-drop invoice layout builder;
- separate owner/tenant/landlord roles;
- a third customer role;
- structured Latvian B2B e-invoice transport.

Keep future B2B structured invoicing possible without implementing it now.

---

# 3. Locked technology architecture

Do not substitute another framework or primary database without an ADR and explicit coordinator approval.

## 3.1 application

- **Astro**, current stable release compatible with Cloudflare adapter
- **SSR / `output: "server"`**
- **TypeScript**, `strict: true`
- **Tailwind CSS 4**
- **React islands** only where client interaction materially benefits from React
- **shadcn/ui** / Radix-derived accessible primitives where useful
- **Astro Actions** for internal typed mutations
- Astro API endpoints only for public callbacks, file/token access, webhooks and external-style endpoints

Principle:

```text
Astro = application framework
React = optional interactive island layer
```

Do not turn the application into a full React SPA.

## 3.2 persistence

- **PostgreSQL**
- **Supabase hosted Postgres**
- exact Supabase region: **Central EU (Frankfurt / eu-central-1)**
- **Drizzle ORM**
- **Drizzle Kit migrations**
- **node-postgres (`pg`)**
- Cloudflare **Hyperdrive** between Worker and production Postgres

Local development may connect directly to PostgreSQL/Supabase using `DATABASE_URL`.
Production application traffic must use Hyperdrive.

## 3.3 authentication

- **Supabase Auth**
- **`@supabase/ssr`** for cookie-based SSR sessions
- PKCE-compatible server flow
- resident: email magic link
- admin: password/passkey-capable login plus MFA
- authorization remains application-owned

Supabase authenticates identity. Our database decides authorization.

## 3.4 files and invoices

- **Supabase Storage**
- private `invoices` bucket
- no public invoice object URLs
- canonical invoice PDF stored after generation
- PDF generation via **Cloudflare Browser Run `/pdf`** from controlled invoice HTML
- store SHA-256 hash of canonical PDF

## 3.5 runtime/deployment

- **Cloudflare Workers**
- NOT Cloudflare Pages
- Astro official Cloudflare adapter
- Cloudflare Cron Triggers for scheduled work
- Cloudflare Browser Run for invoice PDF
- Hyperdrive for Postgres
- production environment uses Worker bindings/secrets

## 3.6 email

Default production provider:

- **Amazon SES, eu-central-1 (Frankfurt)**

Wrap email behind an internal adapter:

```ts
interface EmailService {
  sendInvoice(input: SendInvoiceEmailInput): Promise<EmailDeliveryResult>;
  sendMagicLink?(input: MagicLinkEmailInput): Promise<EmailDeliveryResult>;
}
```

Supabase Auth may use configured SMTP for auth emails. Application invoice mail should use the app email abstraction.

## 3.7 validation/testing

- `astro/zod` or compatible Zod through Astro Actions
- Vitest
- Playwright
- ESLint where supported by repository configuration
- Prettier
- TypeScript typecheck
- Astro check

---

# 4. Deployment topology

```text
                           User browser
                                │
                                ▼
                       Cloudflare network
                                │
                                ▼
                  ┌────────────────────────┐
                  │ Astro SSR Worker       │
                  │                        │
                  │ pages                  │
                  │ middleware             │
                  │ Astro Actions          │
                  │ API endpoints          │
                  │ auth authorization     │
                  │ billing domain         │
                  └──────┬─────┬─────┬────┘
                         │     │     │
                 ┌───────┘     │     └─────────────┐
                 ▼             ▼                   ▼
           Hyperdrive      Supabase Auth      Browser Run
                 │                                  │
                 ▼                                  ▼
        Supabase PostgreSQL                    Invoice PDF
        Frankfurt / EU                             │
                 │                                 ▼
                 │                         Supabase Storage
                 │                           private bucket
                 │
                 └───────────────┐
                                 ▼
                             Audit data

Cloudflare Cron
      │
      ├── overdue scan
      ├── auto generation
      └── auto sending

Astro Worker
      │
      └── Amazon SES Frankfurt
             └── invoice email
```

For ~1,000 users, do not add Kubernetes, a dedicated API server, Redis, Kafka or a separate frontend deployment.

---

# 5. Framework configuration

Use the official Cloudflare Astro adapter.

Representative configuration:

```ts
// astro.config.ts
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
```

If current Astro/Tailwind integration differs, use the current official Astro setup rather than forcing stale syntax.

Cloudflare runtime must be tested with:

```bash
astro build
astro preview
```

Do not rely only on the Node-based Astro dev server for production compatibility.

---

# 6. Cloudflare configuration

Representative `wrangler.jsonc`:

```jsonc
{
  "name": "property-billing",
  "compatibility_date": "2026-09-10",

  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "<production-hyperdrive-id>"
    }
  ],

  "triggers": {
    "crons": ["15 2 * * *"]
  }
}
```

Use current Wrangler schema if this changes.

Secrets MUST use Cloudflare secrets/environment configuration, never committed JSON:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY          # server only
AWS_SES_ACCESS_KEY_ID
AWS_SES_SECRET_ACCESS_KEY
AWS_SES_REGION
EMAIL_FROM
APP_BASE_URL
INVOICE_TOKEN_SECRET
```

Local-only:

```text
DATABASE_URL
```

The Supabase service/secret key is server-only and must never be prefixed `PUBLIC_`.

---

# 7. Repository layout

```text
/
├── src/
│   ├── actions/
│   │   ├── index.ts
│   │   ├── organizations.ts
│   │   ├── dwellings.ts
│   │   ├── periods.ts
│   │   ├── meters.ts
│   │   ├── readings.ts
│   │   ├── billing.ts
│   │   ├── invoices.ts
│   │   ├── payments.ts
│   │   └── messages.ts
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── admin/
│   │   ├── resident/
│   │   ├── billing/
│   │   └── invoices/
│   │
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema/
│   │   │   ├── auth.ts
│   │   │   ├── organizations.ts
│   │   │   ├── dwellings.ts
│   │   │   ├── billing.ts
│   │   │   ├── invoices.ts
│   │   │   ├── payments.ts
│   │   │   ├── messaging.ts
│   │   │   └── audit.ts
│   │   └── queries/
│   │
│   ├── domain/
│   │   ├── auth/
│   │   ├── authorization/
│   │   ├── organizations/
│   │   ├── readings/
│   │   ├── billing/
│   │   ├── invoices/
│   │   ├── payments/
│   │   └── messaging/
│   │
│   ├── layouts/
│   │   ├── AdminLayout.astro
│   │   ├── ResidentLayout.astro
│   │   └── AuthLayout.astro
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   ├── email/
│   │   ├── storage/
│   │   ├── pdf/
│   │   ├── decimal/
│   │   └── logging/
│   │
│   ├── middleware.ts
│   │
│   ├── pages/
│   │   ├── index.astro
│   │   ├── login.astro
│   │   ├── auth/
│   │   │   └── confirm.ts
│   │   ├── invoice/
│   │   │   └── access/
│   │   │       └── [token].ts
│   │   ├── admin/
│   │   ├── portal/
│   │   └── api/
│   │       └── v1/
│   │
│   └── styles/
│       └── global.css
│
├── drizzle/
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── fixtures/
│   ├── bank/
│   └── imports/
├── docs/
│   ├── product/
│   ├── decisions/
│   └── deployment/
├── scripts/
├── astro.config.ts
├── drizzle.config.ts
├── wrangler.jsonc
├── tsconfig.json
├── package.json
└── .env.example
```

Business rules belong in `src/domain/`, not Astro pages or React components.

Astro Actions call the domain layer. The domain layer calls scoped repositories.

---

# 8. Roles and permission model

```ts
type UserRole = "ADMIN" | "RESIDENT";
```

## ADMIN

Admin receives organization access through:

```text
organization_memberships
```

An admin may belong to multiple organizations.

## RESIDENT

Resident receives dwelling access through:

```text
dwelling_access
```

A resident may access one or more dwellings.

No resident automatically receives organization-wide access.

## Authorization invariant

Every protected request/action:

```text
Supabase authenticated identity
        ↓
app_users record
        ↓
role
        ↓
membership/access lookup
        ↓
target resource tenant/dwelling
        ↓
allowed action
```

Admin:

```text
target.organization_id
∈ currentUser.organizationMemberships
```

Resident:

```text
target.dwelling_id
∈ currentUser.dwellingAccess
```

Never authorize by matching email strings alone.

---

# 9. Exact routes

## 9.1 public/auth

| Route | Purpose |
|---|---|
| `/` | product landing or login redirect |
| `/login` | login entry |
| `/auth/confirm` | Supabase OTP/magic-link confirmation |
| `/invoice/access/[token]` | tokenized invoice access |
| `/unauthorized` | access denied |
| `/logout` | logout action/redirect |

## 9.2 admin

| Route | Purpose |
|---|---|
| `/admin` | organization redirect/selector |
| `/admin/organizations` | organization selector/create |
| `/admin/o/[orgId]/dashboard` | current period dashboard |
| `/admin/o/[orgId]/periods` | period history |
| `/admin/o/[orgId]/periods/[periodId]` | monthly billing workbench |
| `/admin/o/[orgId]/periods/[periodId]/invoices/[invoiceId]` | invoice detail |
| `/admin/o/[orgId]/dwellings` | dwelling list/import |
| `/admin/o/[orgId]/dwellings/[dwellingId]` | dwelling detail |
| `/admin/o/[orgId]/payments` | reconciliation dashboard |
| `/admin/o/[orgId]/payments/imports/[importId]` | bank import detail |
| `/admin/o/[orgId]/messages` | conversation list |
| `/admin/o/[orgId]/messages/[conversationId]` | conversation |
| `/admin/o/[orgId]/settings` | settings index |
| `/admin/o/[orgId]/settings/organization` | legal/bank/contact |
| `/admin/o/[orgId]/settings/billing` | billing automation |
| `/admin/o/[orgId]/settings/rules` | tariffs/rules |
| `/admin/o/[orgId]/settings/invoice-template` | invoice appearance |
| `/admin/o/[orgId]/settings/users` | admin + resident access |
| `/admin/o/[orgId]/settings/data` | import/export |
| `/admin/o/[orgId]/audit` | audit history |

## 9.3 resident

| Route | Purpose |
|---|---|
| `/portal` | dwelling redirect/selector |
| `/portal/dwellings` | assigned dwellings |
| `/portal/dwellings/[dwellingId]` | resident dashboard |
| `/portal/dwellings/[dwellingId]/invoices` | invoice history |
| `/portal/invoices/[invoiceId]` | invoice detail |
| `/portal/dwellings/[dwellingId]/messages` | conversations |
| `/portal/profile` | profile/session |

Every route performs independent server authorization.

---

# 10. Astro Action contract

Internal product mutations should use Astro Actions.

`src/actions/index.ts` composes domain action groups:

```ts
export const server = {
  organizations,
  dwellings,
  periods,
  meters,
  readings,
  billing,
  invoices,
  payments,
  messages,
  accounts,
  workbench,
  invoiceTemplates,
};
```

Examples:

```text
organizations.create
organizations.update

dwellings.create
dwellings.update
dwellings.archive
dwellings.assignResident
dwellings.removeResident
dwellings.updateInvoiceDelivery

periods.create
periods.lock

meters.create
meters.archive

readings.submitAdmin
readings.submitResident

billing.createRule
billing.updateRule
billing.archiveRule
billing.generate
billing.bulkGenerate
billing.prepare
billing.bulkPrepare
billing.overrideStatus

invoices.send
invoices.resend
invoices.bulkSend
invoices.revokeAccess

payments.confirmMatch
payments.rejectMatch

accounts.saveLateFeePolicy
accounts.adjustLateFee
accounts.setInvoiceManualAdjustment
accounts.createAdjustment

messages.createConversation
messages.reply
messages.resolve
```

Each action MUST:

1. validate input;
2. authenticate;
3. authorize;
4. call domain service;
5. execute mutation transactionally where required;
6. emit audit record where specified;
7. return typed result/error.

Astro Actions are network-accessible server endpoints. Never trust the client because an action is "internal".

---

# 11. Public/API endpoints

Use `src/pages/api/v1` only where URL-style endpoints are materially appropriate.

Required:

```text
POST /api/v1/auth/request-link
GET  /auth/confirm

GET  /invoice/access/:token

GET  /api/v1/admin/o/:orgId/invoices/:invoiceId/pdf
GET  /api/v1/portal/invoices/:invoiceId/pdf

GET  /api/v1/admin/o/:orgId/dwellings/export
GET  /api/v1/admin/o/:orgId/readings/export
```

Future webhooks belong under:

```text
/api/v1/webhooks/*
```

Error structure:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this resource.",
    "requestId": "req_xxx",
    "fieldErrors": null
  }
}
```

Do not expose whether a foreign tenant resource exists.

---

# 12. Database identity model

Supabase owns:

```text
auth.users
```

Application owns:

```text
app_users
```

`app_users.id` must equal the corresponding Supabase `auth.users.id`.

Recommended application table:

```text
app_users
- id uuid PK
- role enum ADMIN|RESIDENT NOT NULL
- email_snapshot text NOT NULL
- display_name text NULL
- disabled_at timestamptz NULL
- created_at
- updated_at
```

Do not use `email_snapshot` as an authorization key.

When auth email changes, synchronize the snapshot.

---

# 13. Database schema

This section is normative.

## 13.1 enums

```text
user_role
  ADMIN
  RESIDENT

dwelling_type
  APARTMENT
  COMMERCIAL_UNIT
  PARKING
  STORAGE
  OTHER

meter_type
  COLD_WATER
  HOT_WATER
  ELECTRICITY
  GAS
  HEAT
  OTHER

period_status
  OPEN
  LOCKED

reading_source
  ADMIN
  RESIDENT
  IMPORT

billing_case_status
  MISSING_DATA
  READY
  DRAFT
  PREPARED
  SENT
  PAID
  OVERDUE

billing_calculation_type
  FIXED
  AREA
  RESIDENT_COUNT
  METER_CONSUMPTION
  MANUAL_QUANTITY
  MANUAL_AMOUNT

delivery_method
  EMAIL
  PAPER

conversation_status
  NEW
  OPEN
  RESOLVED

payment_match_status
  PROPOSED
  CONFIRMED
  REJECTED

payment_match_type
  AUTO_EXACT
  AUTO_PROBABLE
  MANUAL

payment_result_type
  EXACT
  PARTIAL
  OVERPAYMENT

payment_allocation_method
  EXACT
  PARTIAL
  OVERPAYMENT
  MANUAL

account_entry_type
  OPENING_BALANCE
  INVOICE_CHARGE
  PAYMENT
  LATE_FEE
  LATE_FEE_ADJUSTMENT
  MANUAL_ADJUSTMENT
  CREDIT_CARRY_FORWARD
  DEBT_CARRY_FORWARD

late_fee_start_rule
  DAY_AFTER_DUE_DATE

late_fee_adjustment_reason
  BANK_PROCESSING_DELAY
  BILLING_DISPUTE
  METER_ISSUE
  AGREEMENT_WITH_RESIDENT
  ADMIN_WAIVER
  OTHER
```

## 13.2 organizations

```text
organizations
- id uuid PK
- name text NOT NULL
- registration_number text NULL
- vat_number text NULL
- address_line1 text NOT NULL
- address_line2 text NULL
- city text NULL
- postal_code text NULL
- country_code char(2) NOT NULL DEFAULT 'LV'
- email text NULL
- phone text NULL
- bank_name text NULL
- iban text NULL
- bic text NULL
- currency char(3) NOT NULL DEFAULT 'EUR'
- timezone text NOT NULL DEFAULT 'Europe/Riga'
- locale text NOT NULL DEFAULT 'lv'
- invoice_prefix text NOT NULL DEFAULT 'INV'
- default_due_days integer NOT NULL DEFAULT 14
- auto_generate_enabled boolean DEFAULT false
- auto_send_enabled boolean DEFAULT false
- auto_send_day smallint NULL
- created_at timestamptz
- updated_at timestamptz
- archived_at timestamptz NULL
```

Constraints:
- `default_due_days` 0..120
- `auto_send_day` 1..28 when present

## 13.3 organization_memberships

```text
organization_memberships
- organization_id uuid FK
- user_id uuid FK app_users
- created_at
PRIMARY KEY (organization_id, user_id)
```

Only `ADMIN` users may have active organization membership.

## 13.4 dwellings

```text
dwellings
- id uuid PK
- organization_id uuid FK NOT NULL
- type dwelling_type NOT NULL DEFAULT APARTMENT
- number text NOT NULL
- display_name text NULL
- occupant_name text NULL
- billing_name text NULL
- billing_email text NULL
- billing_address text NULL
- area_m2 numeric(10,2) NOT NULL DEFAULT 0
- resident_count integer NOT NULL DEFAULT 0
- notes text NULL
- created_at
- updated_at
- archived_at NULL
UNIQUE (organization_id, number)
```

## 13.5 dwelling_access

```text
dwelling_access
- dwelling_id uuid FK
- user_id uuid FK app_users
- created_at
PRIMARY KEY (dwelling_id, user_id)
```

Only `RESIDENT` users may normally be assigned.

## 13.6 meters

```text
meters
- id uuid PK
- organization_id uuid FK
- dwelling_id uuid FK
- type meter_type
- serial_number text NULL
- unit text NOT NULL
- label text NULL
- installed_at date NULL
- archived_at timestamptz NULL
- created_at
```

`organization_id` must equal the dwelling organization.

## 13.7 billing_periods

```text
billing_periods
- id uuid PK
- organization_id uuid FK
- year integer
- month smallint
- starts_on date
- ends_on date
- reading_deadline date NULL
- invoice_issue_date date
- invoice_due_date date
- status OPEN|LOCKED
- locked_at timestamptz NULL
- created_at
UNIQUE (organization_id, year, month)
```

## 13.8 meter_readings

```text
meter_readings
- id uuid PK
- organization_id uuid FK
- period_id uuid FK
- meter_id uuid FK
- previous_value numeric(14,3) NULL
- current_value numeric(14,3) NOT NULL
- consumption numeric(14,3) NOT NULL
- source reading_source
- submitted_by_user_id uuid NULL
- submitted_at timestamptz
- note text NULL
UNIQUE (period_id, meter_id)
```

## 13.9 billing_rules

```text
billing_rules
- id uuid PK
- organization_id uuid FK
- name text
- code text
- description text NULL
- calculation_type enum
- meter_type enum NULL
- unit text
- unit_price numeric(14,4) NULL
- vat_rate numeric(7,4) DEFAULT 0
- effective_from date
- effective_until date NULL
- sort_order integer DEFAULT 0
- enabled boolean DEFAULT true
- created_at
- updated_at
- archived_at NULL
UNIQUE (organization_id, code)
```

## 13.10 billing_cases

`billing_case` owns the monthly workflow status.

```text
billing_cases
- id uuid PK
- organization_id uuid FK
- period_id uuid FK
- dwelling_id uuid FK
- status billing_case_status DEFAULT MISSING_DATA
- missing_data jsonb DEFAULT []
- manual_status_override boolean DEFAULT false
- status_updated_at timestamptz
- created_at
UNIQUE (period_id, dwelling_id)
```

Do not put `MISSING_DATA` solely on invoices because an invoice does not yet exist.

## 13.11 invoices

```text
invoices
- id uuid PK
- organization_id uuid FK
- billing_case_id uuid FK UNIQUE
- dwelling_id uuid FK
- period_id uuid FK
- invoice_number text NOT NULL
- issue_date date NOT NULL
- due_date date NOT NULL
- currency char(3) NOT NULL
- subtotal numeric(14,2) NOT NULL
- vat_total numeric(14,2) NOT NULL
- total numeric(14,2) NOT NULL
- current_charges numeric(14,2) NOT NULL DEFAULT 0
- previous_outstanding numeric(14,2) NOT NULL DEFAULT 0
- previous_credit_applied numeric(14,2) NOT NULL DEFAULT 0
- late_fee_calculated numeric(14,2) NOT NULL DEFAULT 0
- late_fee_adjustment numeric(14,2) NOT NULL DEFAULT 0
- late_fee_applied numeric(14,2) NOT NULL DEFAULT 0
- manual_adjustment numeric(14,2) NOT NULL DEFAULT 0
- amount_due numeric(14,2) NOT NULL DEFAULT 0
- remaining_credit numeric(14,2) NOT NULL DEFAULT 0
- balance_snapshot jsonb NOT NULL DEFAULT {}
- penalty_snapshot jsonb NOT NULL DEFAULT {}
- manual_adjustment_snapshot jsonb NOT NULL DEFAULT {}
- issuer_snapshot jsonb NOT NULL
- recipient_snapshot jsonb NOT NULL
- payment_snapshot jsonb NOT NULL
- template_snapshot jsonb NOT NULL
- version integer NOT NULL DEFAULT 1
- prepared_at timestamptz NULL
- sent_at timestamptz NULL
- paid_at timestamptz NULL
- pdf_object_key text NULL
- pdf_sha256 text NULL
- created_at timestamptz NOT NULL
- updated_at timestamptz NOT NULL
UNIQUE (organization_id, invoice_number)
CHECK (current_charges >= 0 and previous_outstanding >= 0 and previous_credit_applied >= 0 and late_fee_calculated >= 0 and late_fee_applied >= 0 and amount_due >= 0 and remaining_credit >= 0)
CHECK (late_fee_applied = late_fee_calculated + late_fee_adjustment)
CHECK (amount_due = greatest(current_charges + previous_outstanding - previous_credit_applied + late_fee_applied + manual_adjustment, 0))
```

## 13.12 invoice_lines

```text
invoice_lines
- id uuid PK
- organization_id uuid FK
- invoice_id uuid FK
- billing_rule_id uuid NULL
- sort_order integer
- description text
- calculation_type enum
- source_snapshot jsonb
- unit text NULL
- quantity numeric(14,4) NULL
- unit_price numeric(14,4) NULL
- vat_rate numeric(7,4)
- net_amount numeric(14,2)
- vat_amount numeric(14,2)
- gross_amount numeric(14,2)
```

## 13.13 invoice_access_tokens

```text
invoice_access_tokens
- id uuid PK
- organization_id uuid
- invoice_id uuid
- token_hash text UNIQUE
- expires_at timestamptz NULL
- revoked_at timestamptz NULL
- created_at
```

Raw token is never stored.

## 13.14 invoice_deliveries

```text
invoice_deliveries
- id uuid PK
- organization_id uuid
- invoice_id uuid
- method delivery_method NOT NULL DEFAULT EMAIL
- destination_email text NULL
- provider text
- provider_message_id text NULL
- status text
- error_code text NULL
- sent_at timestamptz NULL
- created_at
```

## 13.15 invoice_templates

```text
invoice_templates
- id uuid PK
- organization_id uuid UNIQUE
- logo_object_key text NULL
- header_text text NULL
- footer_text text NULL
- payment_instructions text NULL
- default_note text NULL
- config jsonb DEFAULT {}
- updated_at
```

## 13.16 bank_imports

```text
bank_imports
- id uuid PK
- organization_id uuid
- original_filename text
- file_sha256 text
- imported_by_user_id uuid
- imported_at
- row_count integer
UNIQUE (organization_id, file_sha256)
```

## 13.17 bank_transactions

```text
bank_transactions
- id uuid PK
- organization_id uuid
- bank_import_id uuid
- external_transaction_id text NULL
- booking_date date
- amount numeric(14,2)
- currency char(3)
- payer_name text NULL
- payer_account text NULL
- reference text NULL
- raw_data jsonb
- row_number integer
```

## 13.18 payment_matches

```text
payment_matches
- id uuid PK
- organization_id uuid FK
- bank_transaction_id uuid FK
- invoice_id uuid FK
- match_type payment_match_type NOT NULL
- result_type payment_result_type NOT NULL DEFAULT EXACT
- proposed_allocation_amount numeric(14,2) NOT NULL DEFAULT 0
- status payment_match_status NOT NULL DEFAULT PROPOSED
- confidence numeric(5,4) NULL
- confirmed_by_user_id uuid FK NULL
- confirmed_at timestamptz NULL
- created_at timestamptz NOT NULL
UNIQUE (bank_transaction_id, invoice_id)
```

## 13.19 conversations/messages

```text
conversations
- id uuid PK
- organization_id uuid
- dwelling_id uuid
- subject text
- status NEW|OPEN|RESOLVED
- created_by_user_id uuid
- created_at
- updated_at
- resolved_at NULL

messages
- id uuid PK
- organization_id uuid
- conversation_id uuid
- sender_user_id uuid
- body text
- created_at
- read_at NULL
```

## 13.20 audit_logs

```text
audit_logs
- id uuid PK
- organization_id uuid NULL
- actor_user_id uuid NULL
- action text
- entity_type text
- entity_id uuid NULL
- before_data jsonb NULL
- after_data jsonb NULL
- request_id text NULL
- ip_hash text NULL
- created_at
```

Index:
`(organization_id, created_at DESC)`

## 13.21 account_entries

Append-only journal of financial movements scoped to a dwelling.

```text
account_entries
- id uuid PK
- organization_id uuid FK
- dwelling_id uuid FK
- effective_date date NOT NULL
- type account_entry_type NOT NULL
- debit numeric(14,2) NOT NULL DEFAULT 0
- credit numeric(14,2) NOT NULL DEFAULT 0
- currency char(3) NOT NULL
- invoice_id uuid FK NULL
- bank_transaction_id uuid FK NULL
- reason text NULL
- description text NOT NULL
- actor_user_id uuid FK NULL
- metadata jsonb NOT NULL DEFAULT {}
- idempotency_key text NOT NULL UNIQUE
- created_at timestamptz NOT NULL
UNIQUE (idempotency_key)
CHECK ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
```

Indexes:
- `(organization_id, dwelling_id, effective_date, created_at)`
- `(invoice_id)`
- `(bank_transaction_id)`

Trigger: `account_entries_append_only` prevents UPDATE and DELETE.

## 13.22 payment_allocations

Append-only link recording which portion of a bank transaction settled an invoice.

```text
payment_allocations
- id uuid PK
- organization_id uuid FK
- dwelling_id uuid FK
- bank_transaction_id uuid FK
- invoice_id uuid FK
- allocated_amount numeric(14,2) NOT NULL
- allocation_date timestamptz NOT NULL DEFAULT now()
- method payment_allocation_method NOT NULL
- actor_user_id uuid FK NULL
- idempotency_key text NOT NULL UNIQUE
- created_at timestamptz NOT NULL
UNIQUE (idempotency_key)
UNIQUE (bank_transaction_id, invoice_id)
CHECK (allocated_amount > 0)
```

Index: `(organization_id, invoice_id)`

Trigger: `payment_allocations_append_only` prevents UPDATE and DELETE.

## 13.23 late_fee_policies

Organization-level policy defining daily penalty rates, grace periods, and caps.

```text
late_fee_policies
- id uuid PK
- organization_id uuid FK
- effective_from date NOT NULL
- enabled boolean NOT NULL DEFAULT false
- daily_rate numeric(9,6) NOT NULL DEFAULT 0
- grace_days integer NOT NULL DEFAULT 0
- start_rule late_fee_start_rule NOT NULL DEFAULT DAY_AFTER_DUE_DATE
- max_penalty_percent numeric(7,4) NOT NULL DEFAULT 0
- stops_at_cap boolean NOT NULL DEFAULT true
- actor_user_id uuid FK NULL
- created_at timestamptz NOT NULL
UNIQUE (organization_id, effective_from)
CHECK (daily_rate >= 0 and grace_days >= 0 and max_penalty_percent >= 0)
```

Index: `(organization_id, effective_from DESC)`

## 13.24 late_fee_adjustments

Append-only record of admin waivers and adjustments to invoice late fees.

```text
late_fee_adjustments
- id uuid PK
- organization_id uuid FK
- invoice_id uuid FK
- calculated_amount numeric(14,2) NOT NULL
- prior_applied_amount numeric(14,2) NOT NULL
- new_applied_amount numeric(14,2) NOT NULL
- adjustment_amount numeric(14,2) NOT NULL
- reason late_fee_adjustment_reason NOT NULL
- note text NULL
- actor_user_id uuid FK NOT NULL
- created_at timestamptz NOT NULL
CHECK (calculated_amount >= 0 and prior_applied_amount >= 0 and new_applied_amount >= 0 and adjustment_amount = new_applied_amount - prior_applied_amount)
CHECK (reason <> 'OTHER' or length(trim(coalesce(note, ''))) > 0)
```

Index: `(organization_id, invoice_id, created_at DESC)`

Trigger: `late_fee_adjustments_append_only` prevents UPDATE and DELETE.

---

# 14. Database access policy and financial invariants

## 14.1 Repository tenant scoping

Use repositories that require tenant scope explicitly.

Bad:

```ts
getInvoice(invoiceId)
```

Preferred:

```ts
getAdminInvoice({
  organizationId,
  invoiceId,
});
```

Resident:

```ts
getResidentInvoice({
  userId,
  invoiceId,
});
```

Repository calls that retrieve organization-owned resources without a tenant/access parameter should be exceptional and private to narrowly controlled domain code.

## 14.2 Append-only financial ledger semantics

The database enforces append-only semantics for financial journals at the engine level:

- The PostgreSQL function `prevent_financial_history_mutation()` raises an exception on any attempt to execute `UPDATE` or `DELETE` against:
  - `account_entries`
  - `payment_allocations`
  - `late_fee_adjustments`
- Financial corrections are never made by editing existing rows. Instead, compensating entries with fresh idempotency keys must be inserted:
  - Dwelling account corrections: Post a `MANUAL_ADJUSTMENT` debit or credit entry via `createDwellingAccountAdjustment`.
  - Invoice late-fee adjustments: Recorded as `late_fee_adjustments` before preparation/issuance.
- Single-sided invariant: Every `account_entries` row must have exactly one non-zero side (`(debit > 0 and credit = 0) or (credit > 0 and debit = 0)`).

## 14.3 Database financial constraints and identities

The database schema enforces financial integrity via PostgreSQL `CHECK` constraints:

1. **Non-negative components**:
   `CHECK (current_charges >= 0 and previous_outstanding >= 0 and previous_credit_applied >= 0 and late_fee_calculated >= 0 and late_fee_applied >= 0 and amount_due >= 0 and remaining_credit >= 0)`
2. **Late-fee reconciliation**:
   `CHECK (late_fee_applied = late_fee_calculated + late_fee_adjustment)`
3. **Amount due formula**:
   `CHECK (amount_due = greatest(current_charges + previous_outstanding - previous_credit_applied + late_fee_applied + manual_adjustment, 0))`
4. **Late-fee adjustment delta**:
   `CHECK (adjustment_amount = new_applied_amount - prior_applied_amount)`
5. **Positive allocation amount**:
   `CHECK (allocated_amount > 0)`

Use database transactions for:

- invoice numbering + generation;
- invoice preparation, snapshotting, and ledger posting;
- payment match confirmation, dwelling ledger crediting, and allocation;
- bank statement import;
- access assignment where account provisioning is involved.

---

# 15. Authentication flows

## 15.1 resident magic link

Flow:

```text
/login
  ↓
resident enters email
  ↓
POST /api/v1/auth/request-link
  ↓
neutral 202 response
  ↓
Supabase Auth magic link
  ↓
/auth/confirm?token_hash=...&type=...
  ↓
server verifies OTP
  ↓
SSR session cookie
  ↓
/portal
```

Requirements:

- `shouldCreateUser: false` for ordinary resident login;
- resident must be provisioned by admin/access assignment first;
- neutral response for unknown/known email;
- rate-limit endpoint;
- custom auth email flow must avoid accidental consumption by link scanners where practical;
- redirect URL allow-list must be explicit;
- use PKCE/SSR-compatible verification;
- session must be available to Astro SSR.

## 15.2 admin auth

Admin uses:

```text
email + password/passkey-capable auth
        ↓
MFA
        ↓
AAL2 required for admin area
```

At production readiness, `/admin/**` requires an admin session satisfying configured MFA assurance.

If initial development temporarily permits AAL1, this must be feature-flagged and forbidden in production.

## 15.3 middleware

`src/middleware.ts` should:

- create SSR Supabase client;
- resolve authenticated identity for protected paths;
- load `app_users`;
- attach minimal typed auth context to `locals`;
- redirect anonymous requests;
- reject disabled users;
- avoid database-heavy authorization globally where route-level authorization is more precise.

Never trust a client-provided role.

---

# 16. Billing period rules

Exactly one billing period per organization/year/month.

Period creation transaction:

1. create period;
2. select every active dwelling;
3. create one billing case for each;
4. determine required readings/data;
5. set `MISSING_DATA` or generation-ready state.

`LOCKED` period blocks:

- normal reading edits;
- invoice regeneration;
- rule input edits that would mutate period outcome.

Historical viewing remains available.

---

# 17. Meter reading rules

For cumulative meter:

```text
consumption = current_value - previous_value
```

Rules:

- numeric, max 3 decimals;
- current >= 0;
- current normally >= previous;
- resident cannot submit to archived meter;
- resident can only submit for assigned dwelling;
- resident can only submit in permitted/open period;
- one reading per meter/period;
- previous reading is most recent prior accepted reading;
- lower current value needs explicit admin reset/replacement flow;
- every update audited;
- successful resident reading appears immediately in admin workbench.

Do not use JS binary floating-point for persisted calculations.

---

# 18. Billing rules

Supported v1 calculations:

## FIXED

```text
quantity = 1
```

## AREA

```text
quantity = dwelling.area_m2
```

## RESIDENT_COUNT

```text
quantity = dwelling.resident_count
```

## METER_CONSUMPTION

```text
quantity = period consumption for configured meter type
```

## MANUAL_QUANTITY

Admin supplies quantity.

## MANUAL_AMOUNT

Admin supplies amount according to defined UI semantics.

Calculation:

```text
net = ROUND(quantity × unit_price, 2)
vat = ROUND(net × vat_rate / 100, 2)
gross = net + vat
```

Use one centralized Decimal implementation and test it heavily.

---

# 19. Billing state machine

Canonical `billing_case.status`:

```text
MISSING_DATA
     │
     │ readings & manual inputs complete
     ▼
   READY
     │
     │ generate invoice
     ▼
   DRAFT
     │
     │ prepare (resolves financials, snapshots statement, posts ledger charges)
     ▼
  PREPARED
     │
     │ at least one successful delivery (email or paper)
     ▼
    SENT
   ┌─┴────────────────────────┐
   │                          │
payment allocated       due date passes
   │                          │
   ▼                          ▼
(fully settled?)           OVERDUE
 ├── Yes → PAID               │
 └── No  → remains SENT       │ payment allocated
                              ▼
                       (fully settled?)
                        ├── Yes → PAID
                        └── No  → remains OVERDUE
```

Rules:

- `MISSING_DATA`: required meter readings or manual rule inputs are missing; invoice cannot be generated.
- `READY`: all required inputs exist; eligible for generation.
- `DRAFT`: invoice exists and may be regenerated; late fee and manual adjustments may be set.
- `PREPARED`: invoice is finalized and approved for sending:
  - Statement financials are re-resolved against the dwelling account ledger and effective late-fee policy;
  - `balance_snapshot` and `penalty_snapshot` are frozen;
  - `current_charges` are debited to the dwelling account (`INVOICE_CHARGE`);
  - `late_fee_applied` is debited to the dwelling account (`LATE_FEE`), if greater than zero;
  - `manual_adjustment` is posted to the dwelling account (`MANUAL_ADJUSTMENT`), if non-zero;
  - Once prepared, financial fields can no longer be edited.
- `SENT`: at least one delivery method (email or paper) succeeded.
- `OVERDUE`: sent, unpaid (`paid_at IS NULL`), and local due date has passed.
- `PAID`: confirmed payment allocations equal the invoice's `amount_due`, or an explicit audited admin status override is recorded.

Partial payment rule:
When a payment allocation is less than the invoice's remaining unpaid balance, the allocation reduces the outstanding balance, but the invoice and case **remain in `SENT` or `OVERDUE`** until full settlement.

Manual admin status override is allowed but requires confirmation, an audited reason, and does not bypass ledger constraints.

---

# 20. Invoice generation and statement balance resolution

Invoice generation calculates current-period line items and resolves statement financials against the dwelling's financial account:

## 20.1 Generation workflow

Generation must:

1. authorize admin organization;
2. lock the billing case and organization row to serialize invoice-number sequencing;
3. validate that no missing data remains for the dwelling;
4. select effective billing rules for the period;
5. calculate line items using Decimal (`current_charges = subtotal + vat_total`);
6. resolve statement financials against the dwelling account ledger (`resolveStatementFinancials`);
7. snapshot dwelling/recipient, issuer, payment, and template configurations;
8. allocate a unique, monotonic invoice number (`{PREFIX}-{YYYY}{MM}-{SEQUENCE}`);
9. persist invoice + lines transactionally;
10. update billing case to `DRAFT`;
11. audit event (`INVOICE_GENERATED` or `INVOICE_REGENERATED`).

Generation is idempotent. Regenerating a draft invoice replaces lines and updates snapshots in place without changing the invoice number or ID.

## 20.2 Statement balance calculation

Statement financials are derived by `calculateStatementBalance` using exact decimal arithmetic:

```text
accountBalance = sum(debit - credit) from account_entries for dwelling and currency
previousOutstanding = max(accountBalance, 0.00)
availableCredit = max(-accountBalance, 0.00)

beforeCredit = currentCharges + previousOutstanding + lateFee + manualAdjustment
positiveBeforeCredit = max(beforeCredit, 0.00)

previousCreditApplied = min(availableCredit, positiveBeforeCredit)
amountDue = max(positiveBeforeCredit - previousCreditApplied, 0.00)

adjustmentCredit = max(-beforeCredit, 0.00)
remainingCredit = (availableCredit - previousCreditApplied) + adjustmentCredit
```

Financial invariant enforced in the database:
`amount_due = greatest(current_charges + previous_outstanding - previous_credit_applied + late_fee_applied + manual_adjustment, 0)`

## 20.3 Late-fee calculation

Late fees are calculated by `calculateLateFee` when an organization has an active `late_fee_policies` row:

- **Principal**: `max(accountBalance, 0.00)` (the dwelling's outstanding debt).
- **Overdue anchor**: Due date of the oldest unpaid invoice in `PREPARED`, `SENT`, or `OVERDUE` status where `due_date < issue_date`.
- **First penalty date**: `due_date + grace_days + 1 day`.
- **Overdue days**: Days elapsed from first penalty date to `issue_date` (minimum 0).
- **Raw penalty**: `percentForDays(principal, daily_rate, overdueDays, 2)`.
- **Cap amount**: `percentOf(principal, max_penalty_percent, 2)`.
- **Applied amount**: `stops_at_cap ? min(rawAmount, capAmount) : rawAmount`.

---

# 21. Invoice immutability and financial snapshots

## 21.1 Snapshot rationale

Invoices are legal and fiscal instruments. Once prepared and sent to residents:

- Financial fields and line items are **immutable**;
- The canonical PDF is frozen in private storage;
- Subsequent tariff changes, dwelling configuration edits, or organization updates do not alter past invoices;
- Later payments or account adjustments affect the dwelling ledger, but **never rewrite past invoice snapshots**.

## 21.2 Financial snapshot fields

The `invoices` table stores explicit snapshot fields:

- `current_charges`: Total gross charges for the period lines (`subtotal + vat_total`);
- `previous_outstanding`: Unpaid debt carried forward at preparation time;
- `previous_credit_applied`: Dwelling credit consumed by this statement;
- `late_fee_calculated`, `late_fee_adjustment`, `late_fee_applied`: Policy penalty and admin adjustment;
- `manual_adjustment`: Specific manual adjustment attached to this invoice before preparation;
- `amount_due`: Net payable total on this invoice;
- `remaining_credit`: Credit balance remaining on the dwelling account after applying credit to this invoice;
- `balance_snapshot`: Structured JSON snapshot `{ accountBalance, previousOutstanding, previousCreditApplied, remainingCredit, sourceInvoice }`;
- `penalty_snapshot`: Structured JSON snapshot of policy configuration and penalty breakdown;
- `manual_adjustment_snapshot`: Structured JSON snapshot `{ reason, note, actorUserId }`.

## 21.3 Distinguishing account balance concepts

The domain strictly distinguishes:

1. **Dwelling Account Current Balance**: Live sum of debits minus credits across all ledger entries (`getDwellingAccountBalance`). A positive balance represents debt owed; a negative balance represents available credit.
2. **Invoice Historical Financial Snapshot**: Fixed financial state frozen on the invoice row when prepared.
3. **Invoice Remaining Unpaid Balance**: `amount_due - sum(allocated_amount)` from `payment_allocations` for this invoice. Indicates what is currently owed specifically on this invoice document.
4. **Available Account Credit**: Excess credit on the dwelling account (`max(-accountBalance, 0.00)`), carried forward to reduce future statements.

Integration test must prove:

```text
send invoice
→ change tariff
→ reload old invoice
→ line amounts unchanged
→ PDF hash unchanged
```

---

# 22. PDF generation

Use a deterministic server-side invoice HTML template.

Flow:

```text
invoice snapshot
      ↓
render controlled HTML
      ↓
Cloudflare Browser Run /pdf
      ↓
PDF bytes
      ↓
SHA-256
      ↓
Supabase private Storage
      ↓
pdf_object_key + pdf_sha256
```

Requirements:

- do not render arbitrary user-provided remote URLs;
- invoice HTML must not execute untrusted script;
- canonical sent invoice PDF generated from persisted snapshot;
- private bucket;
- no guessable public URL;
- authenticated downloads authorize first;
- email token access resolves only its specific invoice.

Preferred storage layout:

```text
invoices/{organizationId}/{year}/{month}/{invoiceId}/v1.pdf
```

---

# 23. Invoice email delivery

Email includes:

- organization;
- billing period;
- invoice number;
- total;
- due date;
- "View invoice";
- "Open resident portal".

No attachment by default in v1.

Sending:

- normally only from `PREPARED`;
- idempotent command;
- explicit resend creates a new delivery attempt;
- successful first delivery sets `SENT`;
- failed delivery retains `PREPARED` if none succeeded;
- provider response stored;
- sensitive provider errors not exposed to resident.

---

# 24. Invoice access token

Public email link must not expose raw invoice UUID alone.

Generate at send:

```text
random 256-bit token
→ store SHA-256/token hash
→ email raw token
```

Token resolves:

```text
/invoice/access/[token]
```

Rules:

- token only grants read access to one invoice;
- no portal/session elevation;
- token may be revoked;
- expiration configurable;
- authorization by token hash comparison;
- token never logged.

Resident authenticated portal access remains separate.

---

# 25. Bank CSV reconciliation and payment allocation

Import workflow:

```text
Upload CSV
→ parse & validate headers
→ preview row statuses (OK / ERROR)
→ confirm import
→ persist bank_import & bank_transactions
→ propose payment matches
```

Never write immediately on file selection.

Normalized transaction:

```text
external_transaction_id?
booking_date
amount
currency
payer_name?
payer_account?
reference?
```

## 25.1 Matching proposals against remaining balance

Matching evaluates bank transactions against the **remaining unpaid balance** of candidate invoices, not merely their original face value:

1. **Candidate selection**:
   - Matches organization and currency;
   - Invoice is unpaid (`paid_at IS NULL`);
   - Billing case status is in `PREPARED`, `SENT`, or `OVERDUE`;
   - Remaining balance is positive: `remaining = amount_due - sum(allocated_amount) > 0`.
2. **Reference matching**:
   - Case-insensitive and whitespace-insensitive: `normalize(txn.reference)` contains `normalize(invoice.invoice_number)`;
   - Must match exactly one candidate invoice (ambiguous references remain unmatched).
3. **Result type classification**:
   - `txn.amount == remaining`: `EXACT` (match type `AUTO_EXACT`, confidence 1.0000);
   - `txn.amount < remaining`: `PARTIAL` (match type `AUTO_PROBABLE`, confidence 0.9000);
   - `txn.amount > remaining`: `OVERPAYMENT` (match type `AUTO_PROBABLE`, confidence 0.9000).
4. **Proposed allocation amount**:
   `proposed_allocation_amount = min(txn.amount, remaining)`.

Transactions with no reference or no unique matching candidate remain in the unmatched pool (`listUnmatchedTransactions`).

## 25.2 Confirmation and allocation lifecycle

Admin confirms proposed or manual matches transactionally:

```text
lock match + bank transaction + invoice
→ verify invoice not already paid and remaining balance > 0
→ post full transaction credit to dwelling ledger (account_entries, type PAYMENT)
→ insert payment_allocations record for min(txn.amount, remaining)
→ update payment_matches to CONFIRMED
→ if fully settled (allocated_amount == remaining):
    set invoice paid_at = now()
    set billing case status = PAID
→ audit event (PAYMENT_MATCH_CONFIRMED, PAYMENT_PARTIALLY_ALLOCATED, or PAYMENT_OVERPAYMENT_ALLOCATED)
→ if overpayment: emit ACCOUNT_CREDIT_CREATED for excess credit
→ commit
```

### Partial payments

- The allocated amount reduces the invoice's remaining unpaid balance (`amount_due - sum(allocated_amount)`).
- The invoice `paid_at` column remains `NULL`.
- The billing case status remains in `SENT` or `OVERDUE`.
- Subsequent bank transactions referencing the invoice will be matched against the updated remaining balance until fully settled.

### Overpayments

- The invoice is allocated up to its remaining balance and transitions to `paid_at = now()` and case `PAID`.
- Because the dwelling ledger is credited with the full transaction amount (`type: PAYMENT`), the excess unallocated funds (`txn.amount - allocated_amount`) remain on the dwelling account as an available credit balance (`accountBalance < 0`).
- This credit is carried forward and automatically consumed by future invoices (`previous_credit_applied`).

### Match rejection

An admin may reject a proposed match (`rejectMatch`). An already-confirmed match cannot be rejected (unwinding confirmed payments is not supported; corrections require compensating manual adjustment entries).

Duplicate bank files:
Enforced via `UNIQUE (organization_id, file_sha256)`.

---

# 26. CSV dwelling import

Logical columns:

```text
number
type
display_name
occupant_name
billing_name
billing_email
billing_address
area_m2
resident_count
cold_water_meter_serial
hot_water_meter_serial
```

UX:

```text
upload
→ detect encoding/delimiter
→ map
→ validate
→ preview create/update/error
→ confirm
→ import
→ result/error report
```

Default mode: create only.

Update mode:
- explicit;
- match by `organization_id + dwelling.number`.

Protect exports against spreadsheet formula injection in user-controlled text.

---

# 27. Admin page requirements

## Dashboard

`/admin/o/[orgId]/dashboard`

Show:
- current/selected period;
- total invoiced;
- paid;
- outstanding;
- cold/hot consumption;
- case status counts;
- work requiring attention.

## Monthly workbench

`/admin/o/[orgId]/periods/[periodId]`

Required:
- previous/next period;
- summary KPIs;
- search;
- status filter;
- bulk selection;
- generate;
- prepare;
- send;
- dwelling rows;
- reading input where missing;
- reading source;
- current case status;
- invoice total/actions;
- clear error/success feedback.

Default sort:
1. MISSING_DATA
2. DRAFT
3. PREPARED
4. OVERDUE
5. SENT
6. PAID
then natural dwelling number.

## Dwellings

List:
- search/filter;
- create;
- archive;
- CSV import/export;
- pagination.

Detail:
- overview;
- account balance (balance KPI card, total debits/credits, append-only journal table with running balance, and manual adjustment action);
- resident access;
- meters;
- billing history;
- messages;
- audit.

Do not hard-delete a dwelling with financial history.

## Settings

Provide:
- organization (legal/tax/bank details);
- billing (currency, timezone, locale, and late-fee policy configuration: daily rate, grace days, penalty cap);
- tariffs/rules;
- invoice template (branding, notes, instructions);
- users/access;
- data/import/export.

## Payments

Show:
- imports;
- unmatched transactions;
- proposed matches with:
  - match type (`AUTO_EXACT`, `AUTO_PROBABLE`, `MANUAL`);
  - result type (`EXACT`, `PARTIAL`, `OVERPAYMENT`);
  - proposed allocation amount;
  - remaining invoice balance after allocation;
  - credit created;
  - confirm and reject actions;
- confirmed matches;
- rejected matches;
- import detail.

## Messages

Show:
- new/open/resolved;
- dwelling identity;
- thread;
- reply;
- resolve.

---

# 28. Resident page requirements

Resident UX is mobile-first.

## `/portal`

If one dwelling:
redirect to it.

If multiple:
show dwelling selector.

## Dwelling dashboard

Show:
- dwelling number/address;
- current period;
- current invoice:
  - outstanding payable balance (net of partial payment allocations);
  - previous balance carried forward;
  - credit applied;
  - late fee applied;
  - remaining account credit;
  - due date and status badge;
- cold/hot reading state;
- submission form when allowed;
- consumption history;
- recent invoice history;
- contact/message action.

## Invoice history

Show period, number, amount due, due date, status.

## Invoice detail

Show:
- issuer;
- recipient;
- invoice metadata;
- line items;
- statement financial breakdown (current charges, previous outstanding, credit applied, late fee, manual adjustment, amount due);
- payment bank details;
- download PDF;
- print.
No admin controls.

---

# 29. UI architecture

Use Astro server-rendered components for most UI.

Good Astro candidates:

```text
AdminLayout.astro
ResidentLayout.astro
Sidebar.astro
Breadcrumbs.astro
KpiCard.astro
InvoiceView.astro
InvoiceLineTable.astro
DwellingSummary.astro
EmptyState.astro
```

Use React islands for interaction-heavy pieces:

```text
BillingWorkbenchTable.tsx
BulkInvoiceToolbar.tsx
StatusFilter.tsx
MeterReadingEditor.tsx
ConsumptionChart.tsx
CsvImportMapper.tsx
PaymentMatchReview.tsx
Dialog/Combobox components
```

Hydration directives must be intentional.

Prefer:
- `client:visible`
- `client:idle`
- `client:load`

only when appropriate.

Do not hydrate static text/layout.

---

# 30. Localization

Initial UI languages:

- Latvian (`lv`)
- English (`en`)

Internal identifiers/code remain English.

Requirements:
- locale-aware currency;
- organization timezone-aware dates;
- translated billing statuses;
- translated validation messages where practical;
- invoices may select organization/default recipient language later.

Do not hardcode Latvia-specific display strings directly throughout components.

---

# 31. Audit events

At minimum:

```text
ORGANIZATION_CREATED
ORGANIZATION_UPDATED
ADMIN_MEMBERSHIP_ADDED
ADMIN_MEMBERSHIP_REMOVED

DWELLING_CREATED
DWELLING_UPDATED
DWELLING_ARCHIVED
DWELLING_ACCESS_ADDED
DWELLING_ACCESS_REMOVED

METER_CREATED
METER_UPDATED
METER_ARCHIVED
READING_CREATED
READING_UPDATED

PERIOD_CREATED
PERIOD_LOCKED

BILLING_RULE_CREATED
BILLING_RULE_UPDATED

INVOICE_GENERATED
INVOICE_PREPARED
INVOICE_SENT
INVOICE_SEND_FAILED
INVOICE_RESENT
BILLING_STATUS_OVERRIDDEN

BANK_IMPORT_CREATED
PAYMENT_MATCH_PROPOSED
PAYMENT_MATCH_CONFIRMED
PAYMENT_MATCH_REJECTED
PAYMENT_PARTIALLY_ALLOCATED
PAYMENT_OVERPAYMENT_ALLOCATED
ACCOUNT_CREDIT_CREATED

LATE_FEE_POLICY_CREATED
LATE_FEE_ADJUSTED
ACCOUNT_ADJUSTMENT_CREATED

CONVERSATION_CREATED
MESSAGE_SENT
CONVERSATION_RESOLVED
```

Audit writes that belong to a financial transaction should be committed in the same DB transaction when possible.

---

# 32. Scheduled jobs

Cloudflare Cron invokes a single scheduler entry point. Domain code decides which organization jobs are due.

Required jobs:

```text
billing-overdue-scan
auto-invoice-generate
auto-invoice-send
```

Optional:
```text
period-create
```

Cron runs in UTC. Organization billing decisions use `organizations.timezone`, normally `Europe/Riga`.

Jobs must be:

- idempotent;
- retry-safe;
- scoped;
- observable;
- non-duplicating.

Auto-send:
- sends `PREPARED` only;
- never sends `DRAFT`;
- respects organization setting.

---

# 33. Security requirements

Production blockers:

- server-side authorization on every protected resource;
- explicit cross-tenant tests;
- explicit cross-resident tests;
- HTTPS only;
- secure cookie configuration;
- PKCE SSR auth flow;
- MFA/AAL2 for admin;
- input validation;
- output escaping;
- parameterized Drizzle queries;
- no service secret exposed to browser;
- private Storage;
- auth/public token rate limiting;
- token values removed/redacted from logs;
- audit sensitive mutations;
- CSP appropriate to application;
- dependency scanning;
- restore-tested backups;
- database migration rollback/forward strategy documented.

High-risk failure to test:

```text
Resident A knows Resident B's valid invoice UUID.
Resident A requests it.
Expected: denied without revealing useful foreign metadata.
```

Same for Admin A / Org B.

UUIDs do not replace access control.

---

# 34. Supabase security boundary

Use Supabase Auth for identity/session.

Application authorization is mandatory even if RLS is introduced.

The main Drizzle connection is a server-side database connection through Hyperdrive. It must use a dedicated least-privilege Postgres role rather than the top-level `postgres` role when production is configured.

Do not query the database directly from browser clients for financial domain operations.

Browser Supabase client may be used only for auth/session interactions that require it.

No browser-side direct table mutation for:

- invoices;
- readings;
- billing rules;
- bank transactions;
- access assignments;
- audit records.

---

# 35. User stories + acceptance criteria

## AUTH-001 Resident requests magic link

**As a resident, I can request secure access without a password.**

Accept:
- known resident email returns neutral success;
- unknown email returns identical public response;
- unknown email does not auto-create resident;
- link targets allowed app URL;
- endpoint rate-limited;
- no raw auth token logged.

## AUTH-002 Resident confirmation

Accept:
- valid token creates SSR session;
- expired/used invalid;
- resident lands at `/portal`;
- cannot create admin session or admin privileges.

## AUTH-003 Admin isolation

Accept:
- admin cannot access unknown/unassigned org using known valid UUID;
- all admin route/action classes tested.

---

## ORG-001 Create organization

Accept:
- required name/address;
- creator receives membership;
- EUR, Europe/Riga, lv defaults;
- persists after reload;
- audit event.

## ORG-002 Update organization

Accept:
- new invoices snapshot new data;
- previously sent invoice/PDF unchanged.

---

## DWL-001 Create dwelling

Accept:
- unique within org;
- area/resident count non-negative;
- appears in future periods;
- another organization may use same number.

## DWL-002 Archive dwelling

Accept:
- excluded from new periods;
- hidden from active default;
- old invoices remain;
- hard-delete prohibited after financial history.

## DWL-003 Assign resident

Accept:
- creates/links resident app identity appropriately;
- resident sees exactly assigned dwelling(s);
- removed access immediately blocks authenticated access;
- audit event.

## DWL-004 CSV import

Accept:
- preview exists;
- row errors specific;
- selected mode explicit;
- error report;
- duplicate handling deterministic.

---

## PER-001 Create period

Accept:
- unique month/org;
- creates billing case per active dwelling;
- missing state calculated;
- dates validate.

## PER-002 Lock period

Accept:
- normal reading edits rejected;
- invoice regeneration rejected;
- viewing remains.

---

## MTR-001 Meter CRUD

Accept:
- belongs to one dwelling;
- organization consistency enforced;
- archived meter retained historically.

## MTR-002 Admin reading

Accept:
- consumption correct Decimal;
- lower reading rejected normally;
- case readiness recalculated;
- before/after audit.

## MTR-003 Resident reading

Accept:
- assigned dwelling only;
- open/permitted period only;
- foreign valid meter UUID rejected;
- visible immediately to admin;
- source = RESIDENT.

---

## BIL-001 Fixed rule

Accept:
- active rule generates fixed line;
- historical snapshots unaffected by later edit.

## BIL-002 Area rule

Accept:
- quantity equals dwelling area snapshot.

## BIL-003 Resident-count rule

Accept:
- quantity equals resident count snapshot.

## BIL-004 Meter rule

Accept:
- correct meter type;
- missing reading blocks generation;
- consumption quantity correct.

## BIL-005 Effective dates

Accept:
- only effective rule version applied.

---

## INV-001 Generate

Accept:
- blocked on required missing data;
- unique number;
- transactionally persisted invoice+lines;
- snapshots complete;
- totals reconcile;
- case DRAFT;
- retry does not duplicate.

## INV-002 Bulk generate

Accept:
- eligible cases generate;
- ineligible return explicit reason;
- result summary visible.

## INV-003 Preview

Accept:
- preview matches persisted financial data;
- resident/admin see same financial content;
- resident lacks admin actions.

## INV-004 Prepare

Accept:
- normal transition only from DRAFT;
- issuer/recipient/payment validation;
- audit.

## INV-005 PDF

Accept:
- generated from persisted snapshot;
- stored private;
- SHA-256 stored;
- authenticated resident authorization enforced.

## INV-006 Send

Accept:
- normally PREPARED only;
- delivery persisted;
- successful first send -> SENT;
- total/provider error handled;
- failed send does not falsely become SENT.

## INV-007 Immutability

Accept:
- post-send financial edits rejected;
- tariff/org updates do not modify old invoice;
- old PDF hash stable.

## INV-008 Overdue

Accept:
- local due date passed + unpaid sent invoice -> OVERDUE;
- paid never overdue.

---

## PAY-001 Import

Accept:
- admin only;
- preview before write;
- raw normalized rows retained;
- duplicate file hash blocked/warned.

## PAY-002 Proposal matching against remaining balance

Accept:
- reference normalized contains invoice number;
- candidate invoice must have remaining balance (`amountDue - allocated > 0`) and be in `PREPARED`, `SENT`, or `OVERDUE`;
- fully paid invoices excluded;
- classified as `EXACT` (`amount == remaining`), `PARTIAL` (`amount < remaining`), or `OVERPAYMENT` (`amount > remaining`);
- proposed allocation amount is `min(txn.amount, remaining)`;
- ambiguous reference (matching multiple candidate invoices) remains unmatched;
- no reference -> unmatched.

## PAY-003 Confirm and allocate

Accept:
- executed transactionally with row locks;
- dwelling ledger receives full transaction credit (`type: PAYMENT`);
- allocation record created in `payment_allocations` (`allocated_amount = min(txn.amount, remaining)`);
- match marked `CONFIRMED`;
- invoice `paid_at` set and case set to `PAID` ONLY IF fully settled (`allocated_amount == remaining`);
- partial payment leaves invoice and case unsettled with remaining balance;
- overpayment excess remains as credit on the dwelling account ledger and emits `ACCOUNT_CREDIT_CREATED`;
- audit event recorded (`PAYMENT_MATCH_CONFIRMED`, `PAYMENT_PARTIALLY_ALLOCATED`, or `PAYMENT_OVERPAYMENT_ALLOCATED`);
- repeat confirmation is idempotent;
- confirmed match cannot be rejected.

---

## ACC-001 Dwelling account ledger

Accept:
- dwelling account tracks debits, credits, and running balance;
- append-only: database trigger rejects `UPDATE` and `DELETE`;
- single-sided check: either `debit > 0 and credit = 0` or `credit > 0 and debit = 0`;
- unique idempotency keys on every entry.

## ACC-002 Statement balance resolution & snapshots

Accept:
- invoice generation resolves dwelling account balance and active late-fee policy;
- previous outstanding balance carried forward;
- available dwelling credit automatically applied to reduce amount due;
- invoice preparation freezes `balance_snapshot` and `penalty_snapshot`;
- preparation debits `current_charges` and `late_fee_applied` to dwelling ledger;
- sent invoice snapshots remain immutable after subsequent payments.

## ACC-003 Late-fee policies and adjustments

Accept:
- organization policy defines `daily_rate`, `grace_days`, and penalty cap;
- calculated on oldest unpaid overdue invoice principal;
- admin can adjust or waive fee with structured reason before invoice preparation;
- adjustments recorded in append-only `late_fee_adjustments` with audit log.

## ACC-004 Manual account adjustments

Accept:
- admin can post manual `CHARGE` or `CREDIT` adjustments to a dwelling account with reason and date;
- creates `MANUAL_ADJUSTMENT` ledger entry;
- adjustments immediately update dwelling account balance.

---

## MSG-001 Resident conversation

Accept:
- only assigned dwelling;
- admin sees in correct org;
- initial NEW.

## MSG-002 Admin reply/resolve

Accept:
- resident sees reply;
- admin can resolve;
- resident cannot manipulate foreign conversation.

---

## SEC-001 Cross-tenant

Accept:
- known foreign UUID tests for:
  - dwelling
  - period
  - meter
  - reading
  - invoice
  - bank import
  - conversation
- every read/write denied.

## SEC-002 Cross-resident

Accept:
- known foreign UUID tests for:
  - dwelling
  - meter
  - reading
  - invoice
  - conversation
- every read/write denied.

---

# 36. Seed data

Create deterministic development seed.

Organization A:
`Brīvības 118 Demo`

Organization B:
`Cross Tenant Test`

Users:
- admin A
- admin B
- at least 6 residents

Organization A:
- >= 12 dwellings
- hot/cold meters for most

Periods:
- previous month complete/paid
- current month mixed

Current billing cases include:

```text
>=2 MISSING_DATA
>=2 DRAFT
>=2 PREPARED
>=2 SENT
>=2 PAID
>=1 OVERDUE
```

Fixtures:

```text
fixtures/bank/valid-exact.csv
fixtures/bank/unmatched.csv
fixtures/bank/invalid.csv
fixtures/bank/duplicate.csv

fixtures/imports/dwellings-valid.csv
fixtures/imports/dwellings-invalid.csv
```

No real personal data.

---

# 37. Testing requirements

## Unit

Mandatory:

- each billing calculation type;
- VAT rounding;
- Decimal totals;
- reading consumption;
- state transition policy;
- overdue calculation;
- invoice numbering;
- token hashing;
- bank reference normalization;
- statement balance arithmetic (credit application, debt carry-forward, non-negative amount due);
- late-fee calculation (daily rate, grace days, penalty cap).

## Integration

Mandatory:

- organization-scoped repositories;
- resident-scoped repositories;
- invoice generation transaction;
- invoice preparation (statement snapshotting, charges/penalties debited to ledger);
- invoice snapshot immutability;
- append-only trigger enforcement on financial tables (`account_entries`, `payment_allocations`, `late_fee_adjustments`);
- duplicate bank import rejection;
- payment reconciliation lifecycle:
  - exact payment (invoice fully settled, marked PAID);
  - partial payment (allocation applied, invoice remains open with remaining balance);
  - second payment completing a partial invoice;
  - overpayment (invoice settled, excess sitting as dwelling account credit);
  - payment match idempotency and rejection protections;
- dwelling account adjustments and running balance evolution;
- auth/role checks.

## E2E

Mandatory:

### Admin happy path

```text
login
→ choose org
→ create period
→ enter reading
→ generate
→ prepare (financial statement snapshotted)
→ send
```

### Resident happy path

```text
magic-link/session fixture
→ own dwelling
→ submit reading
→ view invoice (with statement breakdown and remaining balance)
→ download PDF
→ send message
```

### Payment

```text
import CSV
→ inspect proposed matches (exact, partial, overpayment)
→ confirm match
→ allocation recorded + ledger credited
→ invoice PAID only when fully settled (or remaining balance / credit retained)
```

### Security

```text
Resident A → known Resident B invoice UUID → denied
Admin A → known Org B invoice UUID → denied
```

### Immutable invoice

```text
send
→ edit tariff
→ old invoice unchanged
→ PDF hash unchanged
```

---

# 38. Quality gates

Per integrated task:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run astro:check
npm run test
npm run build
```

Before release:

```bash
npm run test:integration
npm run test:e2e
npm run db:migrate:fresh
npm run db:seed
npm run build
npm run preview
```

Use actual repository script names if different, but provide equivalents.

No skipped isolation tests.

---

# 39. Local development

Expected developer flow:

```bash
npm install
cp .env.example .env.local

npm run db:migrate
npm run db:seed
npm run dev
```

Cloudflare-compatible validation:

```bash
npm run build
npm run preview
```

Production deployment:

```bash
npm run deploy
```

Prefer Cloudflare-supported scaffold/configuration tools and current official commands.

Drizzle migration CLI uses direct database credentials from local/CI secret context, not the Hyperdrive Worker binding.

---

# 40. Production deployment checklist

## Supabase

- create project in exact `eu-central-1` / Frankfurt region;
- configure auth Site URL;
- configure only required redirect URLs;
- configure production SMTP;
- create private `invoices` bucket;
- database backups enabled according to plan;
- create dedicated least-privilege Hyperdrive database role;
- run production migrations.

## Cloudflare

- deploy Worker;
- custom domain;
- Hyperdrive binding;
- Browser Run binding/API access;
- Cron;
- secrets;
- logs/observability;
- production CSP/security headers;
- rate limiting where required.

## AWS SES

- region `eu-central-1`;
- verified sending domain;
- SPF/DKIM/DMARC configured;
- production SES access approved;
- application IAM credentials restricted to required SES actions.

---

# 41. Performance expectations

Target scale: ~1,000 users.

Do not prematurely optimize.

Expected priorities:

1. authorization correctness;
2. financial correctness;
3. data integrity;
4. auditability;
5. maintainability;
6. UX;
7. performance.

Still enforce:

- paginated admin lists;
- indexed tenant/status/time columns;
- avoid N+1 queries;
- batch period workbench queries;
- cache only safe non-user-specific data;
- never cache a resident response where tenant identity can leak.

---

# 42. Orca implementation phases

## Phase A — Foundation

- Astro Cloudflare scaffold
- TypeScript/Tailwind/React
- design primitives
- Vitest/Playwright
- Drizzle
- Worker preview/deploy
- CI

## Phase B — Identity and tenancy

- Supabase SSR auth
- app_users
- organizations
- memberships
- dwellings
- dwelling_access
- authorization helpers

## Phase C — Periods and metering

- meters
- periods
- billing_cases
- readings
- resident submission

## Phase D — Billing

- billing rules
- Decimal engine
- effective dates
- state machine
- invoice generation
- snapshots

## Phase E — Delivery

- invoice preview
- Browser Run PDF
- Storage
- token access
- SES delivery

## Phase F — Payments/data/messaging

- CSV imports
- matching
- conversations
- exports

## Phase G — Automation/hardening

- Cron
- overdue
- auto generation/send
- audit UI
- i18n
- security
- E2E
- deployment docs

---

# 43. Agent ownership recommendation

Use strengths, not arbitrary equal splitting.

## Claude

Primary:
- architecture review;
- authentication;
- authorization;
- financial state-machine review;
- security review;
- final cross-domain integration.

## OpenAI Codex / ChatGPT engineering agent

Primary:
- Drizzle schema/migrations;
- repository/query layer;
- billing calculation engine;
- invoice transactions;
- bank import/matching;
- tests;
- Cloudflare/Hyperdrive integration.

## Antigravity

Primary:
- Astro page implementation;
- Tailwind;
- React islands;
- responsive UI;
- accessibility implementation;
- browser/visual QA;
- stable API/action integration.

Antigravity should not independently redesign schema or authorization contracts.

One owner at a time for:

```text
src/db/schema/*
src/domain/*/contracts
src/actions public action shapes
```

---

# 44. Orca task DAG

```mermaid
graph TD
  A[Foundation + Cloudflare runtime]
  B[DB schema + migrations]
  C[Supabase SSR auth + authorization]
  D[Organizations + dwellings]
  E[Periods + meters + readings]
  F[Billing engine + billing cases]
  G[Invoices + PDF + Storage + SES]
  H[Admin UI]
  I[Resident UI]
  J[Bank import + payments]
  K[Messaging + CSV data exchange]
  L[Cron + audit]
  M[Security + E2E]
  N[Final integration + deployment]

  A --> B
  A --> C

  B --> D
  C --> D

  D --> E
  E --> F

  F --> G
  F --> H
  F --> I

  G --> H
  G --> I
  G --> J

  D --> K
  C --> K

  G --> L

  H --> M
  I --> M
  J --> M
  K --> M
  L --> M

  M --> N
```

Keep the graph shallow.

Parallelize only when shared contracts are stable.

---

# 45. Orca coordinator protocol

Before orchestration:

```bash
orca status --json
orca skills get orchestration --full
```

Treat installed Orca skill documentation as authoritative because command flags can evolve.

Create a Run and explicit tasks/dependencies.

For supervised workers:

- use task-specific worktrees where appropriate;
- do not infer completion from terminal idle;
- `worker_done` is the completion signal for a valid supervised dispatch;
- inspect worker summary and diff;
- run acceptance tests before integration;
- re-dispatch when criteria fail;
- release worker after evidence is captured.

The coordinator owns integration.

---

# 46. Antigravity preflight

Orca publicly lists Antigravity as a supported agent, but recent Windows Orca issues have documented worker-start/readiness/injection problems in specific Orca/Antigravity versions.

Before assigning Antigravity critical supervised work:

1. check installed Orca and Antigravity versions;
2. create a trivial test task;
3. start Antigravity through the current documented orchestration path;
4. verify task actually reaches agent;
5. verify the dispatch has worker authority;
6. verify an accepted `worker_done`.

Do not trust `input_accepted` or `tui-idle` alone as proof that an agent turn executed.

If current Antigravity integration is broken:

- use bounded UI tasks only;
- deliver task to an explicit terminal;
- inspect transcript/diff;
- validate output with Claude/Codex;
- coordinator marks task complete only after evidence;
- do not give fallback Antigravity ownership of auth, authorization, DB migrations or invoice financial logic.

Always prefer fixed/current Orca behavior over preserving a workaround once upstream integration is functioning.

---

# 47. Initial Orca task briefs

## A — Foundation

Deliver:
- Astro SSR project;
- Cloudflare adapter;
- Tailwind;
- React;
- base layouts;
- testing;
- CI;
- `astro preview` works.

## B — Database

Deliver:
- Drizzle schema;
- migrations;
- tenant indexes;
- seed;
- direct dev DB client;
- Hyperdrive production client.

## C — Auth/security

Deliver:
- Supabase SSR client;
- `/login`;
- `/auth/confirm`;
- resident magic link;
- admin auth/MFA boundary;
- authorization functions;
- isolation integration tests.

## D — Organizations/dwellings

Deliver:
- CRUD;
- memberships;
- dwelling access;
- admin pages/actions.

## E — Periods/meters/readings

Deliver:
- period creation;
- case generation;
- meter CRUD;
- admin/resident readings;
- consumption.

## F — Billing

Deliver:
- rule CRUD;
- Decimal engine;
- effective rules;
- case state machine;
- invoice generation/snapshots.

## G — Invoices/delivery

Deliver:
- preview;
- Browser Run PDF;
- Storage;
- PDF hash;
- token access;
- SES sending;
- immutable sent invoices.

## H — Admin UX

Deliver all admin routes using stable domain/actions.

## I — Resident UX

Deliver all portal routes, mobile-first.

## J — Payments & Accounts

Deliver:
- CSV normalization;
- preview;
- remaining-balance matching & classification (exact, partial, overpayment);
- confirmation, dwelling ledger crediting, and allocation;
- dwelling account ledger journal and adjustments.

## K — Messaging/data

Deliver:
- conversation flow;
- dwelling import;
- exports.

## L — Automation/audit

Deliver:
- Cron scheduler;
- overdue;
- auto generate/send;
- audit page.

## M — QA/security

Attack:
- cross-org UUID access;
- cross-resident UUID access;
- action tampering;
- invoice mutation;
- token leakage;
- duplicate bank processing.

## N — Final integration

Deliver:
- all gates green;
- README;
- `.env.example`;
- deployment runbook;
- known limitations.

---

# 48. Definition of Done

A story is DONE only when:

- implementation works;
- authorization exists;
- validation exists;
- DB migration exists when required;
- audit event exists when required;
- loading/error/empty UI states exist;
- tests exist;
- acceptance criteria pass;
- Astro production-style preview succeeds;
- no unrelated regression;
- documentation/types updated;
- worker/coordinator has inspected relevant diff.

No "TODO acceptance criteria" in completed work.

---

# 49. Bootstrap prompt for the Orca coordinator

Copy the following into the coordinator:

```text
You are the Orca coordinator for this repository.

Read docs/product/ORCA_PROPERTY_BILLING_ASTRO_SPEC.md completely before acting.
Treat it as the product and engineering source of truth.

First:
1. inspect the repository;
2. run `orca status --json`;
3. run `orca skills get orchestration --full`;
4. compare installed tool/framework versions with the specification;
5. create an Orca Run and shallow task DAG matching Sections 42–47.

Architecture is locked to:
Astro SSR + TypeScript + Tailwind 4 + selective React islands;
Cloudflare Workers;
Supabase Auth + PostgreSQL + private Storage in Frankfurt;
Drizzle + pg through Hyperdrive;
Cloudflare Browser Run for PDFs;
Cloudflare Cron;
Amazon SES Frankfurt.

Preserve exactly ADMIN and RESIDENT.
Authorization is server-side and tenant/dwelling scoped.
Money/readings use exact numeric/Decimal arithmetic.
billing_case owns workflow state.
Sent invoices are immutable.

Assign shared contracts to one worker at a time.
Prefer Claude for architecture/auth/security review, Codex/OpenAI for DB/domain/tests,
and Antigravity for Astro/Tailwind/React UI after contracts stabilize.

Do not treat `tui-idle` or prompt injection as completion.
For supervised work, wait for a valid `worker_done`, then inspect diff and run acceptance tests.
Run an Antigravity preflight before critical Antigravity delegation.

Build in dependency order and continue until the complete v1 acceptance suite passes.
Only escalate material blockers that cannot be safely resolved from the spec.
```

---

# 50. Reference sources checked for v2

Functional reference:
- https://b118.lv/docs

Astro:
- https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- https://docs.astro.build/en/guides/actions/

Cloudflare:
- https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/
- https://developers.cloudflare.com/hyperdrive/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/
- https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/

Supabase:
- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/guides/auth/server-side
- https://supabase.com/docs/guides/auth/quickstarts/astrojs
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/platform/regions
- https://supabase.com/docs/guides/storage/serving/downloads

Drizzle:
- https://orm.drizzle.team/docs/column-types

Orca:
- https://www.onorca.dev/
- https://www.onorca.dev/docs/agents/supported

Current Orca/Antigravity issue references used only for defensive orchestration guidance:
- https://github.com/stablyai/orca/issues/15123
- https://github.com/stablyai/orca/issues/15125
- https://github.com/stablyai/orca/issues/15838

Amazon SES:
- https://docs.aws.amazon.com/general/latest/gr/ses.html

---

# 51. Final implementation principle

Do not build a generic property-management suite.

Build a secure, auditable monthly billing product whose first-class workflow is:

```text
Admin creates period
       ↓
Resident/Admin supplies readings
       ↓
System identifies completeness
       ↓
System calculates deterministic invoice
       ↓
Admin verifies/prepares
       ↓
System creates immutable PDF
       ↓
System sends invoice
       ↓
Resident views it
       ↓
Admin imports bank statement
       ↓
System proposes exact payment match
       ↓
Admin confirms
       ↓
Invoice is paid and preserved
```

Everything in v1 should strengthen that loop.
