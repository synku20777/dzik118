# 0003 - Dwelling account ledger and payment allocation model

**Status:** Accepted  
**Phase:** B (Database) / F (Billing) / J (Payments)  

## Context

The original architecture in v1 was invoice-centric:
- An invoice total was assumed to be the sole unit of indebtedness.
- Reconciliation assumed 1:1 exact-match settlement (`payment.amount == invoice.total`).
- Billing cycles generated invoices without carrying forward prior unpaid balances or unused credits.
- Late fees and manual financial corrections were treated as v1 non-goals.

In practice, residential property billing inherently requires:
1. **Partial payments**: A resident may pay a portion of an invoice; the invoice remains open for the remaining unpaid balance.
2. **Overpayments and credits**: A resident may pay more than the outstanding amount or have pre-existing credit from prior adjustments; the excess must be credited to their account and carried forward to reduce subsequent bills.
3. **Debt carry-forward**: Unpaid balances from prior periods must be represented as previous outstanding amounts on subsequent invoices.
4. **Late-fee accrual and waiver**: Daily penalty calculations on overdue amounts must be applied to statements, with explicit auditable waivers or adjustments.
5. **Auditability and immutability**: Once issued and sent, historical invoices and financial ledger entries must not be edited in place.

## Decision

We introduced a **dwelling-scoped financial account** with an append-only ledger and explicit payment allocations:

1. **Dwelling-Level Append-Only Ledger (`account_entries`)**:
   - Each dwelling has a financial account journal scoped to `organization_id`, `dwelling_id`, and `currency`.
   - Single-sided entry invariant: either `debit > 0 and credit = 0` (charge/receivable), or `credit > 0 and debit = 0` (payment/credit).
   - Supported entry types: `OPENING_BALANCE`, `INVOICE_CHARGE`, `PAYMENT`, `LATE_FEE`, `LATE_FEE_ADJUSTMENT`, `MANUAL_ADJUSTMENT`, `CREDIT_CARRY_FORWARD`, `DEBT_CARRY_FORWARD`.
   - Mutability protection: Database triggers (`prevent_financial_history_mutation`) reject any `UPDATE` or `DELETE` on `account_entries`. Corrections must be posted as compensating entries with distinct idempotency keys.

2. **Explicit Payment Allocations (`payment_allocations`)**:
   - Distinct from both raw bank transactions and dwelling ledger entries.
   - When a bank transaction is matched to an invoice, the full transaction amount is credited to the dwelling account ledger (`type: PAYMENT`), and an allocation record is created for the portion applied to the invoice (`allocated_amount = min(transaction.amount, remaining_invoice_balance)`).
   - Allocations are append-only (protected by trigger) and unique on `(bank_transaction_id, invoice_id)`.

3. **Reconciliation Against Remaining Invoice Balance**:
   - Payment matching operates against an invoice's **remaining unpaid balance** (`amount_due - sum(allocated_amount)`), not its original face value.
   - Matches are classified into three result types:
     - `EXACT`: Transaction amount equals remaining unpaid balance.
     - `PARTIAL`: Transaction amount is less than remaining unpaid balance.
     - `OVERPAYMENT`: Transaction amount exceeds remaining unpaid balance.
   - An invoice transitions to `paid_at IS NOT NULL` and its billing case becomes `PAID` **only when fully settled** (`allocated_amount == remaining_invoice_balance`). For partial payments, the invoice remains open (`SENT` or `OVERDUE`) with an updated outstanding balance.
   - Excess funds in overpayments remain on the dwelling account as an available credit balance.

4. **Invoice Financial Snapshots**:
   - Invoices are legal instruments that must remain immutable once issued.
   - Rather than computing statement balances dynamically on every read, invoices snapshot their financial composition when prepared:
     - `current_charges`: Sum of line items for the current period.
     - `previous_outstanding`: Unpaid debt carried from the dwelling ledger (`max(account_balance, 0)`).
     - `previous_credit_applied`: Pre-existing dwelling credit consumed by this invoice (`min(available_credit, current_charges + previous_outstanding + late_fee + manual_adjustment)`).
     - `late_fee_calculated`, `late_fee_adjustment`, and `late_fee_applied`: Policy-calculated penalties and adjustments.
     - `manual_adjustment`: Admin adjustment specific to this invoice.
     - `amount_due`: Net payable amount (`greatest(current_charges + previous_outstanding - previous_credit_applied + late_fee_applied + manual_adjustment, 0)`).
     - `remaining_credit`: Credit remaining on the dwelling account after applying credit to this invoice.
     - `balance_snapshot` and `penalty_snapshot`: Complete structured JSON snapshots of the inputs.
   - Upon transition to `PREPARED`, the invoice posts its `current_charges` as an `INVOICE_CHARGE` debit, any `late_fee_applied` as a `LATE_FEE` debit, and any `manual_adjustment` entry to the dwelling ledger. Prior debt and credit already reside on the ledger.

5. **Late-Fee Policies and Adjustments (`late_fee_policies`, `late_fee_adjustments`)**:
   - Organization-wide policy with `effective_from`, `daily_rate`, `grace_days`, `start_rule` (`DAY_AFTER_DUE_DATE`), and `max_penalty_percent`.
   - Penalties are calculated on the oldest overdue invoice principal and capped.
   - Admin waivers or adjustments are recorded in an append-only `late_fee_adjustments` table with a mandatory reason code and audit trail.

## Consequences

### Benefits

- **Auditable financial trail**: Complete history of debits, credits, and balance evolution per dwelling.
- **Accurate cash application**: Clean handling of partial payments, duplicate payments, and overpayments without data loss or balance drift.
- **Credit and debt continuity**: Residents with credit have it automatically offset against future charges; residents with debt see it carried forward into their total amount due.
- **Invoice immutability**: Historical invoices remain stable and verifiable against their original PDF rendering, regardless of future account movements.

### Trade-offs & Boundaries

- **No arbitrary allocation waterfalls**: A bank transaction is proposed against a single candidate invoice matching its reference. Manual splitting of one transaction across multiple distinct invoices is not automated.
- **No compounding interest**: The late-fee engine uses simple daily interest with grace days and a percentage cap; statutory tiered interest tables or court interest formulas are not implemented.
- **No direct payment reversals**: Unwinding a confirmed bank payment is not supported as an in-place action; corrections require posting compensating manual adjustment entries.
- **No general-ledger ERP integration**: The ledger is domain-specific to the property billing application and does not export double-entry general ledger journals to external ERP systems.
