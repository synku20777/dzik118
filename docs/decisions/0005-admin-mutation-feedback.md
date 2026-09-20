# Admin mutation feedback tiers

The server remains authoritative. Client mutation state records user intent,
server confirmation, and frontend reconciliation; it is not a second business
data store.

| Tier | Operations | Client behavior |
| --- | --- | --- |
| Optimistic | Create meter, create dwelling, add resident access | Insert a temporary `client:*` row and replace it with authoritative data. Remove it only after definitive rejection; keep it disabled while an unknown outcome is verified. |
| Optimistic | Update dwelling basic information (occupant name, billing name/email/address, area, resident count) | Update existing state optimistically and reconcile with authoritative server data upon confirmation. |
| Pending only | Archive meter, remove resident access, other destructive or configuration changes | Disable the control and apply the result only after confirmation. |
| Pending only | Update invoice delivery preferences | Disable the control and apply the result only after confirmation. |
| Server authoritative | Readings, tariffs, billing periods, invoices, payments, allocations, ledger adjustments | Show pending controls without displaying committed financial state before confirmation. |

The lifecycle is `pending → confirmed → reconciling → success`,
`pending → verifying → success/unknown`, or `pending → error`. “Saved” appears
only after authoritative state has been applied.

## Hyperdrive caching regression and mutation recovery

This mutation-feedback architecture was originally prompted by a regression caused by Cloudflare Hyperdrive query caching:
1. A mutation write succeeded on the server.
2. An immediate client-side revalidation read hit a stale cached `SELECT` query result from Hyperdrive.
3. The optimistic UI was overwritten by that stale, authoritative-looking data.
4. The created or updated entity appeared to vanish or misbehave until a manual page refresh.

Hyperdrive query caching has since been disabled in production as the actual fix for that read-after-write staleness regression.

The mutation receipts and durable lost-response recovery mechanisms documented in this ADR solve a different problem: network-level lost responses (where a write commits on the server, but the client disconnects or times out before receiving the HTTP response). They are not a caching workaround and must not be confused with or removed as if they were addressing cache staleness.

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
