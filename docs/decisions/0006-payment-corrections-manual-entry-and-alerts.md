# 0006 - Manual payment entry, payment reversal, MFA timing, and alerts

**Status:** Accepted
**Date:** 2026-09-30
**Phase:** J (Payments) / Operations

## Context

[KNOWN_GAPS.md](../KNOWN_GAPS.md) listed four open questions. The product owner
answered them. The ledger is append-only, so a correction must be a new entry
and never an edit (see [ADR 0003](0003-dwelling-account-ledger-and-payment-allocation.md)).

## Decisions

### 1. Manual payment entry

- An admin can type in a bank transfer that is not in an imported statement.
  Cash is out of scope.
- The admin enters the invoice, the amount, the booking date, the payer name,
  the bank reference, and a reason.
- The payment applies at once. It does not go to the Proposed list first.
- The entry is saved as a bank transaction with the source "manual". It then
  uses the same allocation and ledger code as an imported payment.
- The app blocks a second entry with the same bank reference, amount, and date.
  The error message says that the payment already exists.
- The audit log records the admin and the reason.

### 2. Payment reversal

- An admin can reverse a confirmed payment. The admin must give a reason.
- The original payment stays in the history. A compensating entry cancels it.
  Nothing is deleted or edited.
- If the payment created credit on the account, the reversal also removes that
  credit. The account balance returns to its value before the payment.
- If the invoice was PAID, the case status returns to SENT or OVERDUE. The
  status follows the due date. Late fee rules apply again.
- The bank transaction returns to the Unmatched list. An admin can then match
  it to the correct invoice.
- The reversal is refused when an invoice that came later already used the
  credit. The admin then fixes the balance with an adjustment.

### 3. Admin MFA

- Admin MFA enrollment is not built now.
- This decision differs from spec Section 15.2 and [ADR 0002](0002-admin-aal2-boundary.md).
  Both require MFA before production. The flag `ADMIN_REQUIRE_AAL2` stays off.
- **Risk:** Admin accounts use a password only. Build MFA enrollment before the
  app holds real resident data.

### 4. Error alerts

- No error tracking vendor is added now.
- Cloudflare has no alert for a failed scheduled job. Its health check email
  needs the Pro plan. The owner chose to avoid a paid plan.
- The app sends an email to the address in the `ALERT_EMAIL` setting when the
  scheduled job fails.
- The owner adds a free uptime monitor, for example UptimeRobot, on
  `GET /api/health`. The monitor sends the "site is down" email.
- Other server errors stay in the Cloudflare logs.
- The setup steps are in [the monitoring guide](../deployment/monitoring.md).
## Consequences

- Two new kinds of ledger entry appear: a manual payment and a reversal. Both
  use existing tables where possible.
- Every correction has a named actor and a reason in the audit log.
- Owners learn about a full outage (monitor) and a failed scheduled job (email),
  but not about an error in a single request.
