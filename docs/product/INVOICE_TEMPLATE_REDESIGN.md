# Invoice template page redesign

Page: `/admin/o/[orgId]/settings/invoice-template` (`invoice-template.astro`,
`src/lib/ui/invoice-template-editor.ts`). Built by the coordinator in one pass
(2026-11-12) after a read-only audit and the owner's answers to the questions
below. Every answer was the recommended option.

## What was wrong

- Save was a plain form post that reloaded the page. A rejected save came back
  from the database and lost every unsaved edit; Save was always enabled and
  Cancel just left the page.
- The preview period select showed "2026-09" and needed a separate button that
  reloaded the page, throwing the draft away.
- Each section had a "Section title" field that the code itself says is an
  editor-only label never printed on the invoice.
- The language select sat above the preview but also switched which language
  the editor fields showed; nothing in the editor said which language was open.
  The fallback rule was buried in a three-paragraph note.
- The header stacked Help over Cancel and Save.
- The preview was not sticky, and on a phone the invoice was squeezed to the
  screen width so the charges table was cut off.
- The preview of a Latvian invoice printed "1 month" and "1 m3" (units were
  printed exactly as typed on the tariff).
- Align showed raw "left / center / right", Spacing showed "0 1 2 3 4";
  charge rows had a drag handle that did nothing; a new text block was added
  out of sight at the end of a scrolling list with focus left on the button;
  Reset used a pop-up and could not be undone.

## Decisions implemented

| Topic | Decision |
| --- | --- |
| Saving | Saved in place through the action (no reload). A rejected save keeps every edit and says so next to the button. Save is offered only while something differs from the saved version (computed, so changing a value back closes the bar). Ctrl/Cmd+S saves. "Cancel" became "Discard changes": back to the saved version, after asking. |
| Actions | Header: title, description, Help. A bar pinned to the bottom of the screen appears while there are unsaved changes ("Unsaved changes", Discard, Save), shows "Saving…", the error, or "Template saved." for three seconds. Focus moves to "Add text block" if the button it was on goes away. |
| Preview period | Switches in place through a new read-only action `invoiceTemplates.previewLines` (same functions as the page's first render). Labelled "Sample charges for" with a month name; the URL follows with `?previewPeriodId=`. A failure puts the old period back and says why. |
| Section title | Removed from the editor. Sections keep fixed names; a custom text block is named from its first words. Existing stored `title` values stay in the data and are ignored. |
| Language | `LV / EN / RU` segmented control above both columns (built like the sidebar's language switch). EN and RU show a count of fields that have Latvian text but no translation (`missingTranslationCount`, unit tested). One hint line: "An empty field uses the Latvian text." |
| Preview | Sticky beside the editor on wide screens; the section list scrolls with the page instead of inside its own box. Always drawn at true A4 width and scaled: "Fit to width" (default), 100%, 125%. Height follows the document. Phones: an Edit / Preview switch. |
| Units | Label set 4 (below). |
| Details | New text block takes focus in its text field. Align reads Left / Center / Right, Spacing reads None / Small / Medium / Large / Extra large (same 0-4 values). The charge rows' fake drag handle is gone. Reset applies at once and offers Undo for ten seconds (it also restores which sections were open); the 30-section limit is an in-page message, not an alert. |

## Label set 4

`CURRENT_LABEL_SET_VERSION` is 4. Wording is the set 2 dictionary, as in set 3.
From set 4, `renderInvoiceHtml` prints a line's unit through `unitLabel` (the
Tariffs page's rules: "1 mēn.", "1 m³", EN "month", RU "мес."; an unknown unit
is printed as typed). An invoice generated earlier keeps its stored label set,
so its rendering is unchanged. The unit is part of the invoice's frozen line
snapshot; only its display for new invoices changed.

## Safety notes

- `previewLines` uses the read guard, so it works for an archived organization.
  `tests/unit/action-guards.test.ts` lists it on purpose (that test fails for any
  new read-guard action until a person adds it).
- Nothing in this pass was saved to the demo organization: the save request was
  answered inside the browser during checks, and the organization's audit count
  and tariffs were compared before and after.

## Verification

- Prettier, ESLint, Astro check (0 errors, 0 warnings), `tsc --noEmit`, 430 unit
  tests (new: units in invoices per label set, translation counts and block
  names, label set stamp 4), production build, layout matrix 4/4.
- No UI dictionary reached the browser (the editor chunk holds no UI strings).
- Guarded Chromium, 51 checks: header, fixed section names, A4 scaled to the
  column, translated units, month-name period select, language tabs with counts
  and hint, no bar from only switching language, bar and counts while typing,
  changing a translation back closes the bar, new block focus and naming, Align
  and Spacing labels, no drag handle on charge rows, Reset with Undo and no
  pop-up, save in place with "Saving…" and a confirmation, focus not left on a
  hidden button, Ctrl+S, a rejected save keeping edits and offering retry,
  Discard asking first, period switch keeping unsaved edits and updating dates,
  sticky preview, pinned bar, phone Edit / Preview with the A4 page fitting.

## Not verified

- A save that really reaches the database, and the "template saved" audit row:
  the tests answered the request in the browser. The domain function is
  unchanged and covered by `tests/integration/billing.test.ts`.
- `tests/e2e/ui.spec.ts` (writes to the demo organization) was not run.
- Screen readers, Safari, touch hardware.
- A very long invoice (many tariffs): the iframe grows to the document height
  and the canvas scrolls; only the four-tariff demo invoice was seen.
