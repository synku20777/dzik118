# Admin mutation feedback tiers

The server remains authoritative. Client mutation state records user intent,
server confirmation, and frontend reconciliation; it is not a second business
data store.

| Tier | Operations | Client behavior |
| --- | --- | --- |
| Optimistic | Create meter, create dwelling, add resident access | Insert a temporary `client:*` row and replace it with authoritative data. Remove it only after definitive rejection; keep it disabled while an unknown outcome is verified. |
| Pending only | Archive meter, remove resident access, other destructive or configuration changes | Disable the control and apply the result only after confirmation. |
| Server authoritative | Readings, tariffs, billing periods, invoices, payments, allocations, ledger adjustments | Show pending controls without displaying committed financial state before confirmation. |

The lifecycle is `pending → confirmed → reconciling → success`,
`pending → verifying → success/unknown`, or `pending → error`. “Saved” appears
only after authoritative state has been applied.

Optimistic creates send a stable `clientMutationId`. A permanent
`mutation_receipts` row uses `(organization_id, client_mutation_id)` as its
primary key and commits in the same transaction as the domain write and audit
event. Receipt operation, type, and scope are derived by the server. Resident
access uses `scope_id = dwelling_id` and `entity_id = user_id`. Unknown outcomes
are checked on a bounded schedule and expose Check again, never a second create.
Session storage contains translation keys and opaque identifiers only.

Meter create/archive, dwelling create, and resident assign/remove are
JavaScript-intercepted Astro Actions. Other server-rendered POST forms remain
native. They show pending form controls until navigation starts but do not enter
durable recovery without a receipt or correlated result token. Financial state
remains server-authoritative.
