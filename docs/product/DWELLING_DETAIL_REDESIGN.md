# Dwelling detail

The dwelling page answers three questions in order: what does this dwelling owe, who and what belongs to it, and what has changed. It uses the same vocabulary as Current Month — a single-surface summary strip, quiet panels, tabular numbers — so the two pages read as one product. No billing rules, actions, or domain code changed.

## Changes

- Replaced four separate KPI cards with one summary strip (the same construction as the Current Month finances). The balance leads and is tone-coloured; area, resident count, and invoice delivery follow. It stacks 2×2 on phones and to one column below 360px.
- Fixed a latent bug: the optimistic area/resident edit selected the first `<p>` in the card, which was the label, so an edit could overwrite “Area”. Each stat now has exactly one `<p>`, the value.
- Tabs are underline tabs with real counts (meters, tariffs, residents). Counts update in place when a meter is archived or a resident removed. Tabs keep `role="tab"` (existing tests find them by role) and now have a single tab stop, arrow/Home/End navigation, and server-rendered `tabindex`. They are deliberately a section filter, not 1:1 tab panels: Overview shows everything and History controls two panels.
- A filter that empties a column (or the whole grid, for History) hides it, so no phantom grid gap sits above the content.
- Detail fields read label-over-value in an auto-fit grid instead of one bordered row per field. The balance panel shows only debits and credits; the balance itself is already in the strip.
- Tariff rows no longer repeat “All dwellings · automatic” on every row — the group heading says it. Assigned tariffs keep their scope as a caption.
- Meter tiles show the unit (m³, kWh) instead of emoji, in both the server markup and the optimistic row builder. The caption adds the meter type only when a custom label hides it, plus the serial number. The unit is also present as screen-reader text, since the tile is decorative.
- Audit history shows sentences (“Meter archived”) instead of codes (`METER_ARCHIVED`), the six most recent first with the rest behind “Show earlier changes (n)”. Latvian and Russian translations cover every code that can appear against a dwelling.
- Resident actions sit on their own aligned line. Only removal and archiving are red; export and disable are reversible and stay neutral.
- The sidebar column narrowed from 32rem to 26rem. At 1440px the page is about 1,300px shorter (4175 → 2840px).

## Verification

- Prettier and ESLint pass. Astro diagnostics retain the six existing `Env.BROWSER` binding errors outside this change.
- `tests/e2e/dwelling-detail.spec.ts`: one summary strip, one `<p>` per editable stat, tab counts match the lists, audit entries are never raw codes, each resident's actions share a line, tab filtering and keyboard navigation (including wrap), emptied columns and the History grid are hidden, meter captions never repeat the title and expose the unit to assistive technology, and no horizontal overflow across EN/LV/RU, light/dark, and 1440/1024/768/390/320px.
- The older `ui.spec.ts` dwelling tests could not be run: the seeded admin now lands on `/admin/organizations`, so those tests fail at login before reaching this page. That predates this change and is unfixed.
- Archiving and removal paths (the live tab-count updates) were reviewed in code but not exercised by a browser test, because that would mutate data.

## Not changed

- Big numbers use sans, per ADR 0010; the Current Month strip uses the display face. The pages still differ here.
- `auditActionLabel` is local to this page; the organization audit page still shows raw codes.
- Resident and meter action links keep their existing 13px size.

## Council review

Rounds: 3 (the third was a narrow re-check of one accessibility fix).

| Delegate | Round 1 | Round 2 |
| --- | --- | --- |
| Claude Opus | 7/10 | 8.5/10 |
| GPT Sol | 8.3/10 | 8.8/10 |
| Gemini Flash | 8.7/10 | 9.6/10 |

Round 1 accepted: live tab counts, full audit translations, meter type cue and caption de-duplication, roving tabindex and arrow keys, empty-column hiding, continued audit numbering, per-resident and `main h1` test fixes, 320px border reset, dead CSS removal. Declined: a negative margin on the tab underline (it would be clipped by the overflow container) and `aria-controls`/`tabpanel` (see above).

Round 2: History tab grid hiding (Opus), screen-reader unit text (Sol), one more audit code, ArrowLeft/End coverage.

Round 3 (Sol re-check of the screen-reader fix): 9.5/10, satisfied, no blockers. Opus (8.5) and Gemini (9.6) were already satisfied after round 2 with no blockers.
