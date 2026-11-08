# Navigation and detail polish

Review feedback on the redesigned pages, applied as one consistent pass. The aim: one way to say "where am I", fewer boxes inside boxes, and information that can be read at a glance.

## Changes

- **One breadcrumb trail on every admin page.** `components/ui/Breadcrumbs.astro` is rendered by `AdminLayout` from a `breadcrumbs` prop, so it is in the same place everywhere and built the same way. A page passes only where it sits under the Dashboard; the layout adds the Dashboard root. The last item is the current page (not a link, truncated if long); the Dashboard's own trail is just "Dashboard"; outside an organization the trail is that one page. The per-page back links, uppercase `.breadcrumb` navs, and org-name kickers are gone. A drilled-in page now shows the full path back: Dashboard › Periods › September 2026 › Invoice INV-…, Dashboard › Payments › Payment from E2E Payer, Dashboard › Settings › Billing.
- **Dashboard: one collection overview.** "Total to pay" and "Received in payments" were two cards saying overlapping things. They are now the collection overview (ring, received, of total) in their place, and the invoice breakdown moved from its own panel into a popover on that card (info button; closes on Escape or an outside click, handled once for any `details[data-dismiss]`). "Still unpaid" and "Readings" stay as they were. The standalone "Collection overview" panel is removed.
- **Payment trail: an icon per step.** Received, typed in, posted to the dwelling account, suggested, matched, applied, corrected, reversed each have an icon, coloured by outcome, joined by a rail so order reads at a glance. Who and when moved under the title, which stops long invoice numbers wrapping in a narrow date column.
- **Chevrons for text toggles.** Bare disclosures that reveal content in place (the dwelling's meter "Edit", earlier changes, a payment's "Reverse" and "Fix this row", the audit log, Current Month's tariff and dwelling panels, the dashboard's additional information) share one style: a chevron down when closed, up when open. The existing boxed disclosure panels already did this; menus and button toggles are unchanged.
- **Current Month: tabs, not boxes.** The stage filters were a bordered rail holding bordered items inside a bordered panel. They are now flat tabs: one rule under the row and an underline on the active one, with the count as a quiet pill. At narrow widths the row scrolls inside the panel.
- **Current Month: many missing items.** A dwelling with many missing meters used to stack a red tag per meter and grow the row. Each tag is now one truncated line (the full text is in its tooltip); at most two reading-type missing items show, then "+N more", which opens the readings drawer where every one is listed. Configuration blockers (no billing rule, no meter for a rule) are not in that drawer, so they are never hidden behind the count. Other flags (billing email, paper delivery) keep their own line. In the stacked mobile card the tags share the row with the "Billing inputs" label instead of covering it.

## Verification

- Prettier, ESLint, `tsc` clean; Astro diagnostics retain the six existing `Env.BROWSER` errors. 360 unit tests pass.
- `tests/e2e/breadcrumbs.spec.ts` visits about 35 admin pages (static and drilled-in) and checks: the trail is the first thing in `main`, in the same position on every page, rooted at the Dashboard, the current page is a non-link last item, every crumb link resolves, and no old back link or breadcrumb nav remains.
- The dashboard, Current Month, dwelling, payments, and design-system specs pass, including new checks for the popover (open, Escape, outside click), flat tabs (no borders around the rail or its items), and the missing-items cap.
- A real layout bug was caught by the width matrix and fixed: the tabs' screen-reader-only text was absolutely positioned inside the scrolling row and widened the page in Latvian and Russian. The scroller is now the containing block, and long tags have a definite maximum width.

## Council review

Rounds: 2. All three reviewers are satisfied with no blockers.

| Delegate | Round 1 | Round 2 |
| --- | --- | --- |
| Claude Opus | 7/10 | 9/10 |
| GPT Sol | 7.5/10 | 9/10 |
| Gemini Flash | 9/10 | satisfied in round 1; its one valid finding was fixed |

Round 1 findings: Accepted: tag icons did not drop inline (scoped CSS cannot reach the `Icon` svg, so `:global`), popover row alignment, configuration blockers never capped, accessible name and touch size for "+N more", forced-colors chevron, trail above the archived banner, Escape handling, leftover spacing, a hard-coded English heading, a mobile tag/label collision, and cut-off LV/RU tooltips. Declined: sharing the tab CSS with the dwelling tabs and moving Current Month's own menu handler onto the shared one (both are refactors, not defects).

## Not changed

- The resident portal has its own layout and does not use these breadcrumbs.
- `admin/index.astro` only redirects and has no trail.
- Menus (`More actions`, the organization switcher) and button-style toggles keep their own look.
- Hidden missing-data items are reachable through "+N more" and the drawer, not as separate tags in the row.

## Second pass: fields, groups, cards

- **Field padding is part of the base field rule.** Inputs, selects and textareas lost their padding when a page stopped using the utility classes that supplied it (the Payments filters). The shared rule now gives text fields 0.5rem/0.75rem padding; a select with no padding utilities keeps its wider right padding for the arrow (one that sets `px-3` replaces it); colour, range and file inputs are left alone. Utilities and page rules still override it.
- **Button group** (`components/ui/ButtonGroup.astro`, in the shadcn style): neighbouring controls share one edge and only the outer corners are rounded. It takes links, buttons and a `<details>` whose summary is the button. It stacks into one joined column on a phone and has an accessible group name. The Payments header actions (Record a payment, Account ledger, Import bank statement) use it, primary action last.
- **Payment history on a phone is a card with a hierarchy:** dwelling and amount lead, then who paid and the status, then the invoice it paid and the date, then the actions behind a rule. Column labels are dropped (the content explains itself) except "Applied to". The filters become a form: search and status take the full row, the two dates share one, Apply spans.
- **Dashboard collection card, redesigned.** The ring is gone. Received is the hero figure with its share, one bar shows what has come in, and the line under it says what the total is and what is still unpaid (a link to the workbench, in the danger tone when something is overdue). "Still unpaid" is no longer its own card, since the bar already shows the split. The Readings card has the same layout (label, hero figure with its share, bar, a footer saying how many are still to enter), so the two read as a pair; there are no icon tiles on either. The share is neutral until it reaches 100%, when it turns green. When nothing is outstanding the unpaid link is hidden; with no amount due the card just says so. Amounts never wrap mid-number. The invoice breakdown stays in the popover.
- Tests: the Payments spec checks field padding, the group's joined corners, and the phone card's order; the dashboard and Current Month specs follow the new card.
