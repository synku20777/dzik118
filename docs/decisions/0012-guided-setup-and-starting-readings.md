# 0012. Guided setup and starting readings

Date: 2026-10-05

## Context

A new manager had to find setup across separate pages: organization settings,
dwellings, the dwelling page for meters, the rules page, and the periods page.
The research in `docs/research/EASYBILLY_REVIEW_2026-10-05.md` recommends a
guided setup that uses the existing actions and tells the truth about readiness.

A second problem blocked the first invoice. A meter counts up forever, and a
month is billed as this reading minus the previous reading. In the first billing
month there was no previous reading, so the app billed the full meter value
(1240 m³ instead of 5.5 m³).

## Decision

1. **Setup route.** `/admin/o/{orgId}/setup` has six steps: organization
   details, dwellings, first billing period, charges, meters and starting
   readings, and review. Each step uses existing domain functions and actions.
   The setup never generates, prepares, or sends an invoice.
2. **Progress from saved data.** `getSetupProgress`
   (`src/domain/onboarding/progress.ts`) reads the database each time. A visit
   does not mark a step as done. The review shows three separate lines: setup
   complete, ready to generate invoices, and ready to prepare and send.
3. **Starting readings in a real past period.** The owner selected this model.
   The month before the first billing month is a period with
   `opening_readings = true`. It is always locked and has no billing cases. The
   starting readings are stored there with source `IMPORT`. The existing
   previous-reading lookup then finds them for the first billing month.
4. **One opening period.** A unique index allows one per organization. The
   domain refuses to reopen it, add a dwelling to it, or create a billing period
   at or before its month. Consumption views do not show it.
5. **Two ways to enter starting readings.** Type them in the setup, or import a
   CSV file of last month's readings (`dwelling_number, meter_type,
   serial_number, unit, reading`). The import creates missing meters.
6. **Range entry.** "1-12, 14, 20A" becomes a preview of dwellings. The rows go
   through the existing dwelling CSV import. A request key makes a second
   confirm do nothing.
7. **Charge presets.** Maintenance per m², fixed fee per dwelling, fee per
   resident, cold water and hot water per m³. Each one becomes a normal billing
   rule. A second run reports existing charges and does not create them again.
8. **Reading grid.** `/periods/{periodId}/readings` shows every meter of the
   period. One save sends the changed rows in groups of 100. Each row is saved
   on its own, so a failed row does not stop the others.
9. **Entry.** A new organization opens the setup. The dashboard shows "Finish
   setting up" until the setup is complete or an invoice was sent.

## Consequences

- A month before the first billing month can never become a billing month.
- A starting reading cannot change after the meter has a later reading.
- Opening balances (debt or credit from the old system) are not part of this
  setup. They need an audited ledger import of their own.
- Progress loads rules, meters, readings, assignments, and manual inputs once
  for the whole organization and decides per dwelling in memory. The decision
  logic is the same function invoice generation uses, so the two cannot differ.
