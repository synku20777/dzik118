# Current Month workbench

Current layout: see [Second pass (2026-11-11)](#second-pass-2026-11-11) at the
end. The sections before it record the first pass. Its stage rail, status
dropdown, three large money figures, "billing inputs" column and labelled phone
cards are replaced.

The billing queue is the primary work area. Period context and finances sit above it; tariff explanations and adding missing dwellings remain available below it. The visual direction is a precise, warm operations console using the existing Switzer/Fraunces typography, slate palette, and semantic tokens.

Reference: [Ubiquiti's UniFi Network 9.1](https://blog.ui.com/article/releasing-unifi-network-9-1) emphasizes visibility, direct control, and richer actionable tables. This implementation applies those principles to billing rather than copying network-specific widgets. “Better than UniFi” is a design ambition, not a measured comparative claim.

## Changes

- Replaced the oversized workflow cards with compact stage filters, real counts, an explicit active state, and readable wrapping across supported languages.
- Aligned the financial strip with the dashboard: total amount due includes carried balance, credit, and late fees; current charges remain separately labelled. Received and unpaid use the same amount-due baseline.
- Consolidated search, status, stage filters, result counts, and the table into one work area. Added a regular GET submit button for keyboard and JavaScript-free use.
- Kept existing billing generation, preparation, sending, and locking actions as the authority. No domain arithmetic or mutation eligibility rules were replaced.
- Search and status selection submit on Enter or Apply; typing pauses and arrowing through native select options never navigate unexpectedly. Stage links remain immediate shortcuts.
- Added visible selected-row treatment and a contextual bulk toolbar. Native popovers render row actions in the top layer so the table cannot clip them and opening them cannot resize columns. Viewport-aware positioning keeps actions reachable; native Escape and outside clicks dismiss them. The header disclosure retains its existing dismissal handlers.
- Added an accessible name and description to the lock confirmation.
- Drawer refresh now emits a narrow lifecycle event. Workbench listeners are delegated and abort on page swaps; replaced rows regain selection state and mobile column labels. Drawer dismissal restores focus to the replacement control, the row’s next action, or the queue heading when filtering removes the row.
- Healthy billing inputs use one muted completion check, with email readiness kept available to assistive technology; exceptions and paper delivery remain explicit. Invoice identifiers stay on one line.
- Period resources are collapsed initially, with applying/total tariff counts visible in the summary. Blocker rows continue to link to the applicable tariff or dwelling settings.

## Verification

- Unit regressions: 344 tests passing.
- Browser regressions: all 11 affected checks pass (10 shared/dashboard checks plus the final dedicated Current Month check). Production build passes.
- Source lint passing.
- Astro diagnostics retain the six existing `Env.BROWSER` binding errors outside this change.
- The dedicated browser regression compares dashboard/workbench amounts, verifies stage and search filtering, bulk selection and eligibility after fragment replacement, menu dismissal, drawer dismissal, lock confirmation cancellation, empty results, and inspection of the seeded locked prior period.
- Responsive matrix: EN/LV/RU, light/dark, 320/390/768/1024/1440px. It checks page overflow and mobile labels. Actual financial mutations are not submitted by these visual/interaction tests.

## Council review

Round 1: Opus 8/10 (satisfied, no blockers), Sol 8.8/10 (search/focus fixes requested), Gemini Flash 9.8/10 (satisfied, no blockers).

Accepted refinements: explicit search submission; focus restoration after fragment replacement and filtered-row removal; native popovers to eliminate menu-driven table shifts; one muted completion indicator for healthy input state; select padding, adjacent stage counts, and unbroken invoice identifiers.

The status dropdown is retained because it provides the combined DRAFT + PREPARED queue used by dashboard deep links. That combined queue is explicitly named in the result description; individual stage links continue to represent exact domain statuses. No new domain status was invented.

Rounds: 2. All three reviewers are satisfied with no blockers.

| Delegate | Round 1 | Round 2 |
| --- | --- | --- |
| Claude Opus | 8/10 | 9/10 |
| GPT Sol | 8.8/10 | 9.5/10 |
| Gemini Flash | 9.8/10 | 9.8/10 |

Final small cleanups: removed the duplicate mobile completion style, made status selection explicit-submit like search, and stabilized screenshots against shared button theme transitions. The browser test verifies both Apply submission and immediate stage shortcuts. Possible one-frame native-menu positioning and the wrapping longest stage label remain cosmetic observations; neither was observed as a blocking defect. The floating check indicator is the pre-existing shared MutationStatus component, outside this page change.

## Second pass (2026-11-11)

A review of the live page found that the work list started too low and that
parts of it were out of reach. The owner chose every change below.

Measured before (Latvian unless stated, September 2026 demo month):

| Viewport | Table needed | Table had | First case row |
| --- | --- | --- | --- |
| 1440 x 900 | 1114 px | 1114 px | 640 px |
| 1280 x 720 | 1100 px | 963 px | 742 px (below the fold) |
| 1024 x 768 | 1100 px | 976 px | 748 px |
| 1024 x 768, Russian | 1217 px | 976 px | 770 px |
| 768 x 1024 | 1100 px | 720 px | 823 px |
| 390 x 812 | cards | cards | 1051 px; page 5974 px tall |

The "Next action" column and the row menu were cut off wherever the table was
wider than its panel (all of them in Russian at 1024 px). The stage tabs needed
1300 px and had 1114 px at 1440 px, so "Paid" was hidden with no cue.

Changes:

- **Header.** Title and status badge on the left. On the right: previous and
  next month as one joined control (no placeholder when there is no neighbour),
  then "Enter readings", "Generate all eligible" and the lock menu. The right
  group drops to its own row when the two do not fit. The helper sentence is
  removed. A locked month shows the month navigation only.
- **Money.** One line: total to pay, received, still unpaid, as label and
  amount in normal text. "Current charges" shows only when it differs from the
  total. The breakdown is on the dashboard.
- **Filters.** The stage tabs are the only status filter. They have no icons and
  wrap to more rows instead of scrolling, so no stage is hidden. The status
  dropdown and the Apply button are removed. Search submits on Enter and keeps
  the active stage. The dashboard link `?status=UNSENT` still works: no tab is
  active, and the result line names "Draft and prepared invoices". The result
  line and "Clear filters" show only while a filter is active.
- **Table.** Five columns: select, dwelling, status, invoice, next action, plus
  the row menu. The "billing inputs" column is removed. Problems and the paper
  delivery note sit under the status as plain text with an icon, coloured by
  meaning. The healthy "required readings complete" line is removed. The table
  has no minimum width.
- **Narrow panels.** When the queue panel is narrower than 54 rem (a container
  query, so it follows the panel and not the screen), each case is three short
  lines: dwelling and amount, status with any problems, then the action and the
  menu. This replaces the labelled `stack-table` cards on phones and the
  sideways scroll on tablets.
- **Reopen.** "Reopen period" asks for confirmation (`data-confirm`).
- **Bulk results.** Skip reasons are worded in the UI language
  (`src/lib/ui/skip-reason.ts`), each distinct reason once. Action errors use
  `friendlyActionErrorMessage`.
- **Wording.** The result line uses the same noun as the heading in Latvian
  ("norēķinu ieraksti") and Russian ("расчётные записи").

Measured after:

| Viewport | Sideways scroll | First case row | Page height |
| --- | --- | --- | --- |
| 1440 x 900 | none | 405 px | 1811 px (was 2082) |
| 1280 x 720 | none | 405 px | 1811 px |
| 1024 x 768 | none | 461 px | 1867 px |
| 1024 x 768, Russian | none | 505 px | 1935 px |
| 768 x 1024 | none (list layout) | 450 px | 3178 px |
| 390 x 812 | none (list layout) | 755 px | 3489 px (was 5974) |

Verification: 392 unit tests, `astro check` (0 errors), ESLint and Prettier on
the changed files. Playwright against `astro dev` with the local demo data:
`current-month`, `dashboard`, `layout-matrix`, `breadcrumbs` and
`dark-mode` pass. `current-month.spec.ts` now checks in English, Latvian and
Russian at 1440, 1024, 768, 390 and 320 px that the table does not scroll
sideways and the action is inside the viewport. The layout matrix caught 18 px
problem links stacked within 24 px of each other; they are 24 px now.

Not done or not verified:

- The status badge stays 16 px (a shared component), so it is still heavier than
  the text around it.
- On a phone the tabs wrap to four rows (about 150 px).
- The new Latvian and Russian strings have no native review.
- `ui.spec.ts` "admin routes" fails at login, before it reaches this page: it
  expects to land on the dashboard and the demo admin lands on the organization
  list. Its locked-month assertion was updated but has not run.
- Sending, generating and reopening were not submitted. The reopen confirmation
  was dismissed, not accepted.
- "Billing email ready" is no longer announced to screen readers for healthy
  cases. No screen-reader pass was made.
