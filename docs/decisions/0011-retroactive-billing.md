# 0011. Retroactive billing is an explicit action

Date: 2026-10-02

## Context

A dwelling has a billing case in a period only when the case was made for it.
`createPeriod` makes cases for the dwellings that exist at that time. A contract
that arrives today, but starts in July, had no July case. The app refused its
July readings, and there was no way to make the case. Locked periods could not
be opened again.

## Decision

1. **Add to period.** An admin adds a dwelling to a period on the period page.
   `addDwellingToPeriod` makes the billing case. The period must be open, and
   the dwelling must not be archived. The audit log records
   `BILLING_CASE_ADDED`.
2. **Reopen period.** An admin can reopen a locked period (`reopenPeriod`,
   audit action `PERIOD_REOPENED`). Cases that have no invoice get a new
   readiness calculation. Cases that have an invoice do not change.
3. **Dates.** A retroactive invoice uses the issue date and the due date of its
   period. It can be overdue at once, and the late-fee rules apply.
4. **Current period.** The current period is the newest period, when it is open.
   An older period that was reopened is never the current period. Thus the
   scheduler, the resident portal, and the dashboard ignore it.
5. **New dwellings.** A new dwelling gets a case in the current period only.
   Before, it got a case in each open period. For an earlier period, use "Add to
   period".

No date on the dwelling says when billing starts. The owner selected the manual
action.

## Consequences

- An admin must add a dwelling to each earlier month by hand.
- While an older period is open, admins can change its readings and regenerate
  its draft invoices. Lock the period again after the work.
- A retroactive invoice shows the account balance of the day it is generated.
  This balance can include invoices of later months.
