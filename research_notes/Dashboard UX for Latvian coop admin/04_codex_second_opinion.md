# Codex second opinion on the Namkopa admin dashboard (as of 2026-10-28)

## Method and caveats

- Model: Codex CLI v0.164.0, `gpt-5.6-sol`, foreground, `-s read-only`. Two passes: CONTENT and UI.
- **First attempt discarded.** In this sandbox Codex cannot spawn a shell (`CreateProcessAsUserW failed: 5`, see `codex_out_1.txt`). It silently fell back to the GitHub connector, which only sees committed HEAD (943a2eb). The working tree has uncommitted dashboard changes (setup banner, +275 lines in `index.astro`), so its line numbers were stale.
- **Re-run with embedded source.** Both passes were re-run with the working-tree files embedded in the prompt with line numbers. Codex was told to cite only those numbers. Prompts and raw outputs are in this folder (`codex_prompt_1b.txt`, `codex_prompt_2b.txt`, `codex_out_1b.txt`, `codex_out_2b.txt`). Docs under `docs/` were still read through the GitHub connector (unchanged files).
- Codex only saw `global.css` lines 1-300, 395-430, 500-560 and 630-810, and `i18n.ts` 370-430. Two of its UI claims are weakened by that (see table).
- Verification below was done by me against the working tree (Read/Grep, plus a script for contrast ratios). Labels: VERIFIED / WRONG / OPINION.

---

## PASS 1 - CONTENT (Codex, lightly condensed)

**What a monthly dashboard must answer.** It is a decision screen: monitoring and prioritisation here, execution in the workbench (SERVICE_DESIGN_BLUEPRINT.md:99-100).
1. Are inputs complete? "Readings received for X of Y dwellings", the reading deadline, and separate counts for missing readings, missing manual inputs, missing meters and absent rules. `MISSING_DATA` covers all four (case-readiness.ts:57).
2. Can invoices be issued? Ready X/Y, blocked X/Y, blocker categories, one explicit next action.
3. Were invoices issued and delivered? Generated, prepared, sent or recorded on paper, failed, not yet sent (USER_JOURNEYS.md:63, :75).
4. Who paid and who owes? Collected, remaining, partial payments, debtor count, and a drill-down with dwelling, amount, due date and state.
5. What is overdue? Count, total amount, oldest due date, largest debtors.
6. What is unusual? Failed delivery, unmatched payment, overpayment or credit, missing recipient or delivery details, unusual consumption change.

**What it shows today.**
- Period: an explicit `periodId` wins, then the current OPEN period, then the first listed. Starting-readings periods are excluded (index.astro:42, :53). Header has month, OPEN/LOCKED badge, prev/next links and "Open workbench" (:248, :273).
- Three KPIs: Total invoiced, Paid, Outstanding, with no hints (:306; KpiCard.astro:35).
- "Needs attention": a count, then only MISSING_DATA and OVERDUE dwelling rows (:343, :353). Missing rows list blockers and offer "Add readings". Overdue rows only say the payment is late and link to Payments (:404, :459).
- Case status: 7 linked counts (:109, :476). Consumption: cold and hot water totals in m3 (:497).
- Setup banner shown only while onboarding is incomplete (:158). With no period, "Create period" (:220).

**Missing or misleading (Codex).**
- "Total invoiced" is mislabelled. It is only the sum of `invoice.currentCharges` (dashboard.ts:126, :156), excluding carried debt, credits and late fees.
- The three KPIs do not share one basis. Paid and Outstanding use `amountDue` (:135, :143), so Paid + Outstanding reconciles to amount due, not to Total invoiced.
- "Paid" is allocation against this period's invoices, not cash received this month.
- Dashboard and workbench can disagree. The dashboard drops invoices whose currency differs from the org's current currency (dashboard.ts:81-87). The case query does not (cases.ts:65). The drawer refresh targets only the attention and status sections, not the KPIs or consumption (index.astro:246).
- "Missing data" is not a missing-readings count (case-readiness.ts:28, :44, :51).
- READY and PREPARED need action but are not in attention (dashboard.ts:45). The 7 equal rows mix blockers, work in progress and outcomes.
- Overdue rows show no amount or due date although `invoiceAmountDue` is already fetched (cases.ts:69).
- No next-step cue after setup; only the generic "Open workbench" (:263).
- Delivery failures and unmatched payments are absent (invoice-status.ts:27).
- Raw water totals count only submitted `m3` readings, so missing readings lower the total, with no completeness or comparison (dashboard.ts:172-187).

**Priority matrix (Codex).**

| Bucket | Items |
|---|---|
| Must-see-now | Month/status, deadlines, X/Y readings complete, ready-to-invoice X/Y, sent X/Y, paid/outstanding, overdue count and amount, critical exceptions, one explicit next action |
| Should-see | Current charges vs carried debt/credit/fees, collection rate, partial payments, largest/oldest debtors, consumption variance vs prior month |
| One-click-away | Full 7-state breakdown, debtor list, individual blockers, delivery records, unmatched-payment queue, consumption history, invoice/payment audit |
| Never-on-dashboard | Raw ledger rows, full audit trail, config forms, budgets/documents, AI assistants, raw water totals without comparison |

(The earlier, stale-HEAD run also asked for separate "ready to invoice N" and "sent by email / paper / failed" lines. The second run folded these into the rows above.)

---

## PASS 2 - UI (Codex, lightly condensed)

**Hierarchy.** The eye goes to the month heading (~30-40 px), then the primary button, then the KPI values, then the small badge and attention list. Codex judged the top band (month + status + one primary action) correct, and the order KPIs, attention, status, consumption right for an Excel-minded admin. If attention items exist they need more visual weight, but should not move above the totals. It also says "current month" is not guaranteed (index.astro:53) and suggests labelling "Aktīvais periods" / "Iepriekšējais periods". It suggests excess space between header and period nav (`space-y-6` plus `.page-header` margin-bottom 1.75rem).

**Latvian wording (Codex proposals).**

| Current | Codex's issue | Better |
|---|---|---|
| Rēķinu kopsumma | vague | Izrakstīto rēķinu summa |
| Apmaksāts (KPI) | awkward as a monetary KPI | Saņemts maksājumos |
| Neapmaksātā summa | may read as overdue debt | Vēl neapmaksāts |
| Nepieciešama uzmanība | bureaucratic calque | Jāizdara |
| Norēķinu statuss | unclear what is counted | Rēķinu statuss pa īpašumiem |
| Atvērt norēķinu darbvietu | "darbvieta" is jargon | Atvērt mēneša norēķinus |
| Kavēts | does not say what is late | Nokavēta apmaksa |
| Gatavs rēķina izrakstīšanai | system-like | Var izrakstīt rēķinu |
| Pievienot rādījumus | acceptable | Ievadīt rādījumus |
| Patēriņš | too broad | Ūdens patēriņš |

Sentences: "Maksājuma termiņš ir pagājis. Pārskatiet maksājumu saskaņošanu" (i18n.ts:419) becomes "Apmaksas termiņš ir nokavēts. Pārbaudiet, vai maksājums ir saņemts". "Visi rādījumi ir ievadīti. Izveidojiet rēķinu darbvietā" (:421) becomes "...Tagad var izveidot rēķinu". English leakage risks: legacy string `missingData` rendered verbatim (index.astro:421); unknown statuses fall back to the raw enum (invoice-status.ts:31); "No billing rule applies" / "no active meter" may lack translations.

**Density and size.** Most operational text is 12-14 px (global.css:407, :732, :752). Recommended: 16/24 px body and attention text, at least 14/20 px badges, 18 px/600 section headings, KPI values 28-32 px. Primary button is 42 px (global.css:507), slightly under the 44 px target. Period links, attention actions and status rows are already 44 px. Remove the repeated "Pirms rēķina izveides nepieciešami rādījumi" caption (index.astro:436), and the routine empty-attention state does not need 3rem padding.

**Status and contrast.** Badges combine icon, text and colour. Codex's light-mode contrast estimates: muted #58666c is 5.42:1 on canvas and 5.81:1 on surface; warning badge 6.17:1; info badge 7.81:1. All pass AA. READY and OVERDUE share the amber "warning" tone (invoice-status.ts:8, :13); READY should be info or success and OVERDUE danger. The amber Outstanding KPI implies a problem even when nothing is due (index.astro:327).

**Accessibility.** The skip link and focusable `<main>` are good. Disabled period items are spans, which is fine. Each KPI renders an `<h2>` (KpiCard.astro:24), so three metrics read as peer sections before the real "Jāizdara"; suggests one group heading plus dl/dt/dd. Custom links have hover but "no local `:focus-visible`". Dead selectors `.dashboard-period-list` and `.dashboard-totals` (index.astro:676, :681).

**Proposed layout (Codex).**
```
NAMKOPA DZĪK                           Aktīvais periods
Oktobris 2026  [Atvērts]              [Atvērt mēneša norēķinus ->]
<- Septembris                                      Novembris ->

[Izrakstīto rēķinu summa] [Saņemts maksājumos] [Vēl neapmaksāts]

Jāizdara (3)
[Īpašums 12 · Trūkst rādījumu                 Ievadīt rādījumus ->]

[Rēķinu statuss pa īpašumiem]       [Ūdens patēriņš]
```
Keep the 3-column KPI grid and the 2:1 lower grid. Raise text to 16 px, badges to 14 px, controls to at least 44 px.

---

## Verification table (my checks against the working tree)

| # | Codex claim | Verdict | Evidence / comment |
|---|---|---|---|
| 1 | "Total invoiced" = Σ `currentCharges` only | VERIFIED | dashboard.ts:126, :156 (`totalInvoiced = currentCharges`) |
| 2 | Invoice query has no DRAFT/PREPARED filter, so "invoiced" includes unsent invoices | VERIFIED | dashboard.ts:63-80 filters only org + period |
| 3 | Paid + Outstanding reconciles to amountDue, not to Total invoiced | VERIFIED | dashboard.ts:135-155. Nuance: Outstanding is clamped at 0 (:145-153) but Paid is not clamped to amountDue, so for an over-allocated invoice the sum can exceed amountDue (inferred from code, not tested on data) |
| 4 | Dashboard drops other-currency invoices, workbench does not, and case counts are unfiltered | VERIFIED | dashboard.ts:87-89 vs cases.ts:65-69 and dashboard.ts:204-209. Low practical impact; only after an org currency change |
| 5 | Drawer refresh covers only attention + status | VERIFIED | index.astro:246 (`.dashboard-attention`, `.dashboard-case-status`) |
| 6 | Overdue rows have no amount/due date though amount is fetched | VERIFIED | Text at index.astro:405-408. `invoiceAmountDue` at cases.ts:69. `dueDate` is not selected by `listCasesForPeriod` (cases.ts:55-76) |
| 7 | "Current month" is not guaranteed; falls back to first period | VERIFIED | periods.ts:268-276 and :298-303. In practice always the latest non-opening period, because `getCurrentOpenPeriod` only checks the newest row. On 2026-10-28 with no November period it shows October, which is right, but a LOCKED latest month is shown without a "this is last month" cue |
| 8 | Starting-readings periods are excluded | VERIFIED, with a gap | index.astro:42-45. Gap (mine): `getCurrentOpenPeriod` (periods.ts:268) does not exclude `openingReadings`, so index.astro:55-57 can select a period that the nav list (:81-88) does not contain. Edge case, not tested at runtime |
| 9 | MISSING_DATA counts dwellings, covers meters/rules, not only readings | VERIFIED | dashboard.ts:204-209; index.astro:409-434 renders rule/meter blockers |
| 10 | READY/DRAFT/PREPARED are not in "attention" | VERIFIED | dashboard.ts:49 |
| 11 | Delivery failures and unmatched payments are absent from the dashboard | VERIFIED | `statuses` array index.astro:109-117 has only the 7 case states. FAILED/UNMATCHED exist only as badge vocabulary (invoice-status.ts:27-28) |
| 12 | Water totals are misleading (present readings only, strict `m3`) | VERIFIED | dashboard.ts:177-187. The app's own meter creation uses "m3" (migration/meters.ts:78-79), so the strict match is consistent |
| 13 | "Paid" is not cash received this month | VERIFIED | Allocations are mapped to this period's invoices (dashboard.ts:135-142). Side finding: the allocation and reversal queries load every org allocation, unscoped by period (:90-103). A perf concern, not a correctness one |
| 14 | KpiCard supports `hint` but none is passed | VERIFIED | KpiCard.astro:8, :35; index.astro:308-336 |
| 15 | No post-setup next-step cue; one generic CTA | VERIFIED | index.astro:264-270; setup banner only `!setupComplete` (:158) |
| 16 | READY and OVERDUE share the amber "warning" tone | VERIFIED | invoice-status.ts:8, :13 |
| 17 | Outstanding KPI is amber (warning tone) | VERIFIED | index.astro:327-330 plus global.css:749-751 |
| 18 | Each KPI renders `<h2>` | VERIFIED | KpiCard.astro:33 |
| 19 | Dead selectors `.dashboard-totals` and `.dashboard-period-list` | VERIFIED | The KPI wrapper is `<div class="grid gap-4 sm:grid-cols-3">` (index.astro:306) with no `dashboard-totals`; nothing uses `dashboard-period-list`. So the success/warning icon colouring rules (:681-688) never apply |
| 20 | Contrast numbers (5.42 / 5.81 / 6.17 / 7.81) | VERIFIED | I recomputed from the hex tokens (global.css:207-235): exact match. Extra: danger badge 6.92, success 6.81, neutral badge muted text 4.88, all AA. Contrast is not a problem in light mode |
| 21 | Text sizes 12/13/14 px; button 42 px | VERIFIED | global.css:407-421, :732-736, :752-759, :514 (2.625rem = 42 px). The button label is 14 px (:517), which Codex did not mention |
| 22 | Period links, attention actions, status rows are 44 px | VERIFIED | index.astro:665, :713, :748 (2.75rem) |
| 23 | Custom links lack a `:focus-visible` treatment | WRONG | A global rule exists: `:focus-visible { outline: 3px solid var(--color-primary-hover); outline-offset: 3px }` (global.css:320-323). Codex only saw global.css 1-300 and hedged, but the concern is unfounded |
| 24 | "No billing rule applies" / "no active meter" may lack Latvian entries | WRONG | Present: i18n.ts:994-995 ("Nav piemērojams neviens norēķinu noteikums", "nav aktīva skaitītāja"). Also in RU at :2958-2959 |
| 25 | Excess space from `space-y-6` plus `.page-header` margin-bottom | OPINION, probably wrong | Tailwind v4 spacing uses block-end margin on siblings and adjacent block margins collapse (max, not sum). It is a flow layout, not flex/grid, so no real doubling. Not checked in a browser |
| 26 | Disabled period items are spans with redundant `aria-disabled` | VERIFIED | index.astro:286, :300. Minor, harmless |
| 27 | Skip link and focusable main | VERIFIED | AdminLayout.astro:75, :156 |
| 28 | Legacy `missingData` strings are rendered verbatim | VERIFIED | index.astro:421-422 (`typeof m === "string" ? m`). Intentional legacy shim (comment :358-363) |
| 29 | Unknown statuses fall back to the raw enum | VERIFIED | invoice-status.ts:31-36. The 7 case states are all mapped, so this is not visible today |
| 30 | Latvian alternatives | OPINION | See "Latvian wording" below |
| 31 | Doc citations | MIXED | SERVICE_DESIGN_BLUEPRINT.md:99 and USER_JOURNEYS.md:58, :63 check out. USER_JOURNEYS.md:124, cited for "oldest due date, largest debtors", is actually the resident-portal row ("What do I owe and when?"). It supports "show amount and due date" for residents, not an admin debtor list. EASYBILLY:143 supports "defer unrelated modules". Treat "largest/oldest debtors" as Codex's own idea, not a documented requirement |
| 32 | Hierarchy ordering is right (totals, exceptions, breakdown) | OPINION | Reasonable. I partly disagree (see below) |

### Latvian wording: my assessment of Codex's proposals

- "Atvērt mēneša norēķinus" (instead of "norēķinu darbvietu"): agree. "Darbvieta" is a calque of "workbench".
- "Ievadīt rādījumus" and "Var izrakstīt rēķinu": agree; both are more natural and shorter.
- "Vēl neapmaksāts": agree. Its main benefit is that it no longer reads as overdue.
- "Saņemts maksājumos": acceptable. For the coop admin, "Saņemts" (received) is closer to what she counts in Excel than "Apmaksāts".
- "Jāizdara" for "Needs attention": understandable but a bit curt. "Jāpārbauda" or "Ko darīt" may be gentler. Weak preference, since my Latvian review is not native-level.
- "Kavēts" as an invoice status: Codex is right that it is unnatural. The standard word is "Nokavēts" or "Termiņš nokavēts" (also "Parāds" if it means debt).
- Not raised by Codex: `Dwelling` is translated "Īpašums" (i18n.ts:375). In a co-op of flats, "Dzīvoklis" is what the admin says. This is a judgement call, but worth a native check.
- Not raised by Codex: Latvian help text embeds English enum codes (i18n.ts:1486 "MISSING DATA ... DRAFT ... PREPARED ...", :1495 "PREPARED ... SENT, PAID or OVERDUE"). This is not on the dashboard itself, but it is exactly the leakage a non-technical user would trip on.

---

## Synthesis

### Where Codex and I agree (high confidence)

1. **The financial block is the weakest part of the page.** "Total invoiced" is current charges only, but "Paid" and "Outstanding" are measured against amount due, which includes carried debt, credits and late fees (rows 1-3). A non-Excel-expert cannot make the three cards add up. The data to fix this is already computed and unused (`carriedOutstanding`, `creditsApplied`, `lateFees`, `amountDue`; dashboard.ts:127-134, :220-234). Options: relabel to "Šī mēneša maksājumi", or show `amountDue` as the headline and `currentCharges` + carried as a small breakdown.
2. **The dashboard answers "what is wrong" but not "how far along am I".** There is no "X of Y dwellings have readings", no progress bar, no "next step" after setup. Only the setup banner has that, and only until onboarding is finished.
3. **Overdue rows are too thin.** Amount and due date are one join away (`invoices.amountDue` already selected; `invoices.dueDate` exists at invoices.ts:60). A list of debtors without amounts will send her back to Excel.
4. **Deadlines are modelled but not shown.** `readingDeadline` (billing.ts:80, nullable) and `invoiceDueDate` (billing.ts:82) exist in the period schema.
5. **Water totals are low-value as shown.** They are a partial sum with no completeness or month-on-month comparison. Fine to demote, or turn into a variance exception.
6. **Wording and sizing.** Replace "darbvieta", "Kavēts" and the vague KPI names. 12-14 px operational text is small for a 50+ low-tech user. Contrast is already adequate, so the problem is size, not colour.
7. **Status colour semantics.** READY and OVERDUE should not share amber. Outstanding in amber is mildly alarming for money not yet due.
8. **Cleanup.** Dead CSS (`.dashboard-totals`, `.dashboard-period-list`) means the KPI icon colour rules silently do nothing. Each KPI being an `<h2>` is a small structure issue.

### Where I disagree or qualify

- **Codex over-asks for the dashboard.** "Largest/oldest debtors, collection rate, partial payments, delivery-failure counts, unmatched, overpayment, anomaly variance" in the first two buckets is the dashboard of a mature product. For a coop admin who wants a summary of the month, a small set is enough: progress through the 4 steps (readings, invoices, sent, paid), money (due / received / still owed), and a short debtor list with amounts. The rest belongs one click away. The service blueprint itself says the dashboard "supports monitoring and prioritization" (SERVICE_DESIGN_BLUEPRINT.md:99), not analytics. Codex's "should-see" row should mostly move to one-click-away.
- **Hierarchy.** Codex says KPIs first, attention second. For this persona I would put the "what do I do next" band (progress + one next action) above or beside the money cards, because the page currently has a single generic CTA. This is an opinion, not a code finding. Codex says to keep the money first. It is a genuine disagreement and a good A/B candidate.
- **"Current month" label.** Codex's suggestion of an "Aktīvais periods / Iepriekšējais periods" tag is cheap and useful. But note the page effectively always shows the latest period, so the real gap is a missing "this month is LOCKED / is not the calendar month" cue, not a selection bug.
- **Wrongly flagged by Codex:** missing global focus style (row 23), possibly missing translations (row 24), and the spacing double-up (row 25) should not be acted on.
- **Missed by Codex:**
  - the opening-readings period can be chosen as the dashboard period even though the nav excludes it (row 8);
  - the attention count comes from `summary.needsAttention` while the list comes from a second, separate `listCasesForPeriod` query (index.astro:345 vs :67-68, :353). They are the same data, so it is harmless, but it is a duplicate query;
  - the allocation and reversal queries read every allocation for the org on each page load (dashboard.ts:90-103);
  - the English enum codes inside Latvian help text (i18n.ts:1486, :1495);
  - "Īpašums" vs "Dzīvoklis".

### Suggested order of action (for the human to decide; nothing was applied)

1. Fix the financial labels and add one explanatory line, or show `amountDue` as the headline (content, small code change).
2. Add a progress line ("Rādījumi 18/24 · Rēķini izrakstīti 0/24 · Nosūtīti 0/24 · Apmaksāti 0/24") and show the deadlines from the period schema.
3. Add amount and due date to overdue rows. Add READY ("Var izrakstīt rēķinu") to the "to do" list.
4. Rename the Latvian strings listed above, with a native-speaker pass.
5. Raise the font sizes and re-tone READY / OVERDUE / Outstanding. Remove the dead CSS.
6. Demote water consumption to a one-click-away page, or turn it into a comparison.

### Gaps

- No live render, keyboard test, zoom test or dark-mode check was done by Codex or by me. All UI findings are static-code judgements.
- No user research with real coop admins. Persona-fit statements are reasoning, not evidence.
- Codex's Latvian suggestions and mine are not native-reviewed.
- Row 3 (Paid + Outstanding exceeding amountDue) and row 8 (opening-period edge case) are from reading the code, not from running it.
