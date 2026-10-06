# Easybilly hands-on review and Namkopa opportunities

Reviewed: 5 October 2026. Source: the signed-in Easybilly administrator application at https://easybilling.unitify.com/. This is a product walkthrough, not a security audit or verification of accounting correctness.

## Main finding

Easybilly's clearest observed advantage is how it gets a manager from an empty workspace to configured premises and a calculation preview. It combines a guided setup, useful presets, bulk entry, migration choices, and clear next actions. Namkopa already has much of the underlying billing functionality, but spreads setup across separate pages and an explanatory guide.

Borrow the workflow patterns and adapt them to Namkopa's financial controls and Latvia defaults. The first improvement should be guided setup, followed by easier bulk entry and migration. Do not rebuild the product to reproduce every competitor module.

History alone is not a unique Namkopa advantage: Easybilly exposes building-wide activity history, tariff history, account operations, and a multi-month charge/payment table. The depth, completeness, and financial integrity of those histories were not independently verified.

## Method, evidence, and limits

- The owner authorized fictional records in a disposable test workspace.
- Created one building named **RESEARCH TEST — Namkopa comparison**, with a fictional address, EUR currency, three apartments of 45/60/75 m², account references TEST-1/2/3, a maintenance charge of €0.50/m², and a cold-water tariff of €2/m³.
- Added fictional meter **RESEARCH-METER-001** to apartment 1 with initial reading 100; subsequently saved reading 105 through the bulk reading screen.
- Calculated invoice previews of €22.50, €30.00, and €37.50, totaling €90.00. These previews omitted water because the preflight reported no applicable period reading/calculation rule at that stage.
- Uploaded a locally generated fictional payment CSV and inspected matching/preview. Canceled before importing the payment.
- Did not send emails, invitations, invoices, AI messages, or payments; did not connect integrations, purchase anything, change permissions, or delete existing records. Did not press the final Generate Invoices action because draft/issue/billing consequences were not established.
- Existing Demo building was left intact. Fictional research records remain available for inspection; no cleanup deletion was performed.
- Signup and the first organization creation were already completed before the review. The eight-step building wizard was directly tested; the original signup flow was not replayed.
- Namkopa comparison uses the current local source, work log, and graphify query. Its live admin URL redirected to login, so this was not a simultaneous authenticated comparison of both live products.
- Screenshots are in `docs/research/easybilly-2026-10-05/`. They contain the test workspace UI; treat the evidence as internal research.

Evidence levels used below: **tested** means the action produced a visible result; **inspected** means a screen/form/control was opened; **unverified** means the underlying result or correctness was not exercised.

## The onboarding sequence we should learn from

| Step | Observed behavior | Why it helps |
| --- | --- | --- |
| 1. Building info | Name, address, currency. Only essential inputs initially. | A small first commitment gets the user moving. |
| 2. Import | Excel/CSV or manual entry. Manual numbers accept ranges and commas, such as `1-3`. Editable area/owner table, validation, selected-row preview, then explicit import. | Setting up many apartments does not require repeating a form. |
| 3. Services | Maintenance, intercom, security, elevator, current repairs, custom services. Per-area/per-unit pricing and premises-type switches. Optional AI contract upload can be dismissed in favor of manual entry. | Users recognize their real charges without first learning an abstract rule model. |
| 4. Resources | Electricity, cold/hot water, heating, gas, sewage. Explicit maintenance-only option; reassurance that configuration can change later. | The workflow adapts to the building rather than demanding every resource. |
| 5. Tariffs | Rates for selected resources, shared vs premises-type tariffs, and a copy-from-other-buildings entry point. | Avoids irrelevant inputs and repeated tariff entry. Copying itself was not tested. |
| 6. Account numbers | Automatic format, prefix/separator format, or import old references. Live examples and bulk assignment. | Preserves recognizable payment references during migration. TEST-1/2/3 assignment was tested. |
| 7. Opening balance | Explicit new-building/zero-balance versus migration choice. Migration accepts Excel/CSV with a balance date and offers a premises-prefilled template. | Makes the financial starting point a deliberate decision. File import was inspected, not committed. |
| 8. Review | Completed-step checklist, premises/resource/service summary, tariff dates, and links to readings, invoicing, penalties, common-area rules, and fallback formulas. | Gives closure and tells the manager what to do next. |

The wizard displays progress, Back, and a Save control after the first step. Records visibly persisted during the walkthrough. Interrupted-session resume behavior was not tested, so the presence of Save does not prove a reliable resumable wizard.

Evidence: [wizard](easybilly-2026-10-05/01-building-wizard.jpg), [premises preview](easybilly-2026-10-05/02-premises-preview.jpg), [service presets](easybilly-2026-10-05/03-service-presets.jpg), [balance migration](easybilly-2026-10-05/04-opening-balance.jpg), [completion review](easybilly-2026-10-05/05-onboarding-review.jpg).

## What it does better, and what Namkopa already has

| Opportunity | Easybilly observation | Namkopa's current implementation | Recommendation |
| --- | --- | --- | --- |
| Guided setup | Eight-step building wizard, explicit alternatives, progress and final review. **Tested.** | Organization creation, settings, dwelling import, meters, rules, and periods are separate pages. Admin guide describes their sequence. No wizard/onboarding implementation found. | **First priority:** orchestrate existing actions into guided setup. |
| Bulk manual premises creation | Range syntax, area grid, validation, selected-row import. **Tested.** | Individual creation or CSV import with preview/confirmation. | Add range entry plus a simple editable preview; reuse existing dwelling validation. |
| Spreadsheet migration | Premises, balances, readings, tariffs, services, and payments expose spreadsheet entry points. | Dwelling and bank imports use CSV; dwelling import requires 11 exact header names, even when values are blank. | Supply downloadable templates and clear requirements first. Add mapping/XLSX support only for actual customer files. |
| Financial migration | Zero-balance versus migration is a first-class setup decision. | `OPENING_BALANCE` exists in the ledger enum, but no source usage implementing a user-facing opening-balance import was found. | An audited opening-balance workflow is a real capability gap; implement separately from cosmetic onboarding. |
| Service configuration | Familiar presets with per-area/per-unit rates and type switches. **Tested for maintenance.** | Fixed, area, resident-count, and meter-consumption billing rules with scope/effective dates. | Offer presets that populate existing rules. Keep detailed controls available. |
| Bulk readings | Shared date/time, last-reading column, editable new-reading cells, save-all control, monthly history mode. **One meter save tested.** | Workbench links/drawer and dedicated page collect readings for one dwelling; existing submission actions can be reused. | Add a period-wide reading grid when managers enter many readings themselves. |
| Invoice review | Select premises, review reading statuses, calculate, see every apartment's arithmetic and combined total before final generation. **Preview tested.** | Bulk generation/prepare/send and per-invoice calculation views already exist. | Improve batch review; retain Namkopa's draft, prepare, and send boundaries. |
| Correction workflow | Bulk selector, affected-account count, service, affected period/range, decrease/surcharge, reason, description, and posting month. **Inspected.** | Draft manual adjustments, late-fee adjustments, and payment reversal are present. They are not equivalent to bulk historical service corrections. | A genuine future finance feature; design its accounting invariants before borrowing the UI. |
| Portfolio hierarchy | Organization → building → premises; optional property complexes group buildings. **Inspected.** | Dwellings belong directly to organizations; no building entity exists in the inspected schema. | Do not rename organizations to buildings. Multi-building portfolios need a deliberate model decision. |
| Account visibility | Premises table shows area, meters, amount due, owner, residents. Drawer combines balance, charges, operations, penalties, recalculations, owners and next actions. **Inspected.** | Dwelling detail already has account ledger and scoped audit/history panels. | Improve findability and summaries; avoid duplicating existing history functionality. |
| Owner transitions | Keep account/change owner or open a new account; handover balance choices and proration entry point. **Inspected only.** | Resident access and billing/occupant details exist; equivalent financial account-transition workflow was not found in the inspected sources. | Validate demand and legal/accounting treatment before implementing debt transfer or write-off. |
| Team roles | Administrator, Manager, Accountant, Resident; invite by email or phone. **Inspected.** | Global user roles are ADMIN/RESIDENT with organization memberships. | Accountant permissions are a genuine authorization feature, not just a new role label. |
| Financial overview | Collections, invoiced/received/period debt, analytics, debtor filter and horizontal monthly history. **Inspected with empty financial data.** | Dashboard totals, cases needing attention, payment views and monthly workbench already exist. | Borrow compact presentation where helpful; this is partly presentation parity. |
| Budget/documents | Annual building budget template; supplier-document upload advertises extraction and links to actuals/cashflow. **Forms inspected.** | No corresponding module found in the inspected admin routes. | Defer unless pilots need it; larger scope than billing onboarding. |
| AI | Contract extraction entry point, document analysis, account assistants, floating finance assistant. **Entry points inspected.** | No equivalent observed. | Defer. AI accuracy, cost, privacy, and delivered value were not tested. |

## Coverage log

| Surface | What was explored | Limit |
| --- | --- | --- |
| Home | Monthly navigation, needs-action area, building readiness, recent activity, collection summary | Initially observed existing Demo data; no invoice generation from Home. |
| Buildings | Search/list, eight-step wizard, fictional building, Import control, Unitify sync menu | Import control opened without completing portfolio file import; no sync executed. |
| Property complexes | Create form and group description | No complex created. |
| Building overview | Counts, setup status, recent activity, full activity-history modal with categories/search | No assertion of log completeness or immutability. |
| Premises | Table, account-number drawer, editable attributes, balance-import modal, account-generation entry point | Existing premises not changed; deletion not attempted. |
| Historical billing import | Spreadsheet format with account/service rows and charged/paid month pairs; optional FIFO recalculation described | No historical balances uploaded or FIFO run. |
| Recalculation | All/by-type/manual scope and correction-detail form | No correction applied. |
| Residents | Add-resident form: unit, owner name, phone/email, role and ownership share | No real person added or contacted. |
| Meters | Add-meter required fields and optional lifecycle dates; active/expired filters; apartment/building meter modes | Created one fictional apartment meter; no physical integration. |
| Readings | Bulk entry and save, monthly-table mode, import entry point, reporting window | Saved 105. Did not validate a full month-to-month consumption cycle. |
| Topology | Opened tab | No meaningful topology data in the test building; calculation behavior unverified. |
| Resources | Tariff history; missing-reading formula switches; common-area controls and building-meter prerequisites | No fallback or common-area rule executed. |
| Services | Maintenance/resource charges, effective dates, new-tariff entry points | Did not change established tariffs after setup. |
| Building settings | Due days, account-prefix/separator controls | No additional settings persisted. |
| Invoices | Unit selection, reading preflight, math preview, List/Debtors/Analytics/History tabs | Stopped before final generation; no delivery, PDF or resident payment tested. |
| Invoice history | Building filter, premises/account search, service control, debtor filter, multi-month charged/paid table | No issued-invoice history in the test building. |
| Payments | Summary, filters, manual-payment form, CSV import and automatic account mapping preview | Canceled before posting. Unitify reconciliation not run. |
| Budget | List and new-budget template form | No budget created or month closed. |
| Documents | Building/supplier/type/date filters and multi-file analysis upload dialog | No contracts or supplier documents transmitted. |
| Team/settings | Organization name/area unit, roles, invitation email/phone form, integration indicator | No invite, access change, or integration connection. |
| Organization/account menus | Organization switching/add entry point and sign-out menu | No additional organization created or sign-out. |
| Language | English, German, Latvian, Russian, Georgian, Azerbaijani, Slovenian choices | Translation completeness not assessed for all languages. |
| AI assistant | Prompt/topic entry points: debtors, collections, compare, channels; uncertainty disclaimer | No prompt sent and no output quality tested. |
| Resident experience | Resident role described in settings | No resident login/invitation available; not directly tested. |

## Friction and inconsistencies to avoid copying

1. **Completion overclaims readiness.** The wizard says setup is complete and the building is ready for invoicing while its next-step list asks for initial readings. The building list subsequently showed **Partially**. Namkopa should distinguish configuration complete, billing ready, and ready to send.
2. **Translation leakage.** English screens contained Russian billing-history labels/help and raw names such as `coldWater` / `hot_water`. Preserve understandable localized business terms throughout the setup.
3. **Currency ambiguity in payment preview.** The fictional CSV contained `Currency=EUR`, and the research building used EUR. The preview nevertheless displayed `22.50 ₾`. This proves a displayed inconsistency; it does not prove a wrong ledger posting because import was canceled. Do not silently infer or replace financial currencies.
4. **Reference inconsistency.** Premises and invoice preview displayed TEST-1, while meter views and the owner-transition form used `a5804d32-1`. Distinguish internal identifiers from payment references and keep the latter consistent.
5. **Refresh needed after meter creation.** The meter appeared in the meter list, but switching to readings initially still showed no meters. A fresh page load exposed it. Avoid stale empty states immediately after setup actions.
6. **Owner-transition balance lacked context.** The account drawer showed €0 and no unpaid invoices, while the owner-change form showed €2.90 outstanding. Proration or accrued charges might explain it; no transition was executed. Label the components and dates so the user can reconcile the views.
7. **Silent omission is still possible after a warning.** Invoice preflight explained that water would not be charged when a reading/rule was missing, then allowed maintenance-only calculation. Namkopa should keep required billing blockers, with an explicit, auditable exception if omitting a required charge is permitted.
8. **Default currency did not follow Latvia expectations.** The new-building wizard initially selected USD; the research manually selected EUR. Namkopa's existing EUR/Europe-Riga/Latvian defaults are more appropriate for our target market.

These are observations from one account/session, not claims about every customer or all competitor financial behavior.

## Recommended Namkopa onboarding to build next

Use one guided route with six steps, existing authorization/domain actions, visible progress, Back, and safe continuation. This is a proposed product specification; no application code was changed during the research.

| Step | Contents | Completion criterion |
| --- | --- | --- |
| 1. Organization and issuer | Organization name/address; existing Latvia defaults. Collect legal/payment details needed for invoices with explanations. | Organization exists; distinguish fields needed now from fields needed before sending. |
| 2. Dwellings | Individual entry, range-based bulk entry, or CSV/template; editable preview and explicit commit. | Required units are persisted and their required billing inputs validated. |
| 3. Meters and starting readings | Ask which resources are billed. Reuse meter setup, offer bulk entry, and allow maintenance-only setup. | Required meters and baseline inputs are present, or an explicit no-meter choice is recorded. |
| 4. Charges and tariffs | Maintenance/water/common fixed-fee presets mapped to existing rule types and scopes. Show calculation examples and effective dates; retain detailed rule editing. | Rules cover intended units and billing dates without missing required inputs. |
| 5. First billing period | Reuse period creation, deadlines, issue/due dates, and existing billing settings. Offer optional resident setup later; leave automated sending off. | A valid first period exists and readiness checks identify remaining work. |
| 6. Review and next action | Show units, rules, recipients, missing readings/details, and a first calculation/review action. Link directly to specific fixes. | The UI accurately states whether setup, generation, and sending are ready; it never sends automatically. |

For migrations, opening balances require a separate validated ledger import before using migrated account balances for live billing. The enum alone is not an implementation. Do not fake old debt through a fabricated payment or silently overwrite balances.

Implementation constraints:

- Reuse the current guide's order, dwelling preview/confirmation, rule validation, reading actions, and invoice state machine. A wizard should coordinate existing behavior rather than create a second billing engine.
- Derive progress from persisted valid configuration; merely visiting a step must not mark it complete. Make retries idempotent and avoid duplicate records after back/reload.
- Keep server validation and financial controls authoritative. Clearly explain effective dates, omissions, opening debt/credit, and what will be written.
- Keep resident invitations, sending, AI uploads, and integrations optional and explicit. They are not prerequisites for trying the product.
- Use accessible labels, keyboard navigation, clear field errors, and existing English/Latvian/Russian translations.
- Adapt the flow to today's organization/dwelling model. A real building/portfolio hierarchy is a separate product and migration decision.
- Reproduce the useful interaction patterns with Namkopa's own design, wording, and code.

Acceptance scenarios for a later implementation: new maintenance-only organization; three-unit range entry; invalid/duplicate CSV; interrupted and resumed setup; back/retry without duplication; metered building with missing readings; tariffs outside the first period; migrated debt/credit requiring approval; absent billing recipient/payment details; archived organization; cross-organization access; and completion without any invoice being sent.

## Prioritized backlog

1. **Guided setup and honest readiness**, using existing actions and checks.
2. **Templates and bulk dwelling entry**, reducing the current exact-header/import burden.
3. **Period-wide reading entry**, if manager-entered readings are common in pilots.
4. **Validated opening-balance migration**, for customers moving from an existing system.
5. **Batch invoice review**, preserving prepare/send controls.
6. **Accounting corrections and accountant permissions**, each as a separate financially/security-sensitive feature.

Defer AI assistants, document extraction, budgets, meter topology, and broad ecosystem replication until there is customer demand. Existing scoped history and period controls should be improved where needed, not rebuilt because the competitor also displays history.

## Evidence index

| File | Contents |
| --- | --- |
| `01-building-wizard.jpg` | Wizard start and progress. |
| `02-premises-preview.jpg` | Selected apartments before import. |
| `03-service-presets.jpg` | Recognizable services and pricing inputs. |
| `04-opening-balance.jpg` | Migration choice, date and template entry point. |
| `05-onboarding-review.jpg` | Completion checklist and next steps. |
| `06-building-overview.jpg` | Building counts and readiness. |
| `07-bulk-recalculation.jpg` | Structured correction form. |
| `08-invoice-reading-preflight.jpg` | Missing-reading warning and charging consequence. |
| `09-invoice-preview.jpg` | Per-apartment arithmetic and €90 total. |
| `10-payment-import-preview.jpg` | Matched TEST-1 and displayed currency inconsistency. |
| `11-dwelling-finance-drawer.jpg` | Account summary and financial operations. |
| `12-owner-change.jpg` | Account-transition choices and handover balance. |
| `13-building-activity.jpg` | Searchable building activity log. |
| `14-ai-assistant-entry.jpg` | AI topic buttons and disclaimer. |
| `15-bulk-readings.jpg` | Inline new-reading entry. |
| `16-saved-reading.jpg` | Saved reading 105. |
| `17-monthly-meter-table.jpg` | Monthly reading/consumption/amount columns with the fictional meter. |
| `synthetic-payments.csv` | One fictional EUR payment row, previewed but not imported. |

## Namkopa source anchors

- `src/pages/admin/organizations.astro`: organization creation UI.
- `src/pages/admin/o/[orgId]/guide/index.astro`: setup and monthly workflow instructions.
- `src/domain/organizations/csv-import.ts`: dwelling import schema, preview and confirmation.
- `src/db/schema/organizations.ts`, `src/db/schema/dwellings.ts`: organization defaults and direct organization/dwelling hierarchy.
- `src/pages/admin/o/[orgId]/settings/rules.astro`: existing tariff types, scope and effective dates.
- `src/pages/admin/o/[orgId]/periods/[periodId]/index.astro`, `src/lib/ui/workbench-drawer.ts`: monthly workbench and dwelling-level reading entry.
- `src/domain/payments/bank-import.ts`: bank CSV preview and confirmation.
- `src/db/schema/accounts.ts`: opening-balance enum and ledger/allocation types.
- `src/db/schema/auth.ts`: current ADMIN/RESIDENT role model.
- `docs/WORK_LOG.md`: delivered payment reversals and dwelling-scoped audit history.

Graphify was queried before source inspection. Application code, deployments, and the knowledge graph were not changed by this research.
