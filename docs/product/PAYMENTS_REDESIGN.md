# Payments: transparency and money-flow history

The payments flow used to answer one question — "what do I need to match?" — and answered it across five status tabs that mixed work queues with history. It could not answer the questions people actually ask about money: _Did this dwelling pay? Where did this euro go? Who reversed it, and why? Does the balance add up?_ This redesign keeps every payment action as it was and adds the views that make the money traceable.

## What people need

- **Building manager** (daily): clear the queue after an import, answer "has apartment 7 paid?", fix a wrong row, undo a mistake. Needs the queue first and short, and a history that is searchable by dwelling.
- **Owner or accountant** (monthly): reconcile the bank statement against what the system says is owed. Needs totals that reconcile, every ledger line with its source, and proof that nothing was edited after the fact.
- **Anyone challenged by a resident** ("I paid in March"): needs one place that shows the payment, which invoice it settled, whether any of it was credited to the account, and who did what to it. They will open it mid-conversation, so it has to read at a glance.
- **Resident** (portal): sees date, amount and invoice. Not changed in this pass; see below.

## Changes

- **Payments page, reordered around the job.** A four-figure strip sits above a **Needs your review** queue that collapses into a calm one-line state when empty. Below it one **Payment history** lists every payment — confirmed, reversed, and rejected suggestions — newest first, with dwelling, payer and real method (bank or cash), amount, what it was applied to, status, and a **Details** link. Search covers dwelling, invoice, reference, payer, and amount; a status filter and date range narrow it, and a line says how many payments and how much money the filter covers (count only when currencies are mixed). The old `?view=` links from the dashboard still land on the right filter.
  - **Received this month**: payments booked this month, each counted once at what the ledger says it is still worth. Correcting an old payment (reverse, then match to the right invoice) never moves money between months. It is a statement of what stands, not of reversal activity; a reversal made this month of an earlier month's payment shows in that earlier month.
  - **To review**: suggested matches plus unmatched rows.
  - **Not on any account yet**: unmatched rows and rows with only a suggested match. A suggestion posts nothing until confirmed.
  - **Still to collect**: the sum of every dwelling's positive ledger balance. It is not the sum of open invoices, which would count carried-over debt twice. An overpaid dwelling never offsets another dwelling's debt.
- **Payment details** (new, `/payments/:id`). One payment, in order: received (which statement file, linked, and who imported it) or typed in (who, and the reason they gave), suggested or matched, applied (how much to which invoice), corrected (old → new for amount, date, payer, reference, with the reason), reversed (who, why). Beside it, **where the money went**: what is applied to invoices and what was credited to the dwelling account, each invoice linked. The page names the dwelling the money is on now, even if the payment was first matched to another dwelling's invoice; the ledger lines table then shows which dwelling each line hit. A payment reversed and re-matched shows the cancelled allocation struck through and counts the live one; the ledger decides whether a payment still counts. A fully reversed payment still lists what it did, struck through. Historical amounts come from what the ledger posted, not from the bank row's own amount, so correcting a row after a reversal never rewrites what was reversed.
- **Account ledger** (new, `/payments/ledger`). Every charge, payment, reversal, fee and adjustment across the building, filterable by dwelling, kind, and dates, with debits, credits and the change in what is owed over every matching entry (not just the page shown). Choosing a dwelling turns it into that dwelling's **statement**: a running balance after each line, computed over the whole history so a filter never changes a balance, and an "outstanding balance" that is always the current one. A note says that back-dated entries change the lines after them and that a negative balance is credit. Each line links to its invoice or payment and names who recorded it; where the system never recorded who, it says "—".
- **Dwelling page** links to its full statement; the account panel still shows the latest ten lines.
- **Open amounts** on an invoice count everything already allocated to it, across every payment and net of reversals: a suggestion shows what stays open once confirmed, and a confirmed partial payment shows what is still open now (not the invoice total minus that one payment).
- **Fixed on the way:** a payment confirmed from the review queue now records the confirming admin on its ledger line (reversals and typed-in payments already did). Older lines stay unattributed and show "—".
- Shared `metric-strip` styles (global) back the three new views. The dwelling summary and Current Month finances keep their own copies of the same construction.

## Verification

- Prettier, ESLint, `tsc` clean; Astro diagnostics retain the six existing `Env.BROWSER` errors outside this change. 360 unit tests pass (16 new: event order, same-timestamp ties, split semantics, corrections, re-matches).
- New integration test against a real database: an overpayment's trail and split, the confirming admin on the ledger line, tenant isolation (another building's id returns not found and no ledger rows), reversal, a payment moved to another dwelling, running balances, filter and limit behaviour, what is owed before/after payment and reversal, the month's totals (unchanged by correcting a reversed row), and the open amount after two partial payments. The five payment integration suites pass (57 tests).
- `tests/e2e/payments-flow.spec.ts` (read-only): queue and history structure, search and legacy links, ordering, applied plus credit never exceeding what arrived, and cross-page agreement: the ledger's closing balance equals the dwelling page's balance and a date filter never changes a row's balance. Layout holds at 1440/1024/768/390/320px in EN/LV/RU, light and dark. The dwelling, Current Month, and payments specs pass together.
- Tests found real bugs the browser did not: events written in one transaction share a timestamp (so "applied" could sort before "typed in"), and a re-match after a reversal was hidden from the timeline.

## Not changed

- No billing, matching, allocation, or reversal rule changed; the one domain edit adds the actor to a ledger line.
- The resident portal's payment page is unchanged.
- No export. A CSV of the ledger is the obvious next step for month-end reconciliation, but it is a new feature, not a view.
- A suggested match that was **rejected** leaves its bank row out of the unmatched queue and it cannot be matched by hand (existing behaviour of `listUnmatchedTransactions` and `matchTransactionToInvoice`). That money then appears nowhere, so "Not on any account yet" undercounts it. Needs its own fix in the matching domain.
- The details page is read-only. Reversing still happens from the history row.
- Ledger results are capped at the latest 200 entries and say so; paging is not built. The ledger query loads the building's history on every request (`ponytail:` note in `trail.ts`).
- A building has one currency. Views show that currency only and never add currencies together.
- Payer names are free text from the resident's bank. The review queue names a likely dwelling only when the name equals one on the dwelling.
- Running balances of lines posted in one transaction (charge, fee, adjustment) order by a stable but arbitrary key.
- The older `ui.spec.ts` dwelling tests still cannot log in here (the seeded admin lands on `/admin/organizations`), as before this change.

## Council review

Round 1: Opus 7/10, Sol 7/10, Gemini Flash 9.3/10. Accepted: wrong dwelling on a moved payment, cash shown as bank transfer, month totals that moved with corrections, balance and net-movement wording on the ledger, correction detail (old → new), swallowed errors, double-counted payments, double-counted carried debt in "still to collect", suggested matches missing from "not on any account", stable ordering, missing translations. Rounds: 3 (the third was a narrow re-check of two money-figure fixes). All three reviewers are satisfied with no blockers.

| Delegate | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| Claude Opus | 7/10 | 9/10 | — |
| GPT Sol | 7/10 | 8/10 | 9.5/10 |
| Gemini Flash | 9.3/10 | 9.8/10 | — |

Round 2 accepted: historical amounts derive from what the ledger posted (correcting a reversed row no longer rewrites them), the open amount on an invoice counts every allocation, "No change" at zero, and the same stable ordering on the dwelling page. Recorded, not fixed: the rejected-match gap above (existing matching behaviour).
