# Tariffs and rules redesign

The settings page now uses a compact tariff table, instant search/type/status
filters and one closed help disclosure. Each row opens its tariff drawer;
archive and restore remain independent row actions. Phones show compact blocks
instead of labelled table cards. The Fraunces title stays without the arch.

## Decisions implemented

- All rules, including archived rules, are rendered. Filtering hides rows in
  place and updates the URL without navigation. The GET form and Apply button
  provide filtering without JavaScript. Legacy `includeArchived=1` means All.
- The drawer groups Name, Calculation, Applies to, Validity and On the invoice.
  Scope choices are plain radio rows. Prices and VAT use localized decimals;
  selected-dwelling counts use the shared Latvian/Russian plural rules.
- New codes follow the name until manually edited: Latvian accents are
  transliterated, Cyrillic letters are dropped, other characters become separators, and codes are limited
  to 50 characters. Existing codes appear as text and are omitted from saves.
  The domain also rejects a different submitted code, preserving old clients
  that omit it or repeat the original value.
- Price, VAT, calculation type and unit changes are edits to the existing rule.
  A warning names overlapping OPEN billing months, excluding opening-reading
  months. Prepared and sent invoices retain their saved amounts.
- Saves, archive and restore use the action client and refresh only table rows
  and the result line. Current filters remain, focus returns to the saved row
  when visible (otherwise Search), and a polite status region announces success.
  Input errors are linked to their controls and focus the error banner.
- Archived tariffs open read-only. Restore is organization-scoped, locks the
  row in a transaction, leaves the tariff disabled, records before/after audit
  data and recalculates readiness for the organization's open periods.
- Drawer and Clear links prevent navigation during capture so Astro's router
  cannot race their local handlers.

## Verification

- Prettier and ESLint: all seven owned files checked, no errors. Markdown is
  checked by Prettier; ESLint has no Markdown parser.
- Astro: 378 files, zero errors, warnings or hints. TypeScript: exit 0.
  The CLI also prints the existing `wrangler.jsonc` warning about the unknown
  `observability.issue_detection` setting.
- Unit tests: 59 files and 410 tests pass, including six database-free domain
  tests for restore, missing/not-archived rules, tenant scoping and code locking.
- Read-only layout matrix: 4/4 tests pass.
- Guarded Chromium checks: 30 combinations of EN/LV/RU, 320/390/768/1024/1440px
  and light/dark, with no page or table horizontal overflow. Drawers also fit
  each language and width; filter options fit before their chevrons.
- Russian table scrollWidth/clientWidth: 976/976px at 1024px and 1114/1114px
  at 1440px in both themes. All five menu triggers remain inside the viewport;
  their right edges are 992px and 1388.8125px respectively.
- Typing `udens` with pauses keeps all five letters and Search focus. The drawer
  has no eyebrow or scope tags. Code suggestion/manual override, discard
  confirmation, localized price, the one overlapping open-month warning and
  the no-script empty result/Apply fallback were checked without submitting.
- Archived read-only controls were checked using a DOM-only archived payload;
  all form controls were disabled, Save hidden and Restore visible.
- `graphify update .` refreshed the AST graph.

## Not verified

No database mutations were performed. Actual create/save/archive/restore,
server-returned field errors, post-mutation refresh/focus/announcements and
database transaction rollback/readiness effects still need the coordinator's
write-enabled checks. `tests/e2e/tariff-dwelling.spec.ts` selectors were updated
but that spec and `tests/e2e/ui.spec.ts` were not run; no integration tests were
run. Native screen readers, Safari/iOS, forced-colors rendering and real touch
hardware were not checked. The guarded visual checks use desktop Chromium;
the separate core-view layout matrix includes coarse-pointer checks.

## Follow-up

- Search now folds case and diacritics in both the client and no-script
  filters, across name, code, English name and Russian name. Guarded Chromium
  checks passed all 24 EN/LV/RU combinations of `udens`, `ŪDENS`, `ūdens` and
  `вода`, with and without JavaScript; each query showed the two water tariffs.
- The client no longer imports `i18n.ts`. Server payloads supply translated
  CLDR plural forms, period labels, editor decimal strings and a scoped error
  map extracted from the billing domain/actions, including explicit decimal
  validation messages. The error JSON escapes `<`; the save handler tolerates
  a missing response payload by falling back to the submitted rule id.
- The built rules chunk fell from **374,856 to 11,983 bytes** (96.8% smaller,
  below 40 KB). No client chunk contains `Kārtējā perioda maksa`.
- Gates passed: Prettier and ESLint on the owned source files (Markdown checked
  by Prettier), Astro **0 errors / 0 warnings / 0 hints**, TypeScript exit 0,
  **59 unit files / 410 tests**, production build, and **4/4 layout-matrix tests**.
  An additional assert-based check passed **48 plural cases** and **30 localized
  editor-value checks**, with zero browser errors. The layout matrix ran from
  a temporary copy with GET-only routes installed immediately after login and
  on authenticated pages; its assertions and the original spec were unchanged.
  The existing Wrangler `observability.issue_detection` configuration warning
  remains. `graphify update .` refreshed the AST graph.

No create/save/archive/restore submissions, database-writing tests, seeds or
resets were run. Mutation behavior and real assistive/touch hardware remain
unverified as described above.

## Coordinator verification

- `tests/integration/billing-rule-restore.test.ts` (real Postgres, its own
  organizations): a restored tariff comes back disabled, keeps its code, is
  left out of billing and writes one `BILLING_RULE_RESTORED` audit row;
  restoring a live tariff is a conflict and another organization's tariff is
  not found; changing the code is refused, while repeating it or omitting it
  saves. 3/3 pass; demo audit rows and tariffs were identical before and after.
- A guarded Chromium walkthrough (every non-GET answered in the browser or
  aborted, except one update the input schema rejects) passed 24/24: search,
  row-opens-editor, read-only code, open-month price warning, Latvian field
  error with kept input, save without navigation with focus and announcement,
  archive confirm naming the tariff, code suggestion and manual override.
- `tests/e2e/tariff-dwelling.spec.ts` was not run: it creates and deletes
  tariffs in the demo organization.

## Second pass

- **1 — Header:** New tariff now precedes Help in the page header; the
  description is removed and the filter box contains only Search, Type,
  Status and the no-JavaScript Apply fallback. Phone actions stay below the
  title and above the filters.
- **2 — On/off:** Live row menus offer Turn off/Turn on followed by Archive;
  archived rows offer only Restore. The dedicated form action changes only
  `enabled`, avoiding nullable fields being cleared by a partial drawer save.
  Its organization-scoped domain function locks the row, refuses archived
  tariffs, skips unchanged values and delegates changes to `updateRule` within
  the same transaction for the existing audit/readiness behavior. A plain
  status line above the table offers one Undo, expires after ten seconds and
  clears when another operation starts. Enabled is the first editor control,
  with an explanatory hint; archived controls remain disabled.
- **3 — Defaults:** Create starts with VAT 21, locale-appropriate price
  examples and a Create tariff submit label. The drawer title remains New
  tariff and the duplicate Name heading is removed.
- **4 — Units:** `unitLabel` normalizes known aliases for this page's display,
  preserves unknown trimmed values and leaves the editor's stored value raw.
  Localized datalist suggestions retain canonical option values. Invoices are
  out of scope and continue printing units as stored.
- **5 — Layout:** Date ranges stay on one line; the Valid column receives
  more space while Applies to can wrap. Both dwelling pickers use numeric
  locale sorting. On phones Archive/Restore and Close share the upper footer
  row, with Save spanning the bottom row; desktop footer layout is unchanged.
- **6 — Shared save status:** Idle is hidden at every width, including initial
  load/hydration. The last pending success shows the full saved pill for four
  seconds, then fades for 150ms, with no fade under reduced motion. Pending,
  errors, an open panel, hover and keyboard focus retain visibility. A separate
  always-rendered visually hidden live region announces the summary.
- **7 — Tests/docs:** Added database-free unit alias tests and mocked-domain
  tests for archived conflicts, tenant scoping, no-op audit suppression and
  shared update/audit/readiness behavior. The two write-capable E2E specs were
  updated for the header create button, create label, first Enabled control
  and the chip's initial/temporary visibility, but were not run. The shared
  design system now documents the chip lifecycle.

Second-pass gates (read-only):

1. Default Prettier and ESLint pass on owned source/test files. The repository
   ignores docs by default; a forced Markdown check passes this document but
   flags pre-existing table formatting in `DESIGN_SYSTEM.md`, left untouched
   to preserve its unrelated working-tree edits.
2. Astro: zero errors, warnings or hints.
3. TypeScript: `tsc --noEmit` exits 0.
4. Unit suite: **61 files / 424 tests pass**, including **14 new tests**.
5. Production build passes; the rules client chunk is **13,155 bytes**, below
   40 KB, and no client JavaScript contains `Kārtējā perioda maksa`.
6. Layout matrix: **4/4 pass** from a temporary copy with GET-only routes
   installed immediately after authentication and on subsequent pages; its
   assertions were unchanged and the temporary copy was removed.
7. Guarded Chromium: **9 EN/LV/RU × 1440/1024/390px cases pass**, checking
   header actions, live menus, single-line date ranges, no horizontal overflow,
   numeric dwelling ordering in both pickers, raw edit units, VAT 21, localized
   create labels/placeholders, suggestions and equal-width phone footer
   controls. The existing archived row has only Restore and opens with all
   editor controls disabled and Save hidden; there is no disabled live row
   in the demo data to inspect without a write. Table scrollWidth/clientWidth is **976/976px at 1024** and
   **1114/1114px at 1440**, including Russian. In-memory mutation-store checks
   pass for initial idle, pending, four-second success, 150ms fade, hover,
   keyboard focus, open panel, errors, reduced motion and the always-rendered
   announcer; these checks send no requests. Browser page errors: zero.
8. `graphify update .` refreshes the AST graph.

No create/save/toggle/Undo/archive/restore submissions, integration tests, seeds
or resets were run. Real database effects, mutation responses and screen-reader
speech remain for write-enabled/manual verification; Chromium assertions check
the live-region DOM rather than native assistive technology. The existing
Wrangler `observability.issue_detection` configuration warning remains.

### Second pass: coordinator verification

- Wide-screen column balance: from 88rem the name and calculation columns take
  the validity column's slack (22/26/24/9%). Below 88rem the table is under
  ~1080px and Russian "Активен" would break in the status column, so the
  narrower widths stay. Measured at 1024, 1280, 1407, 1408, 1440 and 1920 in
  EN/LV/RU: the date range and status never wrap; from 1408 nothing wraps.
- The unit placeholder shows the first four suggestions so it is not cut off.
- `tests/integration/billing-rule-restore.test.ts` now also covers on/off: one
  audit row per change, none for a no-op, other fields untouched, archived
  tariffs refused. 4/4 pass; demo data identical before and after.
- Guarded Chromium (on/off answered in the browser, everything else aborted):
  20/20 second-pass checks (header, idle chip hidden, menu items, Turn off →
  status line with Undo, Undo sends the inverse and shows a plain line, focus
  returns to the tariff, line clears after 10 s, VAT 21, 0,00 placeholder,
  "Izveidot tarifu", enabled first, six unit suggestions, numeric dwelling
  order) and 24/24 first-pass checks.
- Owner-approved data repair: the leftover test tariff "Zero price repro test"
  and test dwelling "00-E2E-1790005821669" were archived through the app (two
  audit rows). The dwelling's existing case in the open month stays on the
  month page as "Trūkst datu": archiving only keeps a dwelling out of future
  periods.

## Third pass: consistency with the other list pages

Owner decisions (2026-11-12): match Dwellings/Periods everywhere they differ,
plus five micro-interactions.

- Header: the one-line description ("The tariffs invoices are calculated
  from.") and the building illustration are back, as on Dwellings and
  Periods. The help button is the Settings page's (? icon, "Need help?"),
  secondary first and "New tariff" last, as Dwellings orders its actions.
- Status: the shared `StatusBadge` (✓ Active, Archived with the archive icon)
  and a new shared `DISABLED` entry (neutral, `player-pause` icon added to
  `icons.ts`). The editor title shows the same badge as the row.
- Table: Dwellings' cell padding (12/16px header, 16px cells, the global
  10px side padding on tablets, here kept to 90rem), centred cells, a
  link-coloured name with hover underline, a labelled "Actions" column and
  Dwellings' bordered ••• menu. Off and archived rows use muted text.
- Filters: the shared `filter-bar` at content width, a "Name or code"
  placeholder, Status = All statuses / Active / Disabled, and a separate
  "Show archived" checkbox (`includeArchived=1`). Old `?status=ARCHIVED` and
  `?status=all` links turn the checkbox on. Escape in the search clears it.
- The table answers to its own width (`container: rules-table`): cards below
  50rem, one-line date ranges from 60rem (1024px and up; at ~1120px the
  sidebar leaves 813px and the date may wrap). Containment also stops a wide
  table pushing the page sideways; measured 0px page overflow at 390, 640,
  768, 1024, 1120, 1280, 1407, 1440, 1441 and 1920 in EN/LV/RU with archived
  rows shown.
- Editor: a live "With VAT: 1,452 € / m³" line under price and VAT (hidden
  for invalid numbers and for "Amount set per period"); Save is disabled
  until the form differs from how it opened, and again if the change is
  undone; an unchanged editor closes without asking.
- After save, on/off, archive or restore the changed row takes the hover tint
  and fades over 1.5 s. Under reduced motion (global.css cuts animations to
  0.01ms) a plain tint holds for 1.5 s and goes.
- "How tariffs work" uses the same width as the other pages' disclosures.

Verification: prettier, eslint, Astro 0 errors, tsc, 424 unit tests, build
(rules chunk 14.9 KB), layout matrix 4/4; guarded Chromium 33/33 for this pass
plus 24/24 and 20/20 for the earlier passes; demo data identical before and
after. `tests/e2e/tariff-dwelling.spec.ts` was not run (writes to the demo
organisation).

### Third pass fix: rounded table corners

The wrapper is `overflow: visible` (the row menu of the last rows must not be
clipped), so `.table-wrap`'s usual clipping no longer rounded the corners and
the header and last row showed square corners. The corner cells now carry
`--radius-panel` themselves: the header's two outer cells and the outer cells
of the last *visible* row (`tr:not([hidden]):not(:has(~ tr:not([hidden])))`,
because filtering hides rows). The row hover tint moved from the `<tr>` to its
cells so the radius clips it. In card layout (below 50rem) the first and last
visible row carry the radius instead. Measured in light and dark, at 1440 and
390, with archived rows shown and with the list filtered to one row.
