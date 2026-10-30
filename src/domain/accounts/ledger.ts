import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import {
  accountEntries,
  lateFeePolicies,
  paymentAllocations,
  paymentReversals,
} from "../../db/schema/accounts";
import { dwellings } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import { maxExact, subtractExact, sumExact } from "../../lib/decimal2";
import { NotFoundError } from "../errors";

// An opening balance posted by the Migration Center (ADR 0013). The older
// OPENING_BALANCE rows (one per unpaid v1 invoice) do not carry this key.
export const isMigratedOpening = sql`${accountEntries.type} = 'OPENING_BALANCE' and ${accountEntries.metadata} ? 'migrationImportId'`;

// With `asOf` (an invoice's issue date), a migrated opening balance dated after
// it is left out: a balance as of July 1 must not appear on a June invoice.
// Every other entry counts whatever its date, as before.
function notMigratedAfter(asOf: string | undefined) {
  return asOf
    ? sql`not (${isMigratedOpening} and ${accountEntries.effectiveDate} > ${asOf})`
    : undefined;
}

export async function getDwellingAccountBalance(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string,
  currency: string,
  asOf?: string
): Promise<string> {
  const rows = await db
    .select({ debit: accountEntries.debit, credit: accountEntries.credit })
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.organizationId, organizationId),
        eq(accountEntries.dwellingId, dwellingId),
        eq(accountEntries.currency, currency),
        notMigratedAfter(asOf)
      )
    );
  return sumExact(rows.map((row) => subtractExact(row.debit, row.credit)));
}

// The part of the balance that is migrated opening debt not yet paid. It is
// debt whose due date and penalty basis are unknown, so it is not late-fee
// principal (ADR 0013). Payments settle it first: protected = migrated debt
// minus net payments, never below zero. A migrated credit protects nothing.
// Manual credits and write-offs do not reduce it, so the result can only lower
// a late fee, never raise it.
export async function getProtectedOpeningDebt(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string,
  currency: string,
  asOf?: string
): Promise<string> {
  const rows = await db
    .select({
      type: accountEntries.type,
      debit: accountEntries.debit,
      credit: accountEntries.credit,
      migrated: sql<boolean>`${isMigratedOpening}`,
    })
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.organizationId, organizationId),
        eq(accountEntries.dwellingId, dwellingId),
        eq(accountEntries.currency, currency),
        inArray(accountEntries.type, [
          "OPENING_BALANCE",
          "PAYMENT",
          "PAYMENT_REVERSAL",
        ]),
        notMigratedAfter(asOf)
      )
    );
  const migratedDebt = maxExact(
    sumExact(
      rows
        .filter((r) => r.migrated)
        .map((r) => subtractExact(r.debit, r.credit))
    ),
    "0.00"
  );
  const netPayments = maxExact(
    sumExact(
      rows
        .filter((r) => r.type === "PAYMENT" || r.type === "PAYMENT_REVERSAL")
        .map((r) => subtractExact(r.credit, r.debit))
    ),
    "0.00"
  );
  return maxExact(subtractExact(migratedDebt, netPayments), "0.00");
}

export async function listDwellingAccountActivity(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string,
  currency: string
) {
  const rows = await db
    .select()
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.organizationId, organizationId),
        eq(accountEntries.dwellingId, dwellingId),
        eq(accountEntries.currency, currency)
      )
    )
    .orderBy(asc(accountEntries.effectiveDate), asc(accountEntries.createdAt));
  let balance = "0.00";
  return rows.map((row) => {
    balance = sumExact([balance, subtractExact(row.debit, row.credit)]);
    return { ...row, balance };
  });
}

export async function postAccountEntry(
  db: DbOrTx,
  input: typeof accountEntries.$inferInsert
) {
  const [created] = await db
    .insert(accountEntries)
    .values(input)
    .onConflictDoNothing({ target: accountEntries.idempotencyKey })
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(accountEntries)
    .where(eq(accountEntries.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (!existing) throw new NotFoundError("Account entry was not created");
  return existing;
}

export async function getInvoiceAllocatedAmount(
  db: DbOrTx,
  organizationId: string,
  invoiceId: string
): Promise<string> {
  const allocationRows = await db
    .select({ allocatedAmount: paymentAllocations.allocatedAmount })
    .from(paymentAllocations)
    .where(
      and(
        eq(paymentAllocations.organizationId, organizationId),
        eq(paymentAllocations.invoiceId, invoiceId)
      )
    );
  const reversalRows = await db
    .select({
      reversedAllocationAmount: paymentReversals.reversedAllocationAmount,
    })
    .from(paymentReversals)
    .where(
      and(
        eq(paymentReversals.organizationId, organizationId),
        eq(paymentReversals.invoiceId, invoiceId)
      )
    );
  const totalAllocated = sumExact(
    allocationRows.map((row) => row.allocatedAmount)
  );
  const totalReversed = sumExact(
    reversalRows.map((row) => row.reversedAllocationAmount)
  );
  return maxExact(subtractExact(totalAllocated, totalReversed), "0.00");
}

export async function getEffectiveLateFeePolicy(
  db: DbOrTx,
  organizationId: string,
  effectiveOn: string
) {
  const [policy] = await db
    .select()
    .from(lateFeePolicies)
    .where(
      and(
        eq(lateFeePolicies.organizationId, organizationId),
        lte(lateFeePolicies.effectiveFrom, effectiveOn)
      )
    )
    .orderBy(desc(lateFeePolicies.effectiveFrom))
    .limit(1);
  return policy ?? null;
}

export async function assertDwellingInOrganization(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string
) {
  const [dwelling] = await db
    .select({ id: dwellings.id })
    .from(dwellings)
    .where(
      and(
        eq(dwellings.id, dwellingId),
        eq(dwellings.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!dwelling) throw new NotFoundError("Dwelling not found");
}

export async function getInvoiceWithFinancialScope(
  db: DbOrTx,
  organizationId: string,
  invoiceId: string
) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!invoice) throw new NotFoundError("Invoice not found");
  return invoice;
}
