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

## Second pass (2026-11-11)

The owner reviewed the page against a live render and a read-only Codex audit
of its interaction code, and chose every change below.

Found before the change (Latvian, dwelling 3 of the demo building):

- Six edit forms opened as floating popovers that covered other controls:
  "Add meter" covered the meter filter, archive and edit buttons; the basic
  information editor covered the payment and adjustment buttons. Several could
  be open at once and none closed on Escape or an outside click.
- Basic and additional information shared one action result, so a failed
  notes save opened both editors and showed the error only in the top one. A
  failed adjustment, payment or meter edit came back with blank or stored
  values. Adding a meter or a resident reloaded the page and dropped other
  unsaved edits.
- The balance adjustment had no confirmation; the payment and disable prompts
  named neither the amount nor the person; Retry after a failed removal or
  archive re-submitted without asking. An archived meter kept its edit form.
- "Iedzīvotāju skaits" (headcount for billing) and the "Iedzīvotāji" tab
  (portal users) used one word for two things. Ledger descriptions were stored
  English ("Reversal of bank payment …").
- Overview showed every section, so the tabs only filtered: 3178px at 1440 and
  6242px at 390.

Changes:

- **Tabs.** Six tabs, each showing only its own panel: Overview (basic
  information, invoice delivery, portal access), Account balance, Meters,
  Recurring tariffs, Messages, History. The tabs are links (`?tab=`), so a
  reload keeps the tab and they work without the script; with it they switch in
  place (`replaceState`). `role="tab"`/`tabpanel` with `aria-controls`, a
  roving tab stop, Arrow/Home/End and Space.
- **One information panel.** "Additional information" is merged into "Basic
  information" (type and notes join the editor and the view). Building,
  apartment number and status are dropped from it: the title, subtitle and
  badge already show them.
- **Edit in place.** Every Edit or Add control is a link to
  `?tab=…&edit=<key>`; the server renders that editor open, so it works
  without the script and a failed plain submit comes back with its editor open
  and the error inside it. With the script, the editor opens where it is,
  pushing content down; one at a time, and switching away from unsaved changes
  asks first ("Atmest nesaglabātās izmaiņas?"). Opening moves focus to the
  first field; Cancel, Escape or a save puts the saved values back (forms keep
  the last saved values as their defaults) and returns focus to the control
  that opened it. The meter editor opens under its own row.
- **Errors and input.** Every form saves through `mutate-form` (payment,
  adjustment, meter edit and resident enable/disable were plain POSTs), so the
  typed values stay after an error. The error sits directly above the form; an
  input error also sets `aria-invalid` and `aria-describedby` on its fields and
  focuses the first. Adding, removing, archiving or a money change refreshes
  only that section, the summary strip and the meter count
  (`refreshSections`), so the tab and other editors are untouched. A row that is
  still saving or whose outcome is unknown is shown marked and not counted.
- **Confirmations.** The adjustment confirm names the type and amount
  ("Maksas korekcija: 12,50 €. Pievienot? …"); the payment confirm names the
  amount and the target (in `ManualPaymentForm`, so the Payments page gets it
  too); disabling names the person; archiving a meter names it and says what
  happens. A retry from the status chip re-runs the confirmation
  (`mutate-form` keeps the submitter).
- **Wording.** The residents panel is "Portāla piekļuve" / "Доступ к порталу" /
  "Portal access"; the summary keeps "Iedzīvotāju skaits". Ledger descriptions
  are worded in the UI language by `src/lib/ui/ledger-description.ts`. Save
  errors use a map built on the server from the messages the domain modules
  behind these forms can throw (`src/lib/ui/error-translations.ts`, `?raw`
  imports), passed to `mutate-form` as `translateError`. The browser title is
  translated. Panel subtitles that only described the UI are removed.
- **Smaller.** An archived meter loses its edit form at once. The invoice
  delivery Save is enabled in the markup (the script disables it while nothing
  changed). The archive dialog has `aria-labelledby`/`aria-describedby`. Lists
  (residents, meters, tariffs) are rows divided by a rule with text actions of
  24px (44px on a coarse pointer); the tab counts are plain numbers. On a phone
  a ledger entry is the date and description, then the three amounts with their
  labels.

Measured after (Latvian, dwelling 3), page height per tab:

| Tab | 1440 x 900 | 390 x 812 |
| --- | --- | --- |
| Overview | 984px (was 3178 with every section) | 2042px (was 6242) |
| Account balance | 1010px | 1681px |
| Meters | 900px | 1082px |
| Recurring tariffs | 970px | 1216px |
| Messages | 900px | 918px |
| History | 1118px | 1636px |

Verification: 402 unit tests (new: `ledger-description`, `error-translations`,
`mutate-form-retry`), `astro check` and `tsc --noEmit` with 0 errors, ESLint
and Prettier. Playwright against `astro dev` with the demo data:
`dwelling-detail`, `layout-matrix`, `payments-flow` and `dashboard` pass. The
dwelling spec now checks one panel per tab and `?tab=` after a reload, focus
into and out of an editor, one editor at a time, that no open editor covers
another visible control, and that a server-rejected value stays in its field
marked invalid. A separate browser script also checked the discard prompt, the
adjustment and payment confirmation texts (dismissed), Latvian ledger text, and
that without JavaScript the delivery Save is enabled and Edit opens the editor.

How: a read-only Codex worker audited the interaction code first. A Claude
worker started the build and stopped at its weekly usage limit after the retry
fix in `mutate-form.ts`; the rest was built in the coordinating session. A
second read-only Codex worker reviewed the diff.

### Review round

The Codex review found 1 High, 5 Medium and 2 Low issues; each was checked
against the code and fixed:

- **High: an adjustment could be posted twice.** Every adjustment gets a fresh
  ledger key, so a Retry after a lost response would add it again. The
  adjustment now offers no Retry (`retryable: false` in `mutate-form`) and, when
  the outcome is unknown, says to reload and check the entries first.
- A section refresh destroyed an unsaved editor inside that section and left
  the editor state pointing at removed nodes. The refresh now carries the
  draft into the fresh copy, which opens in its place.
- Cancelling during a save made the reset values the new saved state. The form
  now takes its saved state from what the server returned.
- `?edit=toString` (an inherited object key) hid every panel; the keys are in a
  Map.
- Without JavaScript the inactive tabs had `tabindex="-1"`; the script now sets
  the roving tab stop.
- Zod's "Invalid email address" is translated (LV, RU) and in the page's error
  map; inputs carry the server's `maxlength`, so length errors cannot occur.
- Saving a new billing email now updates the invoice delivery caption.
- Tests: the ledger check uses a dwelling with entries; new checks for
  `?edit=toString`, keyboard reach without JavaScript and the no-retry flag.

The browser check of the success paths also found a bug outside this page:
`src/lib/ui/forms.ts` read `form.method`, which the payment form's `method`
field shadows, so its double-submit guard threw on every payment form (here and
on the Payments page). It now reads the attribute.

Success paths verified in a browser with every write answered in the browser
(the audit log count was the same before and after): a draft survives a section
refresh and the editor still opens afterwards; a meter save closes the editor,
refreshes the section and returns focus to its Edit link; a payment save
refreshes the balance; an adjustment with no response keeps the input, says to
check first and offers no Retry.

**Data incident.** An earlier version of that check matched action URLs
without the trailing slash Astro adds (`/_actions/<name>/`), so its requests
reached the server. On 2026-11-11 between 22:34 and 22:39 UTC it toggled Resident
3 (resident3@example.com) disabled and enabled, set the label of meter CW-003
to "Intercepted", recorded a 1.00 EUR bank payment (reference TEST) on
INV-202609-00003 and a 1.00 EUR charge adjustment on dwelling 3. On 2026-11-12
it was repaired through the app, with the owner's approval: Resident 3 enabled,
the label cleared, the payment reversed and a 1.00 EUR credit adjustment added.
Dwelling 3's balance is 71.07 EUR again. The ledger and audit log keep both the
mistaken entries and their corrections.

Not verified: no screen reader, Safari or real phone. The new Latvian and
Russian strings have no native review. Other Zod messages (wrong type, too
small) can still reach the screen in English on other pages.
