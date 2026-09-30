import { and, asc, desc, eq, lte } from "drizzle-orm";
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

export async function getDwellingAccountBalance(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string,
  currency: string
): Promise<string> {
  const rows = await db
    .select({ debit: accountEntries.debit, credit: accountEntries.credit })
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.organizationId, organizationId),
        eq(accountEntries.dwellingId, dwellingId),
        eq(accountEntries.currency, currency)
      )
    );
  return sumExact(rows.map((row) => subtractExact(row.debit, row.credit)));
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
