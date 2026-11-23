# Admin dashboard guidelines

Dated 2026-10-28. Applies to `/admin/o/:orgId/dashboard`
(`src/pages/admin/o/[orgId]/dashboard/index.astro`).

Status (2026-10-30): the backlog in section 7 is mostly built. The decisions
and the money definitions are in [ADR 0015](../decisions/0015-dashboard-redesign.md),
with a compact-layout addendum and a less-dense addendum. Sections 1 to 6 are the research baseline. They
describe the page before the change where they say "today". Section 7 marks what
is done and what is open. Section 10 has the above-the-fold rules.

Status (2026-11-11): the owner chose to keep the money card and the Readings
card above the next-step band, with the money breakdown always visible. The
"Layout as built" and "Less dense" paragraphs in section 3 describe the earlier
order (band first, money panel beside the list). The 2026-11-11 addendum of
ADR 0015 has the current layout, and section 10 is rewritten for it.

Source: [the research report](../../reports/Dashboard%20UX%20for%20Latvian%20coop%20admin.md)
and its [working notes](../../research_notes/Dashboard%20UX%20for%20Latvian%20coop%20admin/)
(`01_current_state_audit.md`, `02_admin_needs_and_content.md`,
`03_ui_guidelines_evidence.md`, `04_codex_second_opinion.md`). The notes hold the
file:line evidence. Keep both in place.

The normative requirement list is still
[ORCA_PROPERTY_BILLING_ASTRO_SPEC.md](ORCA_PROPERTY_BILLING_ASTRO_SPEC.md)
section 27. This file adds guidance. It does not replace that list.

## How to read the markers

- **Verified**: read or run in this repository, or retrieved from a cited page.
- **Inferred**: reasoning from the verified facts. No user has confirmed it. Do
  not present it as fact in product copy or other docs.

## 1. Persona (inferred)

A volunteer or part-time administrator of a Latvian house association or
cooperative, about 50, with low confidence in software and a background in Excel
and paper. No persona document existed before this one. Age, skill, volunteer
status, building size and Excel habits are assumptions. The nearest written
evidence is the spec phrase "housing associations, cooperatives and small
property managers" and the Excel and Windows-1257 context in
[ADR 0013](../decisions/0013-migration-center.md).

Design consequence: the admin wants one column that adds up, plain words and a
clear next step. A page that is only correct is not enough.

## 2. The monthly cycle

Owners read meters monthly and pass the readings on (MK Nr. 524, point 2). The
manager holds the bank account, pays suppliers and reports to owners at least
once a year. No fixed legal deadline for readings or billing was found. Owners or
contracts decide. Sources are secondary (lvportals.lv, Vēstnesis). The primary
texts on likumi.lv were not reachable. Law is changing in 2026.

The admin's questions, in order (inferred): Where are we in the month? Who has
not given readings? Can I bill? Did the bills go out? Who has paid and who owes?
Does anything look wrong? What is coming?

## 3. Content guidelines: what to show

About four blocks, in this order (inferred, from the Cowan estimate of roughly
four chunks):

1. Month heading with a one-sentence status and one primary next-action button.
2. A four-step progress line: readings, invoices, sent, paid. Each step shows a
   text state ("Pabeigts", "Jāizdara", "Vēl nav pieejams"), not only colour.
3. A money summary that reconciles. State the basis (see rules below).
4. An exceptions list, capped at about five rows, with "show all N".

Everything else is one link away.

Layout as built (2026-10-28, second round, [ADR 0015](../decisions/0015-dashboard-redesign.md)
addendum): one header row (month title and badge, joined period control). Under
it the status band: sentence, deadlines, primary button and the four-step strip.
Below the band, two columns from 56 rem: the attention list on the left and one
money panel on the right. The three KPI cards are gone. Readiness chips, case
counts and water sit in the closed "Papildu informācija" section. Below 56 rem
the columns stack, with the attention list before the money panel. Section 10
has the rules for what must be visible.

Less dense (2026-10-30, ADR 0015 addendum): the sentence in the band is the focal
point (22 px semibold) beside the primary button. There is no separate deadlines
row. Each deadline sits in its progress step ("līdz 30.09."), and only the
current step shows a visible "Tagad". The attention list is grouped by kind with
one quiet heading per group (icon, title, count) and no per-row badge. A row is
the dwelling link, one muted detail line and the action. The cap is 5 rows across
groups, with "+N vēl" and "Rādīt visus (N)".

Density rule: density comes from equal-weight fragments. One focal point per
block, group instead of repeating badges, put each deadline where it belongs.

Money rules (verified problem, proposed fix):

- "Total invoiced" today is current charges only. "Paid" and "Outstanding" use
  the full amount due (current charges plus carried debt, credits and late fees).
  For a dwelling with arrears the three cards do not add up.
- Headline the amount due. Show the breakdown (this month's charges, carried
  debt, credits, late fees) or label the basis on each figure.
- Say whether draft invoices are included, or exclude them.
- "Paid" means allocations against this period's invoices, not cash received this
  month. Say so, or rename it.
- Show zeros as "0,00 €", not blank.

Exception rows: dwelling number and amount, not resident names. An overdue row
shows amount, due date and days late, and links to Payments filtered to that
dwelling.

## 4. Priority matrix (inferred)

| Item | Placement |
|---|---|
| Month, phase, one next action | Must-see-now |
| Readings received X of Y | Must-see-now |
| Blockers to billing (missing meter, tariff, owner data) | Must-see-now |
| Money: billed, received, still owed, on one stated basis | Must-see-now |
| Overdue count and total, amount and due date per dwelling | Must-see-now (summary); detail one click away |
| Invoices ready / sent / not delivered | Must-see when action is needed |
| Reading deadline and invoice due date (inside the progress steps since 2026-10-30, "līdz 30.09.") | Should-see |
| Unmatched or partial incoming payments | Should-see |
| Water difference above 20% for three months, three-month estimate flag | Should-see, conditional (needs house-meter data the product may not model) |
| Collection rate, largest or oldest debtors, consumption variance | One click away |
| Per-dwelling ledger, audit, period history, annual export | One click away |
| Debtor names as a list on the home screen | Not by default (privacy) |
| Charts, trends, analytics, AI, raw ledger, setup checklist after completion | Never on the dashboard |

The service blueprint limits the dashboard to "monitoring and prioritization".
Keep it a month summary, not an analytics page.

Open product decisions, not UI work: supplier-invoice comparison, budget and
reserve fund, house-meter water-difference alert, annual owner report and
general-meeting (kopsapulce) reminders. None is modelled today.

## 5. UX considerations

- One task per page, glanceable on one screen, at most two levels of progressive
  disclosure (NN/g).
- Keep the desktop sidebar visible. Hidden navigation hurts discoverability.
- Use a table for comparable numeric rows (Excel familiarity), with a visible
  totals row and tabular numerals. Prefer bars to pies, donuts and gauges.
- No tooltip as the only explanation. No auto-refreshing numbers. No toast for an
  error. Use fix-oriented error messages and tolerant input formats.
- After a form action, refresh the whole summary. Today the readings drawer
  refreshes only the attention list and status counts, not the money cards.
- A database error or a bad `periodId` must show an error state, not a silent
  redirect to the periods list.
- Setup must not claim more than it checks. Show configuration complete, billing
  ready and ready to send as separate states (Easybilly "overclaims readiness"
  friction).
- Open question, not settled: money first, or progress and next action first.
  This report favours next action first. No user evidence either way.

## 6. UI guidelines

**Borders and layout** (user feedback, 2026-10-28): use uniform 1px neutral
borders. No thick or colored top edges, progress dividers or selected-navigation
stripes. Keep status in icons and text, and selection in surface fills; preserve
accessible focus outlines and validation indicators. Period navigation spans the
full content width, with two equal-width buttons. (Since the compact layout the
period buttons are a joined 44 px control in the header row, not a full-width
row.) The money breakdown uses aligned rows, tabular amounts, an operator column
(+, -, =) and a total distinguished by type and a neutral surface fill, without
reserved empty space at the side.

**Size and targets** (WCAG verified; 16 and 18 px are inferred for this user):

| Item | Value |
|---|---|
| Body text | 16 px floor, 18 px preferred, line height 1.5 |
| Operational text | 16 px. Today it is mostly 12 to 14 px |
| KPI values | 28 to 32 px |
| Primary controls and button labels | 44 px high, 16 px label. Today the main button is 42 px with a 14 px label |
| Pointer target | 24 px minimum (AA), 44 px aim (AAA) |
| Contrast | 4.5:1 minimum (AA), 7:1 for body text and key figures. Light-mode muted text (5.4 to 5.8:1) and badges (4.9 to 7.8:1) already pass AA |

**Status encoding** (verified): every status combines icon, text and colour.
Fix the tones: READY uses an info or success tone, OVERDUE uses danger, and
"Outstanding" stays neutral unless something is overdue. Today READY and OVERDUE
share amber, and Outstanding is amber even when nothing is due.

**Numbers, dates, currency (lv-LV)**:

- `Intl` with `lv-LV` gives "1 234 567,89 €" (symbol after the amount, with a
  non-breaking space), "5.10.2026." and "2026. g. oktobris" (verified, Node 22,
  CLDR 48).
- Four-digit amounts are not grouped by default ("1234,50 €"). Force grouping in
  money columns so they align.
- Month names are nominative only. "In October" needs the locative "oktobrī",
  which the library does not produce (general grammar, not a retrieved source).
  Use nominative constructions ("Periods: 2026. gada oktobris") or a hand-written
  month table.
- A 2014 Latvian Language Commission decision (secondhand) prefers "eiro" in
  running text.

**Latvian wording rules** (inferred; no authority source for address form):

- Use neutral imperatives and nouns ("Pārbaudiet summas", "Rēķini ir gatavi"),
  not a Jūs or tu address.
- One term per figure across pages. Today the dashboard says "Rēķinu kopsumma"
  and the workbench says "Izrakstīts" for the same figure.
- No calques ("darbvieta" for workbench). No English enum codes inside Latvian
  text. `i18n.ts` around lines 1486 and 1495 shows DRAFT and PREPARED.
- Do not build a counter by lowercasing a status word ("1 / 5 pabeigts").

**Proposed strings** (not native-reviewed):

| Current | Proposal |
|---|---|
| Atvērt norēķinu darbvietu | Atvērt mēneša norēķinus |
| Rēķinu kopsumma | Izrakstīto rēķinu summa (with a basis line) |
| Apmaksāts (KPI) | Saņemts maksājumos |
| Neapmaksātā summa | Vēl neapmaksāts |
| Kavēts | Nokavēts / Termiņš nokavēts |
| Gatavs rēķina izrakstīšanai | Var izrakstīt rēķinu |
| Pievienot rādījumus | Ievadīt rādījumus |
| Nepieciešama uzmanība | Jāizdara or Jāpārbauda (weak preference) |
| Īpašums (for "dwelling") | Needs native check; an admin of flats may say "dzīvoklis" |

## 7. Change backlog

Effort and impact are judgement, not measured. Effort: S small, M medium. Every
new query costs about 34 ms in production (work log).

Status as of 2026-10-28, checked against the code (see
[ADR 0015](../decisions/0015-dashboard-redesign.md)). Done means built and run
in the browser, not user-tested.

| # | Status |
|---|---|
| 1 | Done. Headline "Total to pay" (`amountDue`), breakdown, unsent-invoice note, definition line |
| 2 | Done. Four-step progress and a state-aware primary action, "Create next month" after a lock |
| 3 | Mostly done. Amount, due date and days late are shown. The row links to the plain Payments page: it has no dwelling filter |
| 4 | Done. READY, DRAFT and PREPARED rows, cap of 5, "Show all (N)" (`?all=1`), dwelling numbers |
| 5 | Mostly done. Wording pass and counter fixed. No native review. English is still the default locale |
| 6 | Done. One "Coming up" line; since 2026-10-30 the deadlines sit inside their progress steps and the row is gone |
| 7 | Mostly done. Operational text 16 px, controls 44 px. The KPI cards were removed in the compact layout, so the money total is the large figure. Status badges are 15 px (were 14) and eyebrows are 12 px. Both are shared tokens |
| 8 | Done. READY is info, OVERDUE is danger, Outstanding is neutral unless a case is overdue |
| 9 | Done. Water is in the closed "Additional information" section with a carried-forward note. No variance alert |
| 10 | Done. Readiness (setup complete, all readings entered, ready to send) after setup. Since the compact layout the chips sit inside the closed "Additional information" section |
| 11 | Done as counts: unmatched payments, suggested matches, failed deliveries. No lists |
| 12 | Mostly done. Dead CSS removed, one case query, error state, period-scoped queries, locked-month label. `getCurrentOpenPeriod` is unchanged and the page skips the starting-readings period itself |

Original backlog, for reference:

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | Make the money block reconcile (amount due headline plus breakdown, or a basis line; draft hint). `carriedOutstanding`, `creditsApplied`, `lateFees`, `amountDue` are already computed. `KpiCard` already supports an unused `hint` | S | High |
| 2 | Four-step progress strip and a state-aware primary action instead of the constant "Open workbench". Add "Create next month" after a lock | M | High |
| 3 | Amount, due date and days late on overdue rows; Payments filtered to the dwelling. `dueDate` must be added to the case query | S-M | High |
| 4 | READY and PREPARED work in the to-do list; cap at about five rows with "show all N"; dwelling numbers, not names | S | High |
| 5 | Latvian wording pass, the "pabeigts" counter, enum codes in help text, native review; consider Latvian as the default admin locale | S | High |
| 6 | One "Tuvākie termiņi" line from `readingDeadline`, the invoice issue date and `invoiceDueDate` | S | Medium |
| 7 | Raise operational text to 16 px, controls to 44 px, KPI values to 28 to 32 px. Shared tokens: check other pages | M | Medium-High |
| 8 | Re-tone statuses (see section 6) | S | Medium |
| 9 | Demote the water card to a variance exception or a linked page; flag carried-forward readings | S | Medium |
| 10 | Persistent readiness indicator after setup (data is in `getSetupProgress`) | M | Medium |
| 11 | Unmatched-transaction and delivery-failure counts as exception rows (the admin guide already promises them) | M | Medium |
| 12 | Cleanup: dead CSS (`.dashboard-totals`, `.dashboard-period-list`), one heading and definition list per KPI, one case query, an error state, allocation queries scoped to the period, a label for a locked month | S-M | Low-Medium |

Also noted in the report (verified from code): `getCurrentOpenPeriod` does not
exclude the starting-readings period, so the dashboard can select a period the
navigation does not list. A short ADR for the dashboard's money definitions is
worth writing when change 1 is built. It is written: ADR 0015.

## 8. Verified versus inferred

Verified: the current page structure and lifecycle behaviour, the KPI
arithmetic, the unused data, the documentation inconsistencies, the Latvian
strings and their lines, the contrast ratios, the dead CSS, 28 of 32 checked
Codex claims, the WCAG criteria, the NN/g findings, `Intl` output for `lv-LV`,
and the secondary-source statements of Latvian law.

Inferred: the persona, the reconstructed Excel practice, the question order, the
whole priority matrix, the "about four blocks" limit, 16 to 18 px as ideal for
this user, every Latvian wording proposal and the address-form choice, the
locative rule, hiding debtor names by default, and the effort and impact ratings.

Not done at the time of the research: no live render, keyboard, zoom or
dark-mode review; no user research; no native Latvian review; no statute-text
check. Since then the new page had two live Playwright reviews. Still not done:
user research, native Latvian review, the statute-text check, and a keyboard,
zoom and dark-mode review.

## 9. Open questions

Still open after the build (2026-10-28):

- Native Latvian review of every string and of the Jūs versus neutral choice.
- User testing with two or three real coop administrators on a populated
  screenshot. Settles money first versus next action first (the page is next
  action first, with no user evidence either way), and confirms the persona.
- Does the product need house-meter data for the 20% water-difference alert?
  Not built.
- Which of the deferred product items (supplier costs, reserve fund, annual
  report) belong in the roadmap? The supplier-cost comparison is not built.
- Latvian as the default admin locale. The spec names Latvian canonical, but the
  UI defaults to English unless a cookie or `Accept-Language` says otherwise.
- Status badge (14 px) and eyebrow (12 px) sizes. They are shared tokens, so a
  change touches every page.
- Payments page has no dwelling filter, so an overdue row links to plain
  `/payments`.
- Codex has not reviewed the final compact layout (its usage limit reset at
  23:26 on 2026-10-28). Run that review.
- The last CSS fixes are not browser-verified: money panel icon and baseline,
  1024 title truncation, Russian 2 by 2 progress strip, chip clearance at 1024
  ([KNOWN_GAPS.md](../KNOWN_GAPS.md)). The v5 live review found no text collisions
  in lv and ru at four widths, before those fixes.
- Money first versus next action first is untested with users.
- The final less-dense pass (2026-10-30) is not browser-verified: the 1280 action
  column wrap, the 375 Russian progress strip and the 375 period navigation
  height (46 px). Re-measure the table in section 10 afterwards
  ([KNOWN_GAPS.md](../KNOWN_GAPS.md)).
- The readings drawer shows "Iepriekšējais rādījums: —" for a dwelling that has an
  earlier reading, and its save gives no chip feedback beyond the idle state
  ([KNOWN_GAPS.md](../KNOWN_GAPS.md)).
- The guide step wording remains open ([KNOWN_GAPS.md](../KNOWN_GAPS.md)).
  The guide screenshots were refreshed on 2026-11-12.

## 10. Above the fold

Rewritten 2026-11-11 for the cards-on-top order (ADR 0015, 2026-11-11 addendum).
The owner chose this order knowing that the attention list starts lower than in
the band-first layout. The positions are measured on the live page (Latvian) in
the September 2026 demo month (arrears, overdue rows, two passed deadlines). They
are distances from the top of the page.

| Viewport | Cards bottom | Primary button | Band bottom | Attention rows 1, 2, 3 |
|---|---|---|---|---|
| 1440 x 900 | 340 px | 380-424 px | 533 px | 664, 728, 792 px |
| 1280 x 720 | 340 px | 380-424 px | 533 px | 664, 728, 792 px |
| 1024 x 768 | 403 px | 443-487 px | 596 px | 727, 791, 855 px |
| 768 x 1024 | 559 px | 599-643 px | 805 px | 936, 1000, 1064 px |
| 390 x 812 | 649 px | 722-766 px | 1004 px | 1127 px (row 1) |

History at 1440 x 900: the band-first layouts had the band at 238 to 266 px and
the first row at 307 to 387 px (v5 to v7). The cards-on-top layout before this
pass had the band at 562 px and the first row at 693 px.

Rules:

- **1440 x 900:** the header, both cards, the whole status band and the first
  three attention rows are visible without scrolling.
- **1280 x 720 and 1024 x 768:** the cards and the whole status band with the
  primary button are visible. The attention list starts at the fold. That is
  accepted.
- **390 x 812:** the header, the money card (breakdown closed) and the primary
  button are visible. The attention list starts below the fold.
- The primary button is always inside the status band, never below the list.
- Do not put anything between the band and the list. New blocks go into the
  closed "Papildu informācija" section or after the list.
- The attention list is grouped by kind (one quiet heading per group, no per-row
  badge) and capped at 5 rows across groups. A row that duplicates the primary
  button is omitted.
- Density comes from equal-weight fragments: one focal point per block, group
  instead of repeating badges, put each deadline where it belongs.
- The two cards share a row while the money card has 35 rem. The money card puts
  the breakdown beside the total from 32 rem of card width. The progress strip
  is four across from 48 rem of band width and 2 by 2 below.
- A step shows a passed deadline only as a warning with its icon and the days
  late. The invoice issue date is not a deadline and is not shown in a step.
- Re-measure after any change to the header, the cards, the band or the row
  height. The numbers above are from one demo state. More rows, longer labels,
  a manual-adjustment line or a late deadline move them.

The fixed status chip must not cover content. It is a 44 px circle when idle and
expands on hover, focus and activity. It still overlaps the right edge of the
panels ([KNOWN_GAPS.md](../KNOWN_GAPS.md)).
