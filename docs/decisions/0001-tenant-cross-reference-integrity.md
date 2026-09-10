# 0001 - Tenant cross-reference integrity: DB-enforced vs. application-enforced

**Status:** Accepted
**Phase:** B (Database)

## Context

Many tables carry both `organization_id` and a foreign key into another
org-scoped table (e.g. `meters.dwelling_id`, `invoices.billing_case_id`,
`payment_matches.invoice_id`). Plain single-column foreign keys do not stop a
row from pairing a valid `organization_id` with a foreign key that actually
belongs to a *different* organization -- e.g. a `meters` row could reference
a real `dwellings.id` that belongs to Organization B while its own
`organization_id` says Organization A.

Spec Section 13.6 states this invariant in prose for exactly one
relationship: "`organization_id` must equal the dwelling organization" (for
`meters`). No other table in Section 13 states this explicitly, and Section
14's access-policy section frames tenant scoping as a *repository-layer*
contract (`getAdminInvoice({ organizationId, invoiceId })`), not a
database-constraint contract. Section 33 reinforces this: "Application
authorization is mandatory even if RLS is introduced."

## Decision

- For the one relationship the spec calls out explicitly (`meters` ->
  `dwellings`), enforce it in Postgres: `dwellings` gets a
  `UNIQUE (id, organization_id)` constraint, and `meters` has a composite
  foreign key `(dwelling_id, organization_id)` referencing it. A meter can no
  longer be inserted with a `dwelling_id`/`organization_id` pair that doesn't
  match a real dwelling, full stop -- not just as an application-level check.
- For every other org-scoped relationship (dwelling_access, billing_cases,
  invoices, invoice_lines, payment_matches, conversations, messages, etc.),
  tenant-consistency is enforced at the application/domain layer via the
  repository pattern in spec Section 14, not via composite foreign keys.

## Why not composite FKs everywhere

Retrofitting `UNIQUE (id, organization_id)` + a composite FK onto every
org-scoped table would touch essentially all 20 tables in Section 13 for a
guarantee the spec does not ask for anywhere except the one relationship
above, and duplicates work the domain layer must do anyway: every Astro
Action in later phases validates `organizationId` against the authenticated
admin's memberships before touching any child resource (Section 14), and all
writes go through server-side Actions -- there is no direct client-to-DB path
for these tables (Section 33/34). The cost/benefit did not justify the schema
bloat for v1 at ~1,000 users (Section 41: "do not prematurely optimize").

## Revisit if

A future security review (Phase M) finds a real path where the application
layer can be bypassed or a repository function omits its tenant-scope
parameter, making DB-level enforcement worth the added migration complexity
for the remaining relationships.
