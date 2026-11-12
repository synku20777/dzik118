# Main dashboard redesign

Current layout (2026-11-11): a money card ("Total to pay" with the visible
breakdown, received and still unpaid) and a Readings card, then the next billing
action with proportional workflow progress, then the priority queue. The
decisions and measurements are in the 2026-11-11 addendum of
[ADR 0015](../decisions/0015-dashboard-redesign.md). The rest of this file
records the earlier pass, which had four headline scores and an expandable
invoice ledger; neither exists now.

## Design references

- [UniFi Network 9.1](https://blog.ui.com/article/releasing-unifi-network-9-1):
  visibility, control and direct paths from an overview to the underlying work.
- [Horizon dashboard guidance](https://horizon.servicenow.com/core-ui/foundations/data-visualization/dashboards):
  goal-oriented content, consistent score templates, concise headings and
  restrained semantic color.

These informed the hierarchy and density. Namkopa retains its Riga palette,
Switzer UI typography and Fraunces period heading. No template dependency or
fabricated revenue trend was added.

## Behavior and data

- Total to pay, received payments and outstanding money use the same invoice
  period basis. Current charges remain explicit in the first score and ledger.
- The collection share uses actual paid and due totals. Zero/credit totals show
  a dash; tiny collections show `<1%`; partial shares never round up to 100%.
  Money arithmetic remains in the existing exact-decimal domain implementation.
- The caveat about unsent invoices appears beside the collection figures only
  when draft or prepared cases exist.
- Received money links to confirmed payment history. That page is organization
  history, not a new invoice-period analytics filter.
- The dashboard send queue and workbench share `UNSENT = DRAFT + PREPARED`.
- Overdue actions retain dwelling search context. Locked missing-data rows open
  the workbench instead of offering a readings mutation or unrelated payment action.
- Proposed matches receive early queue priority. Partial workflow steps show
  their actual completion rather than being labelled complete or untouched.
- Source, keyboard and visual order all put attention before the collection card.
- Drawer links intercept before Astro's router, preventing duplicate navigation
  and reopening after dismissal. The existing abort-based lifecycle cleanup remains.

## Council review

Rounds: 2. Scores are qualitative review judgments.

| Delegate | Round 1 | Round 2 |
| --- | --- | --- |
| Claude Opus 5.5 | 7/10 | 9/10 |
| GPT Sol | 8.5/10 | 9.5/10 |
| Gemini 3.8 Flash | 8.8/10 | 9.8/10 |

All reviewers were satisfied in the final round, with no blockers. Accepted
findings included financial labels, document order, partial progress, queue
parity, screenshot stability and locked-period routing. The outstanding score
continues to open all workbench cases because its value includes more than
overdue invoices. The ring stays decorative because all of its information is
also readable text. Existing zero guards, numeric alignment and listener cleanup
were checked rather than duplicated. Gemini Flash was the available Gemini
model; Gemini Pro was unavailable.

## Verification

- Production build, 344 unit tests and source-scoped ESLint pass.
- Ten focused Playwright tests pass across dashboard, shared design system and
  theme behavior. The seeded dashboard matrix covers English, Latvian and
  Russian, both themes, and widths 320/390/768/1024/1440px.
- The dashboard test checks the invoice ledger, an exact nonempty send-queue
  count, allowed case statuses, drawer dismissal and cleared URL state. Captures
  include desktop light/dark and mobile dark, with dark surfaces settled first.
- `graphify update .` refreshed the graph; whitespace and formatting checks pass.
- Astro checking still reports the six pre-existing `Env.BROWSER` diagnostics
  in PDF/scheduled-job code. No new dashboard type diagnostics remain.

This is Chromium validation against local seeded data. Manual screen-reader,
Safari/iOS device and production-user usability testing were outside this task.
