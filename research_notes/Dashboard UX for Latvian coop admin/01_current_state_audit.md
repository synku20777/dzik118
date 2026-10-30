# Namkopa admin dashboard: current state and docs audit (working tree, 2026-10-28)

Scope: codebase and docs audit only. No repo files edited. Sources are repo-relative paths with line numbers, written as links to local files. Line numbers refer to the working tree (not HEAD) unless noted. Abbreviations: DASH = `src/pages/admin/o/[orgId]/dashboard/index.astro`; I18N = `src/lib/ui/i18n.ts` (the `lv` dictionary is lines 47-2003, `ru` 2004-3972, keys are the English sentences).

---

## 1. What blocks does the dashboard render, in order, and with what data, labels, states and actions?

### Takeaway
The dashboard is a per-period page. It shows a setup banner (only while onboarding is unfinished), then a period header with a single "Open workbench" CTA, a prev/next period nav, three money KPIs (invoiced / paid / outstanding), a "Needs attention" list (only MISSING_DATA and OVERDUE cases), a "Case status" count list, and a water "Consumption" card. Nothing on it is aware of lifecycle phase beyond (a) setup incomplete and (b) the two attention statuses.

### Cited Findings

**Data loading (DASH 22-88)**
- Auth: `requireOrganizationAccess`; ForbiddenError redirects to `/unauthorized` — [DASH:22-28](../../src/pages/admin/o/[orgId]/dashboard/index.astro)
- Period selection: `?periodId=` if given, else `getCurrentOpenPeriod` (newest period if it is OPEN), else newest non-opening period — DASH:53-61. `getCurrentOpenPeriod` returns null when the newest period is LOCKED (`src/domain/periods/periods.ts:268-278`; comment at 263-267 says an older reopened period is never "current"). So a locked newest period falls through to `periods[0]` (newest, LOCKED).
- The setup-only "opening readings" period is filtered out of the period list (DASH:43-45; ADR 0012 item 4; WORK_LOG.md:564-566).
- Queries per page view: `getOrganization`, `listPeriods`, `getSetupStatus` (1 count query on `invoices.sentAt`, then full `getSetupProgress` only if no invoice has ever been sent — `src/domain/onboarding/progress.ts:150-171`), `getDashboardSummary` (`src/domain/periods/dashboard.ts:51-216`), and `listCasesForPeriod` (`src/domain/periods/cases.ts`, DASH:67-68). Cases are therefore read twice (once inside `getDashboardSummary`, once with invoice join). `AdminLayout` opens a second DB connection for unread-message count and org switcher list (`src/layouts/AdminLayout.astro:40-47`).
- Any throw inside the DB block (including not-found for a bad `periodId`) silently `redirect`s to `/admin/o/{id}/periods` (DASH:77-79). There is no error state on the page.
- Default UI locale is not Latvian: `uiLocale` returns `en` unless a cookie says `lv`/`ru` (I18N:33-45); middleware seeds the cookie from `Accept-Language` on first visit (`src/middleware.ts:~69-78`, `localeFromAcceptLanguage` I18N:9-31, falls back to `en`).

**Shell around the page (AdminLayout.astro)**
- Left sidebar: brand "Namkopa", `OrganizationSwitcher`, `AppNavigation` (6 links in order: Dashboard, Periods, Dwellings, Payments, Messages, Settings — `src/components/ui/AppNavigation.astro:12-19`; Messages shows an unread-conversation badge, up to "99+"), then "Admin guide" link, then email, sign-out, theme toggle and EN/LV/RU switch (AdminLayout:86-111). Mobile: top bar with "Menu ☰" opening a dialog with the same nav.
- Archived org banner `notice-danger` above `<slot/>` (AdminLayout:~170).
- Latvian nav labels: Dashboard = `Pārskats` (I18N:356), Periods = `Periodi` (357), Dwellings = `Īpašumi` (358), Payments = `Maksājumi` (359), Messages = `Ziņojumi` (360), Settings = `Iestatījumi` (361), Admin guide = `Administratora ceļvedis` (95).

**Block list in render order (DASH 152-532)**

| # | Block | Condition | Data source | EN label / LV label (verbatim) | Action |
|---|---|---|---|---|---|
| 1 | Setup banner `<section class="dashboard-setup panel">` (DASH:157-208, CSS 536-651) | `!setupComplete && setupProgress` | `getSetupStatus` -> `SetupProgress.steps` (5 booleans) | Title "Finish setting up" / `Pabeigt iestatīšanu` (I18N:1806); counter `{n} / 5 {t("Done").toLocaleLowerCase()}` — "Done" = `Pabeigts` (1726), so LV renders "1 / 5 pabeigts" (singular, grammatically off for plural); "Next step: <strong>…</strong>" / `Nākamais solis` (48); `<ol aria-label="Setup steps">` / `Iestatīšanas soļi` (1788); sr-only "Done"/"To do" = `Pabeigts`/`Jāveic` (1726-1727) | Each of 5 steps is a link to `/setup/{organization,dwellings,period,charges,meters}`; primary button "Continue setup" / `Turpināt iestatīšanu` (1809) goes to next undone step's href (fallback `/setup`) |
| 1a | The 5 step titles (DASH:119-147) | | `steps.organization/dwellings/period/charges/meters` | "Organization details" `Organizācijas dati` (1711); "Dwellings" `Īpašumi` (358); "First billing period" `Pirmais norēķinu periods` (1677); "Charges" `Maksas` (1674); "Meters and starting readings" `Skaitītāji un sākuma rādījumi` (1712) | link per step; done = check icon, next = filled number badge |
| 2a | No-period header (DASH:210-233) | `!summary` | none | `PageHeader` display, eyebrow = org name, title "Dashboard" `Pārskats`, description "Monitor billing, payments and work requiring attention." / `Pārskatiet rēķinus, maksājumus un veicamos darbus.` (404-405) | none |
| 2b | Empty state with ornament (DASH:220-232) | `!summary && setupComplete` | none | "No billing periods yet." `Vēl nav norēķinu periodu.` (406); "Create a period to start the monthly billing workflow." `Izveidojiet periodu, lai sāktu ikmēneša norēķinus.` (407-408) | button "Create period" `Izveidot periodu` (427) -> `/periods` |
| 3 | `AdminContextDrawer` (DASH:236-247) | summary present | none (shell for readings drawer; `refreshSelectors` = `.dashboard-attention`, `.dashboard-case-status`) | strings in drawer, e.g. "Meter readings", "Save readings", "Enter current meter readings for this period." | opened by "Add readings" |
| 4 | Period header (DASH:248-272) | summary present | `summary.period` (year, month, status) | eyebrow org name; `<h1 class="font-display">` month + year via `Intl.DateTimeFormat(locale,{month:'long',year:'numeric'})` (e.g. "oktobris 2026" in lv); `StatusBadge` OPEN `Atvērts` (382) / LOCKED `Slēgts` (383); `FacadeAccent` ornament | Primary button always "Open workbench" / `Atvērt norēķinu darbvietu` (403) -> `/periods/{id}` — same CTA in every lifecycle state |
| 5 | Period nav (DASH:273-305) | summary present | `allPeriods` (excl. opening period) | `aria-label` "Period navigation" `Periodu navigācija` (449); prev/next show the neighbour month name as link; disabled placeholders "Previous period" `Iepriekšējais periods` / "Next period" `Nākamais periods` (535-536) | `?periodId=` links |
| 6 | KPI row, 3 cards `grid sm:grid-cols-3` (DASH:306-338; `KpiCard.astro`) | summary present | `getDashboardSummary` | "Total invoiced" `Rēķinu kopsumma` (396); "Paid" `Apmaksāts` (380) tone success; "Outstanding" `Neapmaksātā summa` (397) tone warning. Values via `formatMoney` = `Intl.NumberFormat(locale,{style:'currency'})` | Not clickable, no hint text (KpiCard supports `hint`, unused) |
| 7 | "Needs attention" list (DASH:339-469, `.dashboard-attention`) | summary present | `summary.needsAttention.length` for count; rows from `listCasesForPeriod` filtered to `MISSING_DATA` or `OVERDUE` (DASH:353-356) | Heading "Needs attention" `Nepieciešama uzmanība` (401) + count; empty: "Nothing needs attention right now." `Pašlaik nav steidzamu darbu.` (409) | per row — see below |
| 7a | Attention row | each MISSING_DATA/OVERDUE case; sorted MISSING_DATA first then OVERDUE then dwelling number (STATUS_PRIORITY, cases.ts:~22-47); no cap or pagination | `c.status`, `c.missingData` JSONB (4+ shapes incl. legacy plain string, DASH:358-383) | Dwelling link "Dwelling {number}" (`Īpašums` I18N:375) -> `/dwellings/{id}`; `StatusBadge` MISSING_DATA `Trūkst datu` (376) or OVERDUE `Kavēts` (381). Body for OVERDUE: "Payment is past its due date. Review reconciliation." `Maksājuma termiņš ir pagājis. Pārskatiet maksājumu saskaņošanu.` (419-420). Body for MISSING_DATA: comma list of missing meter `label`, else translated meter type (`Aukstais ūdens` 398 / `Karstais ūdens` 399 / etc.), or rule names `"{rule} — no active meter"` / `nav aktīva skaitītāja` (995), or "No billing rule applies" `Nav piemērojams neviens norēķinu noteikums` (994). Fallback when missing list empty: "All readings are present. Generate the invoice in the workbench." `Visi rādījumi ir ievadīti. Izveidojiet rēķinu darbvietā.` (421-422). Caption when missing>0: "Readings are required before generating an invoice." `Pirms rēķina izveides nepieciešami rādījumi.` (417-418) | MISSING_DATA and period not LOCKED: "Add readings" `Pievienot rādījumus` (410) -> link with `?drawer=readings&dwelling=` that opens the in-page drawer (JS `data-open-drawer`). OVERDUE: "Review payments" `Pārskatīt maksājumus` (412) -> `/payments` (not filtered to that dwelling). Locked period MISSING_DATA: "Open workbench" |
| 8 | "Case status" panel (DASH:472-496, `.dashboard-case-status`) | summary present | `summary.caseStatusCounts` | Heading "Case status" `Norēķinu statuss` (402). Seven rows always shown in order MISSING_DATA, READY, DRAFT, PREPARED, OVERDUE, SENT, PAID (DASH:109-117), each a `StatusBadge` + count + arrow: `Trūkst datu`, `Gatavs rēķina izrakstīšanai` (414), `Melnraksts` (377), `Sagatavots` (378), `Kavēts` (381), `Nosūtīts` (379), `Apmaksāts` (380) | each row links to `/periods/{id}?status={STATUS}` (workbench filter). Zero counts still shown |
| 9 | "Consumption" panel (DASH:497-526) | summary present | `coldWaterConsumption`, `hotWaterConsumption` | "Consumption" `Patēriņš` (400); "Cold water" `Aukstais ūdens`; "Hot water" `Karstais ūdens`; values `formatNumber(...) m³` | none |

Layout: blocks 7 and 8+9 sit in `grid xl:grid-cols-[2fr_1fr]`; below xl they stack (attention first, then status, then consumption).

**KPI semantics (dashboard.ts:84-143), important for a monthly summary**
- "Total invoiced" = `sumExact(currentCharges)` over all invoices of the period, including DRAFT and PREPARED (no filter on sent), restricted to invoices whose currency equals the org's current currency (dashboard.ts:66-76, 144). It excludes carried balance, credits and late fees.
- "Outstanding" = per invoice `max(amountDue - allocated, 0)`, where `amountDue` includes previous outstanding, credit applied and late fee (dashboard.ts:122-134). So Invoiced - Paid is not Outstanding when carry-over exists. Evidence: `public/guide/dashboard.jpg` (demo data) shows Total invoiced €70,182,710.38, Paid €0.00, Outstanding €70,182,853.88. The 2026-10-28 screenshot `.ux-shots-setup/attention-desktop-verified.png` shows 628.98 / 159.77 / 469.21, which happens to be consistent.
- "Paid" = sum of confirmed `payment_allocations` for those invoices minus `payment_reversals`; legacy fallback: `paidAt` set and no allocations means paid = amountDue (dashboard.ts:109-121). Allocations and reversals are loaded for the whole organization, not just the period (dashboard.ts:84-97), which is fine today but not scalable.
- Consumption counts only meters with `unit === "m3"` and type COLD_WATER/HOT_WATER; electricity, gas, heat and other types are ignored (dashboard.ts:152-176). Carried-forward readings (consumption 0) are included silently.
- Dead styling: `.dashboard-totals :global(.kpi…)` (DASH:681-688) and `.dashboard-period-list` (676) target classes that no element in the template uses; tone styling actually comes from global `.kpi[data-tone]` (global.css:746-751).

**Visual components used**
- `PageHeader`, `FacadeAccent` (arched facade ornament visible in screenshots), `KpiCard` (icon in tinted box, value 1.25-1.85rem, weight 650, tabular nums; global.css:703-751), `StatusBadge` (maps status to label/tone/icon via `src/lib/ui/invoice-status.ts:6-25`), `EmptyState` with optional `Ornament` (dashed border, Fraunces title), `Icon`, `AdminContextDrawer`. Cards: `.panel` (global.css:626-632). Heading font: Fraunces on `h1.font-display` (global.css:655-665); body Switzer.

### Inferences
- The attention list is the only "task" surface and it ignores most of the monthly cycle: READY (generate), DRAFT/PREPARED (review/send), SENT-not-yet-paid and PAID never appear there. The fallback sentence "All readings are present. Generate the invoice in the workbench." can only render for a MISSING_DATA case with an empty `missingData` array, which should be rare, so it is effectively a dead branch rather than a "Ready to generate" prompt (the i18n key "Ready to generate" `Gatavs rēķina izveidei` at I18N:413 exists but the dashboard does not use it).
- The page has no "everything is done / what to do next" message in any state; CTA is a constant "Open workbench".
- The attention list has no limit; with e.g. 80 dwellings and no readings it renders 80 rows above the fold of Case status.

### Gaps
- Not verified by running the app (no server started). Rendering is described from source and the existing screenshots.
- Did not inspect `AdminContextDrawer`'s client controller (`src/lib/ui/workbench-drawer.ts`) beyond props; behaviour of save/refresh is assumed from the doc comments.

---

## 2. What does the user see on first load in each lifecycle state, and what is the next-step logic?

### Takeaway
There is one explicit guided "next step" mechanism: the setup banner (5 steps, next undone step highlighted, "Continue setup" button). Once setup is complete or any invoice has ever been sent, the banner is gone for good and there is no replacement next-step logic: the user sees KPIs, attention list and status counts with a fixed "Open workbench" button.

### Cited Findings

**Next-step / guided setup logic**
- `getSetupStatus`: if any invoice has `sentAt` not null, setup is considered complete and progress is not even computed (progress.ts:150-171). A DRAFT invoice does not count. Otherwise it calls `getSetupProgress`; banner shows while any of the 5 steps is false.
- Step definitions (progress.ts:117-130): `organization` = name AND addressLine1 non-empty; `dwellings` = at least 1 active dwelling; `period` = first billing period exists, is OPEN, and every active dwelling has a case in it; `charges` = first period has effective rules and no `NO_APPLICABLE_RULES` blockers; `meters` = first period exists, no `NO_ACTIVE_METER_FOR_RULE`, and every required meter has a starting reading in the opening period.
- `SetupProgress` also computes `readyToGenerate`, `issuerMissing` (name, address, bank name, IBAN), `recipientsIncomplete`, `billingEmailsMissing`, `blockers` by reason (progress.ts:20-32, 132-147), but the dashboard banner uses only `steps`. Those richer readiness facts surface only on `/setup` (review step) — `src/pages/admin/o/[orgId]/setup/index.astro:36-70+`.
- Setup completion != ready to bill: `complete` means 5 steps done and "Not the same as 'ready to generate'" (progress.ts:21). Current-period `NO_READING` blockers do not hold the banner.
- Each setup page redirects back to `/dashboard` when setup is complete (e.g. `setup/organization.astro:26`, `dwellings.astro:42`, `charges.astro:32`, `meters.astro:41`, `period.astro:33`).
- ADR 0012 item 9: "A new organization opens the setup. The dashboard shows 'Finish setting up' until the setup is complete or an invoice was sent." (docs/decisions/0012-guided-setup-and-starting-readings.md:47-48). WORK_LOG.md:550-553 says the same.
- `/admin` redirects to the first org's dashboard (`src/pages/admin/index.astro:18`); organizations list links to dashboard (`organizations.astro:54`). Whether a brand-new org is redirected to `/setup` on creation was not traced (WORK_LOG says "A new organization opens it").

**First-load view per lifecycle state** (derived from code; screenshots exist for rows marked [shot])

| State | What renders |
|---|---|
| A. New org, setup not started | Banner "0 / 5" with step 1 "Organization details" as next step, "Continue setup" -> `/setup/organization`. Below: header "Dashboard" with org name eyebrow and the description sentence, **no EmptyState** (suppressed by `setupComplete &&` at DASH:220) and no content at all. [shot: `.ux-shots-setup/dashboard-setup-banner.png`, mobile `dashboard-setup-banner-mobile.png`: banner at 1/5, then a mostly blank page] |
| B. Setup incomplete, first period already exists | Banner (n/5) on top, then the full period dashboard for that period (it is OPEN, so it is "current"): KPIs all €0.00 (no invoices), Needs attention = every dwelling that is MISSING_DATA (reasons e.g. missing meter label, "No billing rule applies", "{rule} — no active meter"), Case status counts, Consumption 0 m³ (zero rows summed to "0"). The user therefore sees two competing to-do lists (setup steps and attention rows). |
| C. No billing period, setup "complete" | Rare: step 3 requires a period, so the empty state "No billing periods yet." + "Create period" (DASH:220-232) renders only when `getSetupStatus` reports complete (an invoice was already sent) yet no non-opening period exists. A legacy org that never used setup shows state A instead. |
| D. Period OPEN, no readings yet (start of month) | No banner. KPIs €0.00 / €0.00 / €0.00. Needs attention lists every dwelling with a required meter as MISSING_DATA, each with an "Add readings" button opening the drawer; Case status shows N under "Trūkst datu". [shot: `public/guide/dashboard.jpg` (stale, see §3) and `.ux-shots-setup/attention-desktop-verified.png`] |
| E. Readings complete, nothing generated | Cases flip to READY (`Gatavs rēķina izrakstīšanai`). Needs attention shows "Nothing needs attention right now." / `Pašlaik nav steidzamu darbu.` Only the Case status panel hints at N READY cases. Header CTA "Open workbench". KPIs still €0.00. |
| F. Invoices generated (DRAFT) / prepared | KPIs "Total invoiced" and "Outstanding" become non-zero already at DRAFT (drafts counted; dashboard.ts:66-76 has no sent filter), "Paid" = 0. Attention list empty. Counts under Melnraksts / Sagatavots. |
| G. Invoices sent | Setup banner permanently gone (first `sentAt`). Counts under Nosūtīts. Nothing prompts "reconcile payments" or "send reminders". |
| H. Payments outstanding / partial | KPIs Paid and Outstanding reflect allocations; a partially paid invoice stays in SENT (not in attention). Overdue is set by the daily scheduler `scanOverdueInvoices` (`src/domain/automation/scheduler.ts:30-63`, called at ~263 from the cron-driven run), so OVERDUE cases and "Review payments" rows appear only after the cron has flipped status; the dashboard does not itself compare due dates. [shot: attention-desktop-verified.png has OVERDUE rows 3 and 4] |
| I. Payment bounced/reversed | `paymentReversals` reduce "Paid" silently; no row, badge or count on the dashboard. |
| J. Period LOCKED (newest) | Falls to the newest period (LOCKED badge `Slēgts`); "Add readings" replaced with "Open workbench"; `Next period` is a disabled placeholder; **no "create next period" CTA anywhere** — period creation is only on `/periods`. Header CTA still "Open workbench". |
| K. Older period selected via nav (`?periodId=`) | Same layout; no banner on stale-period indicator; `Needs attention` for that period still lists any unresolved cases. |
| L. Error (bad/foreign `periodId`, any DB error) | Silent redirect to `/periods` (DASH:77-79). |

### Inferences
- The only state that has a designed "what next" is first-time setup. After the first send, the dashboard cannot tell the manager the month's phase (collect / generate / send / reconcile / close) even though case counts contain all the information.
- State C/E/J are the clearest dead ends: no prompt to generate when all readings are in, no prompt to create the next month after locking.

### Gaps
- Did not trace org-creation redirect (to `/setup` vs dashboard).
- Did not run each state against a live DB; table above is from code reading plus the three screenshots.

---

## 3. What do the docs say about the dashboard/home screen and the admin persona? Where are they stale or contradictory?

### Takeaway
Docs define the dashboard very thinly: one 7-bullet list in the spec and one row in USER_JOURNEYS ("Monitor"), plus the principle "Dashboard supports monitoring and prioritization". There is no explicit persona document; the only admin definition is a feature list. The implementation matches the spec bullets, but several docs/guide assets are stale or overstate it.

### Cited Findings

**Spec (the only normative dashboard requirement)**
- `docs/product/ORCA_PROPERTY_BILLING_ASTRO_SPEC.md:2217-2228`: "## Dashboard / `/admin/o/[orgId]/dashboard` / Show: - current/selected period; - total invoiced; - paid; - outstanding; - cold/hot consumption; - case status counts; - work requiring attention." Implementation shows exactly these seven items.
- Spec route table: line 624 "`/admin/o/[orgId]/dashboard` | current period dashboard"; line 630 payments = "reconciliation dashboard"; line 649 portal = "resident dashboard".
- Spec product definition: line 42 "Build a multi-tenant property billing web application for apartment buildings, housing associations, cooperatives and small property managers." Admin responsibilities list, lines 44-62 (organizations/buildings, dwellings, residents, monthly periods, meters/readings, rules, invoice generation/PDF/email, status, bank CSV import, reconciliation, resident communication, CSV import/export, settings, audit, optional auto generate/send). Spec line 36: "collect data → calculate → verify → deliver → reconcile → preserve history".
- Spec 30.2 (line 2432): "Initial UI languages: Latvian (`lv`), English (`en`), Russian (`ru`)." Latvian is the canonical invoice language (line 1244) but the admin UI default is `en` in code (I18N:33-45) unless browser sends lv.
- Spec "Monthly workbench" section (2230-2257) lists default sort MISSING_DATA, DRAFT, PREPARED, OVERDUE, SENT, PAID (READY omitted; the code has READY second, cases.ts STATUS_PRIORITY).

**USER_JOURNEYS.md**
- Line 9: "Primary goal: Complete the monthly billing cycle accurately: collect readings, create and approve invoices, deliver them, reconcile payments, and preserve the history."
- Lines 11-50 flowchart: `Sign in -> One organization? -> Dashboard -> What needs attention? -> Missing readings / Ready to bill / Overdue payment`. Line 18: "Missing readings --> F[Open readings drawer from workbench row]" — stale in detail: the dashboard itself now opens the readings drawer per attention row (DASH:444-457). Line 24: "E -- Ready to bill --> H" implies the dashboard flags "Ready to bill"; it does not (only the Case status count).
- Line 58 (journey table): `| Monitor | What needs attention now? | /admin/o/:orgId/dashboard | Open workbench or resolve attention item | Missing data, overdue, open/locked period |` — matches implementation; "important states" list has no empty/no-period/setup states.
- USER_JOURNEYS does not mention guided setup, the opening-readings period, migration, or the setup banner at all (journey table starts at Sign in -> Select context -> Monitor -> Start period).

**SERVICE_DESIGN_BLUEPRINT.md**
- Line 99: "Dashboard supports monitoring and prioritization." Line 100: "Monthly workbench supports execution." Line 102: "Missing data and overdue cases appear before routine states; a case that becomes fully ready shows as Ready to invoice before it is generated."
- Line 35 (ADMIN actions, phase 1): "Sign in; choose organization; scan dashboard." Line 37 frontstage UI: "Attention list; status badges including Ready to invoice; readings drawer…".
- Line 150: "These signals can be calculated from data already supported by the product. They are blueprint measures, not new dashboard requirements." — explicit statement that delivery reliability, reconciliation counts, support closure etc. are *not* required on the dashboard; this is the doc-level reason the dashboard is thin.
- Lines 152-160 service quality signals (MISSING_DATA vs READY counts, cases by status, delivery success/failure, proposed/confirmed/rejected/unmatched counts, reading source/timestamp, conversation status).

**UI_SPECIFICATION.md** (no dashboard section; it is a style spec)
- Line 5: "contemporary Baltic civic product: calm, highly functional, structurally rigorous, warm rather than sterile". Section 5.2 (249-259) desktop admin layout (sidebar 240-256px, main max ~1440, 12-col grid, 24px gutter, 32-48px padding). Section 6.1 (265-281) cards "set into the composition", avoid "excessive cardification". Line 757: "use muted colors rather than dashboard-neon saturation" (charts, section 18; line 741-764 chart palette). Section 20 (792-813) global rules incl. "use status indicators as compact accents instead of flooding surfaces", "use tabular numerals in financial/data contexts", "prefer contextual drawers over unnecessary page transitions", "preserve Latvian diacritic quality throughout". Section 12 quick actions (501-513) are defined for the dwelling page only (not the dashboard).

**FULL_DESIGN_SPECIFICATION.md**
- Line 131: "A dashboard should feel like an orderly façade from a distance. Only when the user gets closer should details emerge." Lines 183-190: Ķīpsala "craft" tone suits "resident dashboard; dwelling profile; empty states; onboarding; communications; account summary cards". Lines 683-693: quick actions in the header above the fold ("the handful of tasks an administrator actually performs") — specified for the dwelling page. Line 910: charts "should continue the architecture rather than suddenly becoming dashboard-neon". Line 57: ornament concentrated at "headings, empty states, marketing surfaces, and significant workflow milestones" (implemented via `FacadeAccent` + ornamented empty state).

**Decisions**
- ADR 0010 (typography) `docs/decisions/0010-typography.md:52`: "the large sans numbers on the dashboard and the resident invoice (-0.025em and -0.03em)" — matches `.kpi-text > p` letter-spacing -0.025em; line 26-28 headings; line 54 "no `.text-display` class and no large Fraunces numbers" (KPI values are Switzer, not Fraunces).
- ADR 0011 (retroactive billing) `docs/decisions/0011-retroactive-billing.md:25-26`: "An older period that was reopened is never the current period. Thus the scheduler, the resident portal, and the dashboard ignore it." The dashboard still *can* display a reopened older period when navigated to via `?periodId=` or the period nav; "ignore" refers to default selection only.
- ADR 0012 item 9 (lines 47-48), consequences lines 52-58: see §2. Also: "The review shows three separate lines: setup complete, ready to generate invoices, and ready to prepare and send" (line 25-26) — the dashboard banner shows only the first of the three.
- ADR 0013 (migration center) mentions no dashboard; Migration Center is linked only from `settings/data.astro` (grep `/migration` in `src`), not from dashboard, setup, nav or guide. KNOWN_GAPS.md:135-183.

**WORK_LOG.md**
- 337-338: "The period workbench, the dashboard, and the admin guide show the new blockers in EN, LV, and RU (Agy)."; 341: "The new UI items were not run in a browser."
- 550-553 (setup route; banner), 564-566 (opening period "not in KPIs, consumption history, or previous/next navigation"), 606-632 (setup slow: "2.3 s for the dashboard" in production for 10 dwellings; fixes: `getSetupStatus`, progress computed once, `prefetch: false`; 634-642 Worker placement to `aws:eu-central-1`, ~34 ms per query; not deployed).
- Latest HEAD commit is 943a2eb (2026-10-06). The dashboard UI work (setup banner restyle with clickable steps, "Next step", "Continue setup" deep link, attention row restyle, readings drawer anchor with `?drawer=readings&dwelling=`) is uncommitted in the working tree and is not described in WORK_LOG.md (no entry for 2026-10-23 .. 10-28 in the dashboard context was found; entries found end at the setup/perf notes). Not verified exhaustively.

**KNOWN_GAPS.md / KNOWN_LIMITATIONS.md**
- KNOWN_GAPS.md has no dashboard item. Closest: "Checked and not gaps: Meter readings are entered in the period workbench by design" (line 189; contradicts the dashboard drawer and the period-wide grid `/periods/{id}/readings`, so it is stale). Open items affecting a monthly summary: opening balances currency/late-fee notes (147-156), "Meters added later" (128-130).
- KNOWN_LIMITATIONS.md mentions (line 72) delivery attempts classified DEFINITIVE vs AMBIGUOUS/UNKNOWN: "needs attention" state for UNKNOWN send attempts exists in the domain but is not on the dashboard.

**Admin guide (in-app) and its screenshot**
- `src/pages/admin/o/[orgId]/guide/index.astro:86-96`: step "Collect missing readings" says "Use the dashboard attention list or the monthly workbench to find missing readings." with image `/guide/dashboard.jpg`, alt "Admin dashboard with billing totals and work that needs attention.". Line 129-133: step "Handle questions and exceptions": "Review resident messages, overdue invoices, unmatched payments, and delivery failures." Ready condition: "Ready when every attention item has an owner or is resolved." The dashboard shows only overdue; unmatched payments and delivery failures are not on it (they live on `/payments`, `/settings/suppressed-emails`, the invoice page).
- `public/guide/dashboard.jpg` (mtime 2026-09-15) is stale: brand reads "Property Billing", sidebar shows "ADMINISTRATION / Brīvības 118 Demo / Switch organization", old layout and "Total invoiced €70,182,710.38" demo data, whereas the app is now "Namkopa" with an org switcher dropdown and Fraunces/Switzer typography. Viewed directly.
- Guide ordering test `tests/e2e/ui.spec.ts:305-309` expects 10 `main ol > li` guide steps.

**Persona / admin user**
- No persona document exists. Evidence of the intended admin: spec line 42 ("apartment buildings, housing associations, cooperatives and small property managers"), USER_JOURNEYS.md:9 (primary goal), SERVICE_DESIGN_BLUEPRINT.md:17 (ADMIN responsibility row), ADR 0013 context (managers leaving another system, Latvian Excel files with Windows-1257 and `;`, KNOWN_GAPS.md:139-141), EASYBILLY_REVIEW:3-9 ("manager" from empty workspace to configured premises), the "Latvian housing co-op" framing comes from the task brief, not from a repo doc. The review refers to the user as "manager" and notes "Namkopa's existing EUR/Europe-Riga/Latvian defaults are more appropriate for our target market" (EASYBILLY_REVIEW:103).
- Roles are only ADMIN and RESIDENT (blueprint:15-18, spec; EASYBILLY_REVIEW:60 "Global user roles are ADMIN/RESIDENT"). No accountant/read-only role.
- Docs do not state the admin's digital literacy, time budget per month, whether they are a volunteer board member, an accountant, or a management company, or how many dwellings are typical (the only size hint is 10 dwellings in the production perf log, WORK_LOG.md:608, and the 3-12 dwelling demos).

**Competitor reference in docs**
- `docs/research/EASYBILLY_REVIEW_2026-10-05.md:61`: "Financial overview | Collections, invoiced/received/period debt, analytics, debtor filter and horizontal monthly history. Inspected with empty financial data. | Dashboard totals, cases needing attention, payment views and monthly workbench already exist. | Borrow compact presentation where helpful; this is partly presentation parity."
- Line 69 (Coverage log, Home): "Monthly navigation, needs-action area, building readiness, recent activity, collection summary | Initially observed existing Demo data; no invoice generation from Home."
- Line 72 (Building overview): "Counts, setup status, recent activity, full activity-history modal with categories/search".
- Line 96: friction #1 "Completion overclaims readiness… Namkopa should distinguish configuration complete, billing ready, and ready to send." (the dashboard banner shows only "configuration complete").
- Line 11: "History alone is not a unique Namkopa advantage."
- Line 143: "Existing scoped history and period controls should be improved where needed, not rebuilt because the competitor also displays history."

### Inferences
- Stale/contradictory items to fix if the dashboard changes: USER_JOURNEYS.md:18 and :24; KNOWN_GAPS.md:189; `public/guide/dashboard.jpg` and its alt text; guide step 10 promise ("unmatched payments, and delivery failures"); spec Section 27 dashboard list (will need updating with any new blocks); ADR 0012 item 9 describing the banner (now has "Next step" and per-step links); WORK_LOG has no entry for the uncommitted dashboard redesign.
- Spec/blueprint treat the dashboard as "monitoring and prioritization" but give no priority rules beyond attention = MISSING_DATA + OVERDUE (`dashboard.ts:46-49` comment: "unlike DRAFT/PREPARED which are just normal steps in the monthly workflow still in progress"). Any "next step" rule is a new product decision, not a regression.
- The persona is under-specified; a report writer should treat "Latvian co-op admin" as an inference from the task brief plus the spec phrase "housing associations, cooperatives and small property managers", not a documented persona.

### Gaps
- Did not read the remaining ~110 KB of the main spec; only targeted greps for dashboard, persona, locale and Section 27. Persona/market words may exist elsewhere.
- Did not check `docs/decisions/0001-0009` beyond grep hits (none mention the dashboard).

---

## 4. Uncommitted changes (working tree vs HEAD 943a2eb, 2026-10-06)

### Takeaway
The dashboard page and its i18n/CSS/layout dependencies are modified and uncommitted; the audit above reflects the working tree.

### Cited Findings
- `git diff --stat HEAD` for the relevant files: DASH +234/-41 (275 lines changed); `AdminLayout.astro` 70; `i18n.ts` +385; `global.css` 14; `domain/periods/*`, `domain/accounts/*`, `domain/billing/generation.ts` also modified (migration-center related: ledger.ts +74, statements.ts +35, case-readiness.ts +78, opening-readings.ts 306, periods.ts +59, generation.ts +11). `src/domain/periods/dashboard.ts` and `src/domain/onboarding/progress.ts` are not in the modified list (unchanged vs HEAD).
- What changed in DASH vs HEAD: (1) setup banner rebuilt from a plain list (`<ul>`, "✓"/"To do" text, button to `/setup`) to a card with progress count, "Next step: …", 5 linked steps with a coloured top rule, and "Continue setup" deep-linking to the next undone step (`nextSetupStep.href`); (2) attention rows restyled (removed per-dwelling `btn-secondary` pill and `data-overdue`), dwelling link is now underlined text, "Add readings" changed from `<button>` to `<a href="?drawer=readings&dwelling=…">` with `data-open-drawer` and aria attributes so it works without JS and is deep-linkable; (3) page-scoped CSS block (536-761) for banner, period nav, attention rows, status links.
- `git log` for the dashboard file: last committed 943a2eb (2026-10-06), before that d760b03 (2026-10-02), 71fb569, d90ab99, 7ab09b0.
- New untracked Migration Center files (`docs/decisions/0013-migration-center.md`, `src/pages/admin/o/[orgId]/migration/**`, `src/domain/migration/`, `tests/integration/migration-*.test.ts`) are not referenced from the dashboard (no `/migration` link outside `settings/data.astro`).
- Existing integration tests that exercise `getDashboardSummary`: `tests/integration/admin-ux.test.ts:29, 398, 466`. No test of `getSetupStatus` found via grep; Playwright `ui.spec.ts` only checks that dashboard loads, nav label "Pārskats" in LV (ui.spec.ts:300-304), skip link, mutation toasts.

### Inferences
- Because 28 files are modified/untracked and `AdminLayout`, `i18n`, `global.css` have unrelated edits (e.g. `.org-context` removed, `--font-regular-weight` added), a screenshot taken now reflects Medeo font preview/`DevFontPreview` in DEV only (`AdminLayout.astro:48-52, ~155-165`, `import.meta.env.DEV`).

### Gaps
- Did not diff `src/lib/ui/workbench-drawer.ts` or other uncommitted UI files for dashboard impact.

---

## 5. Competitor (Easybilly) dashboard, from `docs/research/easybilly-2026-10-05/06-building-overview.jpg` (viewed)

### Takeaway
Easybilly's per-building Overview is a setup/inventory page, not a monthly financial summary: four count tiles, a Billing Setup Status checklist with green pills, and a Recent activity feed. Its monthly "Home" with needs-action area and collection summary is described only in text in the review doc.

### Cited Findings
- Header: "RESEARCH TE…" building name, fictional address, a "Refresh from Unitify" dropdown (disabled), buttons Invoices, Payments, Documents. Tabs: Overview (active), Premises, Residents, Meters, Resources, Services, Settings.
- Tiles (2x2): Premises "3" with "Manage →"; Resources "1" with water-drop icon; Services "1" with "Manage →"; Total area "—" with "All units: 180.00 m²".
- Card "Billing Setup Status": rows Premises "3 pcs", Resources and tariffs "1 resources", Services "1 services", each with green check pill.
- Card "Recent activity" with "View all >" and a collapse chevron; first entry "Added service — Nestor Kulik — less than a minute ago". Floating AI assistant button bottom-right. Top bar: organization switcher "My Organization", language "GB", user menu.
- The screenshots dir contains 17 images; `13-building-activity.jpg` is the searchable activity log, `05-onboarding-review.jpg` the completion checklist. The review doc text (not the image) describes Home: "Monthly navigation, needs-action area, building readiness, recent activity, collection summary" (EASYBILLY_REVIEW:69) and invoices tabs "List/Debtors/Analytics/History" with debtor filter and a multi-month charged/paid table (EASYBILLY_REVIEW:61, 83-84).
- Easybilly review explicitly says financial overview was "inspected with empty financial data" (line 61), so its collection/debt visuals were never seen populated.

### Inferences
- Patterns Namkopa lacks on its dashboard that the competitor has: recent activity feed, setup/readiness status that persists after setup, entity counts (dwellings, meters), debtor view, multi-month history. Namkopa already has more actionable financial content than the competitor's overview tile page, but the doc itself calls this "partly presentation parity".

### Gaps
- Did not open the other 16 screenshots; Home and Invoices tab visuals are known only from the review text.

---

## 6. Data that exists in the DB/domain but is not shown on the dashboard (candidates for a monthly summary)

### Takeaway
The domain layer already has most of what a monthly summary would need; the dashboard exposes about 10 of roughly 25 obvious signals.

### Cited Findings (each is present in code, absent from DASH)

| Data | Where it lives | On dashboard? |
|---|---|---|
| Carried-over arrears `carriedOutstanding`, `creditsApplied`, `lateFees`, `amountDue` | `getDashboardSummary` already computes them (`dashboard.ts:30-35, 137-143, 196-207`) and the workbench page fetches the same summary | **Computed but unused on the dashboard** (only `totalInvoiced`, `totalPaid`, `totalOutstanding`, consumption, counts, attention are read) |
| Org-wide debt across periods / per-dwelling balance | `getDwellingAccountBalance`, `listDwellingAccountActivity` (`src/domain/accounts/ledger.ts:27, 101`); `account_entries` (append-only ledger) | No. "Outstanding" is per period only |
| Number/list of dwellings with debt, largest debtors, days overdue | `billing_cases` OVERDUE + invoices `invoiceDueDate`; `calculateLateFee` (`late-fees.ts:39`) computes `overdueDays` | Only an OVERDUE status row with a static sentence, no amount, no days overdue, no dwelling filter on the payments link |
| Collection rate (paid / amountDue), invoices count, average invoice | derivable from the same rows | No |
| Cost vs revenue (what the co-op owes suppliers vs what it bills) | No cost/supplier/budget model exists (EASYBILLY_REVIEW:62 "No corresponding module found"; spec blueprint scope boundary line 164 excludes ERP/ledger exports) | Not available at all, not just undisplayed |
| Total consumption of electricity, gas, heat, other meters; per-dwelling anomalies; carried-forward (estimated) share | `meter_readings.consumption`, reading `source` including `CARRIED_FORWARD` (`schema/billing.ts:27-34`) | Only m³ cold/hot; carried-forward readings counted as zero consumption without flag |
| Which readings are missing and since when; reading deadline | `billing_periods.readingDeadline`, `invoiceIssueDate`, `invoiceDueDate` (`schema/billing.ts:80-82`) | Deadline/issue/due dates are not shown anywhere on the dashboard |
| Resident-submitted vs admin-entered readings | reading `source` RESIDENT/ADMIN/IMPORT | No |
| Unmatched/proposed bank transactions awaiting confirmation | `listUnmatchedTransactions`, `listPaymentMatches` (`src/domain/payments/matching.ts:382, 437`), `bank_imports` | No; the guide promises "unmatched payments" as an attention item |
| Bounced/reversed payments | `payment_reversals` (`schema/accounts.ts`), `reversePayment` (`payments/reversal.ts:16`); reduces "Paid" silently | No row/count |
| Invoice delivery failures / UNKNOWN attempts / missing billing emails / suppressed (bounced) emails | `invoice_send_attempts` status CLAIMED/DISPATCHING/SENT/FAILED/UNKNOWN (`schema/invoices.ts:36-39, 211`), `deliveries.status` (276), `suppressed_emails` (`schema/email.ts:16-44`), `progress.billingEmailsMissing` | No (only `/settings/suppressed-emails` page and invoice detail) |
| Recipient/issuer detail incompleteness blockers (prepare blocked) | `progress.issuerMissing`, `recipientsIncomplete` (progress.ts:132-147) | Only shown on `/setup` review, not after setup completes |
| Unread resident messages | `countUnreadConversationsForOrganization` | Yes, but only as a sidebar badge, not as a dashboard block |
| Recent activity / audit trail | audit log (`src/lib/logging/audit.ts`, `/audit` page) | No |
| Previous-month comparison (deltas for invoiced, paid, consumption) | needs summary for neighbour period; period nav already knows `previousPeriod` | No; user must click to previous month |
| Counts of dwellings, active meters, archived dwellings | `dwellings`, `meters` | No |
| Late-fee amounts applied in period | `lateFeeApplied` | No |
| Draft invoices excluded/included clarity ("Total invoiced" includes drafts) | `dashboard.ts:66-76` | Label gives no hint it includes unsent drafts |
| Currency mismatch exclusion | `dashboard.ts:66-76` silently drops invoices whose currency differs from the org's | Silent, no warning |

### Inferences
- The cheapest wins: `summary.carriedOutstanding`, `lateFees`, `creditsApplied`, `amountDue` are already computed and sit unused on this page; fixing the Invoiced/Paid/Outstanding arithmetic confusion needs no new queries.
- Unmatched transactions, delivery failures and reversal counts would need new queries; per-dwelling arrears needs `account_entries` aggregation.
- Cost vs revenue is out of the current data model (no supplier costs); calling for it needs a product decision, not a UI change.

### Gaps
- Did not measure query cost of any new summary; the production perf note (WORK_LOG.md:606-632) says each query costs about 34 ms due to Worker/DB distance, so added queries are not free.

---

## 7. Is a Playwright screenshot of the dashboard feasible?

### Takeaway
Yes, with care. Existing screenshots from today and earlier are already on disk, so a new capture may be unnecessary. If a fresh one is needed, a Playwright script against a manually started `wrangler dev` is feasible; `astro dev` also works for the DEV font preview.

### Cited Findings
- Existing images (no server needed): `.ux-shots-setup/attention-desktop-verified.png` (2026-10-28 12:10, dark mode, desktop, Brīvības 118 Demo, Sept 2026 with Missing data and Overdue rows) and `attention-mobile-verified.png` (same, mobile); `dashboard-setup-banner.png` and `dashboard-setup-banner-mobile.png` (2026-10-23, setup banner at 1/5); `review-desktop.png`, `review-mobile.png`. `.ux-shots-setup/` is git-ignored (`git check-ignore` returned it). `public/guide/dashboard.jpg` is committed but stale (2026-09-15).
- `playwright.config.ts`: baseURL `http://localhost:4321`; `webServer.command` = `npm run build && npx wrangler dev --port 4321` with `reuseExistingServer: !process.env.CI` and 120 s timeout; comment explains `astro preview` daemonizes and breaks Playwright supervision. `package.json` scripts: `dev` = `astro dev`, `build`, `preview`, `test:e2e` = `playwright test`, `demo:reset` / `demo:auth` / `storage:setup` (`scripts/demo-reset.ts`, loads `.dev.vars`, needs DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY).
- Current machine state (checked, nothing started by me): nothing listens on 4321; local Supabase is listening on 54321 (API) and 54322 (Postgres); several `node` processes are running but none on 4321. Demo admin seen in screenshots: `admin.a@example.com` (password set by `demo:auth`; not read).
- Memory notes referenced in the brief: stray wrangler/astro servers hijack port 4321 (Playwright probe pitfalls); `test-results` is wiped each run; admin login is rate-limited to 5 per minute; declaring the Browser Rendering binding hangs ALL `wrangler dev` requests in this sandbox (see `wrangler.jsonc` modified in working tree, binding state not checked by me); `astro dev` with Cloudflare adapter can be used instead for page rendering.
- E2E helper pattern for login: log in, `page.waitForURL(/\/admin\/o\/.+\/dashboard/)` (`tests/e2e/ui.spec.ts:44`), then `?lang=lv` forces Latvian (`ui.spec.ts:300`). Dashboard states can be reproduced with `?periodId=` and `?lang=lv|en|ru`.

### Inferences
- To capture each lifecycle state, use a disposable org per state (per the memory note about collision-safe IDs) or reuse the demo org plus period nav; empty/setup-banner states need a fresh org (the 10-23 shots show how). Use a screenshot-only script outside `tests/e2e` to avoid `test-results` wipes, set viewport 1440x900 (matches guide image size) and 390x844 for mobile, use `?lang=lv` to capture Latvian copy.

### Gaps
- Did not start servers or take screenshots (instruction: do not risk hanging the sandbox). Not verified that `wrangler dev` currently works with the working-tree `wrangler.jsonc` changes.

---

## Quick reference: all dashboard-specific Latvian strings (verbatim, `lv` dictionary)

`Pārskats` (Dashboard, 356) · `Pārskatiet rēķinus, maksājumus un veicamos darbus.` (404-405) · `Vēl nav norēķinu periodu.` (406) · `Izveidojiet periodu, lai sāktu ikmēneša norēķinus.` (407-408) · `Izveidot periodu` (427) · `Atvērt norēķinu darbvietu` (403) · `Periodu navigācija` (449) · `Iepriekšējais periods` / `Nākamais periods` (535/536) · `Rēķinu kopsumma` (396) · `Apmaksāts` (380) · `Neapmaksātā summa` (397) · `Nepieciešama uzmanība` (401) · `Pašlaik nav steidzamu darbu.` (409) · `Īpašums` (375) · `Trūkst datu` (376) · `Gatavs rēķina izrakstīšanai` (414) · `Melnraksts` (377) · `Sagatavots` (378) · `Nosūtīts` (379) · `Kavēts` (381) · `Atvērts` (382) · `Slēgts` (383) · `Pievienot rādījumus` (410) · `Pārskatīt maksājumus` (412) · `Maksājuma termiņš ir pagājis. Pārskatiet maksājumu saskaņošanu.` (419-420) · `Pirms rēķina izveides nepieciešami rādījumi.` (417-418) · `Visi rādījumi ir ievadīti. Izveidojiet rēķinu darbvietā.` (421-422) · `Nav piemērojams neviens norēķinu noteikums` (994) · `nav aktīva skaitītāja` (995) · `Norēķinu statuss` (402) · `Patēriņš` (400) · `Aukstais ūdens` (398) · `Karstais ūdens` (399) · `Pabeigt iestatīšanu` (1806) · `Turpināt iestatīšanu` (1809) · `Nākamais solis` (48) · `Iestatīšanas soļi` (1788) · `Pabeigts` (1726) · `Jāveic` (1727) · `Organizācijas dati` (1711) · `Īpašumi` (358) · `Pirmais norēķinu periods` (1677) · `Maksas` (1674) · `Skaitītāji un sākuma rādījumi` (1712).

Terminology inconsistencies noted: dashboard KPI "Total invoiced" = `Rēķinu kopsumma` (396) but workbench KPI "Invoiced" = `Izrakstīts` (261) for the same number; "Paid" KPI reuses the masculine status adjective `Apmaksāts` (380). "Dwelling" is rendered `Īpašums` ("property"), a deliberate generic term across the app. Counter "1 / 5 pabeigts" uses a lowercased status string instead of a plural form.
