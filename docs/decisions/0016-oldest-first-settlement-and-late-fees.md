# 0016. Payments cover invoices oldest first; late fees per invoice

Date: 2026-11-16

## Context

Each invoice carries the unpaid debt of the earlier invoices. Two bugs came
from that (see `docs/KNOWN_GAPS.md`, "Bugs from the council audit"):

- Only the invoice a payment was matched to became Paid. A resident who paid
  the February total (which carried January) left January unpaid. January
  then became Overdue, the portal showed it as owed, and it blocked a payment
  to the dwelling account.
- The late fee of each new invoice was charged on the whole late balance,
  earlier late fees included, from the due date of the oldest unpaid invoice.
  Each invoice counted the same days again. ADR 0003 says that late fees do
  not compound.

The owner set the rules on 2026-11-16.

## Decision

1. **Money goes to the account, then covers invoices oldest first.**
   `src/domain/accounts/settlement.ts` reads the dwelling ledger. Each invoice
   has an own amount: the entries posted on it (charges, its late fee line,
   adjustments). Debt with no invoice (an opening balance, a manual charge)
   counts as due on its date. An opening balance is dated before the first
   invoice, so it is paid first. Payments, reversals and account credits are money paid in. An
   invoice is covered when the money paid in reaches all debt up to and
   including it, oldest first by due date. The invoice a payment names does
   not change the order.
2. **A covered invoice is Paid.** `syncDwellingSettlement` sets `paidAt` and
   the case to Paid for each covered invoice. It moves an invoice that is no
   longer covered (after a reversal or a charge) back to Prepared, Sent or
   Overdue. Every path that posts money, a credit or a charge calls it in the same
   transaction: an invoice payment, a payment to the dwelling account, both
   reversals, a manual account adjustment, and the preparation of an invoice
   (a credit already on the account can cover it in full). It takes the dwelling lock
   first, so two payments at the same moment see each other.
3. **A Paid invoice shows nothing still due.** Its paid amount is its amount
   due, also when the money was matched to another invoice.
4. **A late fee is charged per late invoice, on its own amount.** Its own late
   fee line is left out, so a fee is never charged on a fee. The days count
   from the due date plus the grace days, up to the issue date of the new
   invoice or the day the invoice was paid, whichever is first. The cap is a
   percentage of that invoice's own amount.
5. **Each day is charged once.** The penalty snapshot of each prepared invoice
   lists, per late invoice, the fee accrued so far. A new invoice charges the
   accrued fee less the largest amount already recorded on another invoice.
   The fee is one line on the next invoice, as before.
6. **Money left over is a credit.** It reduces the next invoice, as before.

## Consequences

- A payment named for the newer invoice can leave that invoice unpaid, because
  it pays the older one first. This is the owner's rule.
- Within one invoice, money pays its charges before its late fee line. This is
  the order that gives the smaller fee: an unpaid fee line never carries a fee.
- An invoice that is no longer covered after its matched payments already
  reached its amount due (for example, a backdated charge due before it) cannot
  take another matched payment. The admin posts the money to the dwelling
  account, which this invoice then does not block.
- Invoices prepared before this rule have no fee record per invoice. Days up
  to the latest such invoice that charged a fee count as charged, so no day is
  charged twice (a `shortcut:` comment in `statements.ts`).
- A payment booked with a date before an issue date, but entered after that
  invoice was prepared, does not refund days already charged.
- The amount still due on an unpaid invoice is still its amount due less the
  payments matched to it. When an older invoice is paid after a newer one was
  issued, the newer one can show more than is owed until it is paid.
- Two payments for the same dwelling at the same moment can wait for each
  other's row locks. PostgreSQL then stops one of them with an error, and the
  admin tries again.
