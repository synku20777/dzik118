# 0015. Dashboard redesign

Date: 2026-10-28

## Context

The research in [DASHBOARD_GUIDELINES.md](../product/DASHBOARD_GUIDELINES.md)
found four problems on `/admin/o/:orgId/dashboard`:

- The money cards did not add up. "Total invoiced" was current charges only.
  "Paid" and "Outstanding" were measured against the full amount due (charges
  plus carried debt, credits and late fees). A dwelling with arrears broke the sum.
- After setup the page had no next step. The header button said "Open workbench"
  in every state, and a locked newest month had no way to create the next one.
- Overdue rows showed no amount or due date.
- Text was 12 to 14 px, the main button was 42 px, and READY and OVERDUE shared
  amber.

The persona (a part-time administrator of about 50 who thinks in Excel) is
inferred, not tested with users. Every Latvian string below is a proposal
without a native review.

## Decision

1. **Next action first.** A band under the month heading holds one sentence and
   one primary button, chosen by `nextAction.key` in workflow order:
   `ENTER_READINGS`, `GENERATE_INVOICES`, `SEND_INVOICES`, `REVIEW_PAYMENTS`.
   A locked newest month gives `CREATE_NEXT_PERIOD` (link to
   `/periods#create-period`). A locked earlier month, or nothing left to do, gives
   `ALL_DONE` (a plain link to the workbench, not a primary button). Money
   first versus next action first is still an open question (no user evidence).
2. **Four-step progress.** Readings entered, invoices created, invoices sent,
   payments received. Each step shows "n of total" and a text state ("Done",
   "Now", "Not available yet") with an icon, not colour alone. The step that
   matches `nextAction` is "Now"; earlier steps are done; later steps are not
   available. After a close, all four are done.
3. **Money reconciles.** One block, "Money this month", with a line saying
   that unsent invoices are included.
   - **Headline: `amountDue` ("Total to pay").** It is the sum of
     `invoices.amountDue`.
   - **`totalInvoiced` = `currentCharges`.** This month's invoices only. It is
     the first line of the breakdown, not a headline.
   - **Breakdown:** this month's invoices, + previous debt, - previous
     overpayment, + late fees, and a "Manual adjustment" line only when the
     lines do not add up to `amountDue`. The total line is `amountDue`. A one-line
     definition is shown when there is no adjustment.
   - **Received in payments (`totalPaid`):** allocations against this
     month's invoices, minus reversals, never below zero per invoice. A paid
     invoice with no allocation counts at its full amount. It is not cash
     received this month.
   - **Still unpaid (`totalOutstanding`):** per invoice, `amountDue` minus the
     above, never below zero, summed. Both are measured against `amountDue`, so
     `received + still unpaid = total to pay` for each invoice that is not
     overpaid. The card is neutral unless a case is OVERDUE, then danger.
   - Only invoices in the organization's current currency are counted.
   - Zero shows as "0,00 EUR", not blank.
4. **Needs attention.** One list in severity order, capped at 5 rows, with
   "Show all (N)" (`?all=1`, one query parameter, no script). The order: failed
   deliveries, unmatched payments, overdue dwellings, then dwellings with
   missing readings, then the routine counts (suggested matches, invoices that
   can be created, ready to send, waiting for payment). A dwelling row shows the
   dwelling number, not the resident name. `needsAttention` holds MISSING_DATA
   and OVERDUE cases uncapped. The page caps it.
   - An overdue row shows the amount still owed, the due date and the days late.
     The days are whole days from the invoice due date, never negative.
   - A missing-data row opens the readings drawer for that dwelling. An overdue
     row links to `/payments`.
5. **Exceptions for payments and delivery.** `unmatchedPaymentCount` and
   `proposedPaymentCount` are organization-wide (bank transactions with no match;
   matches waiting for review). `deliveryFailureCount` is this month's unsent
   invoices whose delivery is FAILED or UNKNOWN. They are counts as summary rows,
   not lists. The admin guide already promised the first two.
6. **Readiness.** Shown only after setup is complete, as three states in
   text: setup complete, all readings entered (`billingReady`), ready to send
   (`readyToSend`). `billingReady` needs at least one case and no MISSING_DATA.
   `readyToSend` needs at least one DRAFT or PREPARED case. Setup does not claim
   more than it checks.
7. **Demoted details.** Case status counts and water consumption sit in a
   closed "Additional information" section. Consumption counts only meters in
   m3 and shows a note when readings were carried forward. The three deadlines
   (readings due, invoices issued, payment due) sit in one "Coming up" line.
8. **Errors.** A database failure shows an error panel with a link to the billing
   periods. A bad or foreign `periodId` still redirects to the periods list.
   `getCurrentOpenPeriod` can still return the starting-readings period; the page
   skips it and falls back to the newest real month.
9. **Status tones.** READY is info (was amber). OVERDUE is danger. MISSING_DATA
   stays warning. The icon and the text stay with the colour.
10. **Sizes.** Operational text is 16 px. Buttons, links, nav items and status
    rows are 44 px high (`min-height: 2.75rem`; `.btn-primary` is 44 px for the
    whole app). KPI labels are 16 px and values 24 to 32 px (fluid). Status
    badges (14 px) and eyebrows (12 px) are unchanged. They are shared tokens.
11. **Latvian wording.** Plurals use `plural()`, which looks up
    `"<English other form>|<category>"` for lv and ru. Changed labels: "Atvērt
    mēneša norēķinus", "Ievadīt rādījumus", "Nokavēts", "Var izrakstīt rēķinu",
    "Jāizdara". The counter is "Setup steps done: n of total", not a lowercased
    status word. Property wording ("dzīvoklis" or "īpašums") is not decided.

## DashboardSummary (in brief)

`getDashboardSummary` in `src/domain/periods/dashboard.ts` keeps the old fields
and adds:

- `isNewestPeriod`: newest month that is not the starting-readings month.
- `currentCharges`, `carriedOutstanding`, `creditsApplied`, `lateFees`,
  `amountDue`: the money breakdown. `totalInvoiced` equals `currentCharges`.
- `carriedForwardReadingCount`.
- `needsAttention[]`: case, dwelling, status, `missingData`, and for OVERDUE
  `overdueAmount`, `dueDate`, `daysLate`.
- `progress`: `dwellingsTotal`, `readingsDone`, `invoicesGenerated`,
  `invoicesSent`, `invoicesPaid`.
- `nextAction`: `{ key, count }`.
- `deadlines`: reading deadline, invoice issue date, invoice due date.
- `unmatchedPaymentCount`, `proposedPaymentCount`, `deliveryFailureCount`.
- `readiness`: `billingReady`, `readyToSend`.

Counts for READY, DRAFT and PREPARED come from `caseStatusCounts`.

## Consequences

- Four extra queries per page load (newest period, delivery failures, unmatched
  transactions, proposed matches). The two payment lists load full rows to count
  them (`ponytail:` note in the code). Replace them with COUNT queries when an
  organization has thousands of open bank transactions.
- The payment counts are organization-wide, not per month. Viewing an old month
  still shows today's open payments.
- Overdue rows link to the plain Payments page. The page has no dwelling filter
  yet.
- The days-late value uses the server clock when the page renders.
- The `refreshSelectors` of the readings drawer now cover the progress band,
  the money block, the list and the details, so a reading entered in the drawer
  updates the whole summary.
- READY and OVERDUE no longer share a colour. Other pages that use the shared
  status badge change with them.
- `public/guide/dashboard.jpg` still shows the old page, and the guide step about
  unmatched payments is not rewritten ([KNOWN_GAPS.md](../KNOWN_GAPS.md)).
- Not verified with users. See the open questions in
  [DASHBOARD_GUIDELINES.md](../product/DASHBOARD_GUIDELINES.md).

## Addendum 2026-10-28: compact layout

A second round put more of the page above the fold. The decisions above about
the money definitions, the next action, the attention order and the tones are
unchanged. These parts of the layout replace the earlier description:

- **One-row header.** The month title and its status badge share one row. Period
  previous and next are a joined 44 px control in the same row. The organization
  eyebrow and the facade accent are removed.
- **Status band.** One sentence, the deadlines as numeric dates, and the primary
  button. The four-step progress strip sits in the band. Below about 48 rem of
  band width it becomes 2 by 2. A pending step shows "Gaida" with a dots icon.
- **Two columns from 56 rem.** The attention list is on the left. One money panel
  is on the right: this month's charges, + previous debt, - credits, + late fees
  (+ manual adjustment when needed), = total to pay, then received and still
  unpaid. The operator sits in its own column (+, -, =). Below 56 rem the columns
  stack.
- **The three KPI cards are removed.** The money panel replaces them. The
  definitions in Decision 3 are unchanged, and the "Total to pay" headline is now
  the panel total.
- **Readiness chips** moved into the closed "Papildu informācija" section. The
  page no longer shows them by default.
- **Compact attention rows.** An overdue row has two lines: the amount, then the
  due date and the days late. A missing-reading row shows two reason labels and
  "+N" for the rest.
- **Mutation status chip.** The fixed `MutationStatus` chip is a 44 px circle
  while idle. It expands on hover, focus and activity. At 375 px it is hidden
  while idle.
- **Badges.** Status badges are 15 px (were 14 px). Decision 10 no longer holds
  for badges. Eyebrows stay at 12 px.

Why: show the work items and the money without scrolling. The measured positions
are in the "Above the fold" section of
[DASHBOARD_GUIDELINES.md](../product/DASHBOARD_GUIDELINES.md).

Consequences:

- Next action first stays the order, and the attention list starts at about
  300 px on a 1440 by 900 screen. Money first versus next action first is still untested with users.
- At 1024 by 768 the third attention row is partly below the fold. This is
  accepted. The money total is visible (about 323 px).
- The last CSS fixes are not verified in a browser (money panel icon and
  baseline, 1024 title truncation, Russian 2 by 2 progress, chip clearance at
  1024). See [KNOWN_GAPS.md](../KNOWN_GAPS.md).
- The layout was built by Claude forks. Codex did the earlier passes and had not
  reviewed this layout when its usage limit was reached.
- The Latvian strings are still without a native review.

## Addendum 2026-10-30: less dense

User feedback on a 1919 by 905 screenshot: the status band and the attention
list were too dense. The cause was many fragments of equal weight, not the
amount of content. The money definitions, the next action, the attention order
and the tones are unchanged. These parts replace the compact-layout description:

- **Status band.** The sentence is the focal point (22 px semibold) beside the
  primary button. The separate "Coming up" row is removed. Each deadline sits
  inside its progress step as "līdz 30.09." (ru "до", en "by"). A step shows its
  label and a muted "X no Y līdz dd.mm.". Only the current step shows a visible
  "Tagad" (on its own line at 375 px). Waiting and done steps rely on the icon and
  sr-only state text (", Gaida").
- **Needs attention.** Rows are grouped by kind, with one quiet heading of about
  32 px per group: icon, title and count (for example "Nokavēti maksājumi",
  "Trūkst datu", "Nākamie soļi"). There is no per-row status badge. Each group is
  a labelled list. A row is a semibold dwelling link and one muted detail line
  (amount strong, due date, days late), plus the action in a fixed
  `minmax(11rem, max-content)` nowrap column. Rows are about 65 px.
- **Cap.** At most 5 rows across all groups, with an in-list "+N vēl" cue and
  "Rādīt visus (N)". A row that duplicates the primary button is omitted. A long
  legacy reason clamps to one line.
- **Order.** Below 56 rem of band width the attention list comes before the money
  panel.

Measured live (v7, Latvian, state a):

| Viewport | Band bottom | List top | Rows 1, 2, 3 | Money total |
|---|---|---|---|---|
| 1440 x 900 | 240 px | 316 px | 349, 418, 487 px | 476 px |
| 1024 x 768 | 296 px | not recorded | 405, 470, 535 px | 875 px (below the list) |
| 375 x 812 | 503 px | not recorded | first row 640 px | not recorded |

At 1919 x 905 in dark mode the whole page fits in about 955 px. For comparison,
v5 had the band at 238 px, rows at 307, 372, 437 px and the money total at
472 px. The first declutter pass (v6) pushed these to 266 px (band), 387, 462,
537 px (rows) and 502 px (money); a Codex refinement won most of it back.

Tradeoff: calmer costs about one attention row of fold space against v5. This
was accepted.

How: a Claude fork did the declutter. Codex (frontend-design skill) did two
refinement passes after the v6 and v7 live reviews, then a final small pass:
nowrap action column at 1280, the 375 "Tagad/Сейчас" overlap, a shorter period
navigation on mobile, the "+N vēl" cue and the reason clamp. That final pass is
not browser-verified.

Still open:

- Re-measure after the final pass: the 1280 action wrap, the 375 Russian progress
  strip and the 375 period navigation height (46 px).
- Native Latvian review of the new strings ("līdz", "Tagad", group titles).
- A user test.
