# 0014. Payment to a dwelling account, cash, and editing an unmatched row

Date: 2026-10-28

## Context

[ADR 0006](0006-payment-corrections-manual-entry-and-alerts.md) let an admin type
in a bank transfer, but only against an open invoice, and only as a bank
transfer. A manager still had no way to record:

- money for a dwelling that has no open invoice. This includes an advance
  payment, and the opening debt from the Migration Center
  ([ADR 0013](0013-migration-center.md)), which has no invoice at all;
- cash;
- a statement row that the reader got wrong (amount, date, payer, reference),
  before it is matched.

A payment row is tied to one invoice (`payment_matches.invoice_id` is not null),
so the first case had no place to go.

## Decision

1. **A payment can go to a dwelling account.** `recordDwellingPayment` inserts
   the usual synthetic "Manual entry" import and a `bank_transactions` row. It
   posts one `PAYMENT` credit to the dwelling with no `invoice_id`. There is no
   `payment_matches` and no `payment_allocations` row: both are invoice
   concepts. The credit is the whole effect. The next invoice carries it
   (`previousCreditApplied`), and it settles migrated opening debt first
   (ADR 0013, item 18).
2. **Not while the dwelling has an open invoice.** An invoice freezes its balance
   when it is prepared and takes payments only by allocation. A credit posted
   next to it would make the invoice demand money that is already paid. The
   function refuses and tells the admin to pay that invoice. An open invoice is
   unpaid, PREPARED, SENT or OVERDUE, with an allocation left. A DRAFT invoice is
   not open: preparing it later sees the credit.
3. **Locks.** The function takes the bank-payment duplicate lock first, then the
   dwelling row `FOR NO KEY UPDATE`, then checks for open invoices. That is the
   lock `prepareInvoice` and the balance import already take. So a preparation
   that wins sees the credit, and a payment that wins sees the prepared invoice.
   `reversePayment` (invoice payments) now takes the same dwelling lock, so it
   cannot reopen an invoice between the check and the post. The duplicate lock
   comes first on every path, so there is no three-way wait with
   `prepareInvoice`.
4. **`bank_transactions` gets two columns** (migration 0025).
   `payment_method` (`BANK` or `CASH`, default `BANK`) and `applied_dwelling_id`.
   A row with `applied_dwelling_id` is already applied: the unmatched list leaves
   it out, and matching, `confirmMatch` and editing refuse it.
5. **Cash.** The method is a typed column, because it changes how the row is
   listed and described ("Cash payment ..."). The bank reference is optional for
   cash (a receipt number, if there is one). Both the invoice payment and the
   dwelling payment take a method. Cash is never proposed by reference matching:
   it is typed in and applied at once.
6. **Retry safety.** Each rendered form carries a `submissionId`. It is stored in
   the unique file hash of the synthetic import (`manual:<id>`), so a second
   submit of the same form fails with "already recorded", and nothing is
   half-written. The action requires the id. A bank transfer is also refused when
   the same reference, amount and date exist. Cash has no such check: two cash
   payments of the same amount on one day are normal. A bank payment that was
   reversed off a dwelling does not count as a repeat, so it can be typed in
   again for the right dwelling.
7. **Reversal of a dwelling payment.** `reverseDwellingPayment` posts one full
   `PAYMENT_REVERSAL` debit with no invoice. A fixed idempotency key
   (`bank-transaction:<id>:direct-reversal`) and the dwelling lock make it
   happen once. It is refused when a later invoice used credit (the rule of
   the invoice reversal). The payment does not return to Unmatched. The admin
   types it in again for the right dwelling.
8. **Editing an unmatched row.** An admin changes the amount, date, payer or
   reference of a row with no live match, with a reason. The currency and the
   imported raw data never change. The audit event keeps the old values. A
   reference that the statement gave cannot be erased. A bank row cannot become a
   repeat of another bank payment: the check runs only when amount, date or
   reference change (a statement can hold two identical rows). The edit
   serializes with matching on the row lock.
9. **Where.** One form (`ManualPaymentForm`) on the Payments page and on the
   dwelling page. One select: open invoices, or dwellings that have no open
   invoice. The Confirmed and Reversed tabs list dwelling payments under
   "Payments to an account", with Reverse.

## Review

Codex reviewed the design, then the code, with the source in the prompt (it could
not start commands in that session). I fixed: the lock order (a three-way wait
with `prepareInvoice`), the missing marker that let a dwelling payment also be
matched (the column), the optional submission id, the edit that could create a
bank duplicate or erase a reference, a reversed payment that could not be typed
in again, an amount the column cannot hold, and `confirmMatch` accepting an
already applied row. A test fails without the dwelling lock.

Not adopted: an `ignore` state and a `dedupe_key` column (the edit may change the
amount, with a reason and the audit values; the submission id is the retry key);
a `reversal_of` column (the idempotency key makes one reversal).

## Consequences

- A dwelling payment has no payment-match row, so the resident's payment history
  page (it starts from allocations) does not list it. The dwelling account page
  does.
- Reversing an invoice payment after a dwelling payment reopens the invoice at
  its frozen amount. The dwelling credit stays in the ledger and the next invoice
  uses it. The net balance is right.
- The reversal refusal is conservative: any later invoice that applied credit
  blocks it. Fix the balance with an adjustment.
- All of this assumes one currency per organization, as the rest of the ledger
  does. A dwelling payment uses the organization currency.
- Editing an imported row changes what the statement row says. The original
  values are in the audit history and in `raw_data`.
