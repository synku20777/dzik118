// Read-only views over the money flow (ADR 0003, 0006, 0014). Nothing here
// writes. The account ledger is the source of truth for money; the audit log
// says who did what and why; allocations say where a payment went.
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  accountEntries,
  paymentAllocations,
  paymentReversals,
} from "../../db/schema/accounts";
import { auditLogs } from "../../db/schema/audit";
import { appUsers } from "../../db/schema/auth";
import { dwellings } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import {
  bankImports,
  bankTransactions,
  paymentMatches,
} from "../../db/schema/payments";
import { subtractExact, sumExact } from "../../lib/decimal2";
import { NotFoundError } from "../errors";

export { NotFoundError };

type EntryType = (typeof accountEntries.type.enumValues)[number];

export interface LedgerFilters {
  dwellingId?: string;
  currency?: string;
  from?: string; // YYYY-MM-DD, inclusive
  to?: string; // YYYY-MM-DD, inclusive
  types?: EntryType[];
  limit?: number;
}

export const LEDGER_DEFAULT_LIMIT = 200;

// ponytail: loads the building's whole history on every request, then filters
// in memory. Fine at hundreds of dwellings; push the filters into SQL when the
// ledger outgrows that (a running balance needs the unfiltered history).
// Every ledger entry the filters allow, newest first. With a dwelling the rows
// carry that dwelling's running balance, computed over its whole history so a
// date filter never changes a balance. Without one there is no running balance
// (it would mix accounts). `truncated` says the limit cut the list.
export async function listLedgerEntries(
  db: Db,
  organizationId: string,
  filters: LedgerFilters = {}
) {
  const { dwellingId, currency, from, to, types } = filters;
  const limit = filters.limit ?? LEDGER_DEFAULT_LIMIT;
  const actor = aliasedTable(appUsers, "actor");
  const rows = await db
    .select({
      id: accountEntries.id,
      effectiveDate: accountEntries.effectiveDate,
      createdAt: accountEntries.createdAt,
      type: accountEntries.type,
      debit: accountEntries.debit,
      credit: accountEntries.credit,
      currency: accountEntries.currency,
      description: accountEntries.description,
      reason: accountEntries.reason,
      dwellingId: accountEntries.dwellingId,
      dwellingNumber: dwellings.number,
      invoiceId: accountEntries.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      periodId: invoices.periodId,
      bankTransactionId: accountEntries.bankTransactionId,
      actorName: actor.displayName,
      actorEmail: actor.emailSnapshot,
    })
    .from(accountEntries)
    .innerJoin(dwellings, eq(dwellings.id, accountEntries.dwellingId))
    .leftJoin(invoices, eq(invoices.id, accountEntries.invoiceId))
    .leftJoin(actor, eq(actor.id, accountEntries.actorUserId))
    .where(
      and(
        eq(accountEntries.organizationId, organizationId),
        dwellingId ? eq(accountEntries.dwellingId, dwellingId) : undefined,
        currency ? eq(accountEntries.currency, currency) : undefined
      )
    )
    // The id is a last, arbitrary-but-stable key: lines posted in one database
    // transaction share both timestamps, and a balance must not change between
    // two reads.
    .orderBy(
      asc(accountEntries.effectiveDate),
      asc(accountEntries.createdAt),
      asc(accountEntries.id)
    );

  const balances = new Map<string, string>();
  const withBalance = rows.map((row) => {
    // A running balance only means something inside one account and currency.
    const key = `${row.dwellingId}:${row.currency}`;
    const balance = sumExact([
      balances.get(key) ?? "0.00",
      subtractExact(row.debit, row.credit),
    ]);
    balances.set(key, balance);
    return { ...row, balance: dwellingId ? balance : null };
  });

  const matching = withBalance
    .filter(
      (row) =>
        (!from || row.effectiveDate >= from) &&
        (!to || row.effectiveDate <= to) &&
        (!types?.length || types.includes(row.type))
    )
    .reverse();
  return {
    // The balance after the newest entry of the whole history, whatever the
    // date or kind filter hides (rows are in ascending order here).
    currentBalance: dwellingId ? (withBalance.at(-1)?.balance ?? "0.00") : null,
    entries: matching.slice(0, limit),
    total: matching.length,
    truncated: matching.length > limit,
    // Over every matching entry, not just the page that is shown.
    debits: sumExact(matching.map((row) => row.debit)),
    credits: sumExact(matching.map((row) => row.credit)),
  };
}

// Money received in a period, as it stands now. A payment belongs to the month
// it was booked, whatever happened to it later: correcting a payment (reverse,
// then match to the right invoice) must not move money between months. Each
// payment counts once, at what the ledger says it is still worth.
export async function getPaymentFlowTotals(
  db: Db,
  organizationId: string,
  currency: string,
  from: string,
  to: string
) {
  // "last_credit" is what the ledger line said when it was posted: the bank
  // row's own amount can be corrected after a reversal, which must not rewrite
  // what was reversed.
  const result = await db.execute(sql`
    select
      coalesce(sum(t.net), 0)::text as received,
      coalesce(sum(case when t.net <= 0 then t.last_credit else 0 end), 0)::text
        as reversed
    from (
      select
        sum(ae.credit) - sum(ae.debit) as net,
        (array_agg(ae.credit order by ae.created_at desc)
           filter (where ae.type = 'PAYMENT'))[1] as last_credit
      from ${accountEntries} ae
      join ${bankTransactions} bt on bt.id = ae.bank_transaction_id
      where ae.organization_id = ${organizationId}
        and ae.currency = ${currency}
        and ae.type in ('PAYMENT', 'PAYMENT_REVERSAL')
        and bt.booking_date >= ${from}
        and bt.booking_date <= ${to}
      group by bt.id
    ) t
  `);
  const row = result.rows[0] as
    { received: string; reversed: string } | undefined;
  return {
    received: sumExact([row?.received ?? "0"]),
    reversed: sumExact([row?.reversed ?? "0"]),
  };
}

// What the building is owed right now, from the ledger: the sum of every
// dwelling's positive balance. Not the sum of open invoices -- an invoice
// already carries the debt of the ones before it, so adding them double-counts.
export async function getReceivables(
  db: Db,
  organizationId: string,
  currency: string
) {
  const result = await db.execute(sql`
    select
      coalesce(sum(t.balance), 0)::text as owed,
      count(*)::int as dwelling_count
    from (
      select sum(debit) - sum(credit) as balance
      from ${accountEntries}
      where organization_id = ${organizationId} and currency = ${currency}
      group by dwelling_id
      having sum(debit) - sum(credit) > 0
    ) t
  `);
  const row = result.rows[0] as
    { owed: string; dwelling_count: number } | undefined;
  return {
    owed: sumExact([row?.owed ?? "0"]),
    dwellingCount: row?.dwelling_count ?? 0,
  };
}

export type PaymentTrail = Awaited<ReturnType<typeof getPaymentTrail>>;

// Everything known about one payment: the bank row, who brought it in, each
// match and allocation, the ledger entries it made, and the audit events that
// say who did what and why. Scoped to the organization at every query.
export async function getPaymentTrail(
  db: Db,
  organizationId: string,
  transactionId: string
) {
  const importer = aliasedTable(appUsers, "importer");
  const [transaction] = await db
    .select({
      id: bankTransactions.id,
      bookingDate: bankTransactions.bookingDate,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      payerName: bankTransactions.payerName,
      reference: bankTransactions.reference,
      paymentMethod: bankTransactions.paymentMethod,
      appliedDwellingId: bankTransactions.appliedDwellingId,
      bankImportId: bankImports.id,
      importFilename: bankImports.originalFilename,
      importedAt: bankImports.importedAt,
      importerName: importer.displayName,
      importerEmail: importer.emailSnapshot,
    })
    .from(bankTransactions)
    .innerJoin(bankImports, eq(bankImports.id, bankTransactions.bankImportId))
    .leftJoin(importer, eq(importer.id, bankImports.importedByUserId))
    .where(
      and(
        eq(bankTransactions.id, transactionId),
        eq(bankTransactions.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!transaction) throw new NotFoundError("Payment not found");

  const confirmer = aliasedTable(appUsers, "confirmer");
  const matches = await db
    .select({
      id: paymentMatches.id,
      status: paymentMatches.status,
      matchType: paymentMatches.matchType,
      resultType: paymentMatches.resultType,
      proposedAllocationAmount: paymentMatches.proposedAllocationAmount,
      createdAt: paymentMatches.createdAt,
      confirmedAt: paymentMatches.confirmedAt,
      confirmerName: confirmer.displayName,
      confirmerEmail: confirmer.emailSnapshot,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      periodId: invoices.periodId,
      dwellingId: invoices.dwellingId,
      amountDue: invoices.amountDue,
    })
    .from(paymentMatches)
    .innerJoin(invoices, eq(invoices.id, paymentMatches.invoiceId))
    .leftJoin(confirmer, eq(confirmer.id, paymentMatches.confirmedByUserId))
    .where(
      and(
        eq(paymentMatches.bankTransactionId, transactionId),
        eq(paymentMatches.organizationId, organizationId)
      )
    )
    .orderBy(asc(paymentMatches.createdAt));

  const [allocations, reversals, entries] = await Promise.all([
    db
      .select({
        id: paymentAllocations.id,
        amount: paymentAllocations.allocatedAmount,
        method: paymentAllocations.method,
        at: paymentAllocations.allocationDate,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        periodId: invoices.periodId,
      })
      .from(paymentAllocations)
      .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
      .where(
        and(
          eq(paymentAllocations.bankTransactionId, transactionId),
          eq(paymentAllocations.organizationId, organizationId)
        )
      )
      .orderBy(asc(paymentAllocations.allocationDate)),
    db
      .select({
        id: paymentReversals.id,
        invoiceId: paymentReversals.invoiceId,
        allocationAmount: paymentReversals.reversedAllocationAmount,
        creditAmount: paymentReversals.reversedCreditAmount,
      })
      .from(paymentReversals)
      .where(
        and(
          eq(paymentReversals.bankTransactionId, transactionId),
          eq(paymentReversals.organizationId, organizationId)
        )
      ),
    db
      .select({
        id: accountEntries.id,
        effectiveDate: accountEntries.effectiveDate,
        createdAt: accountEntries.createdAt,
        type: accountEntries.type,
        debit: accountEntries.debit,
        credit: accountEntries.credit,
        currency: accountEntries.currency,
        description: accountEntries.description,
        reason: accountEntries.reason,
        dwellingId: accountEntries.dwellingId,
        dwellingNumber: dwellings.number,
        invoiceId: accountEntries.invoiceId,
      })
      .from(accountEntries)
      .innerJoin(dwellings, eq(dwellings.id, accountEntries.dwellingId))
      .where(
        and(
          eq(accountEntries.bankTransactionId, transactionId),
          eq(accountEntries.organizationId, organizationId)
        )
      )
      .orderBy(asc(accountEntries.createdAt)),
  ]);

  // The dwelling the money is on now: a payment can be reversed and matched
  // to an invoice of another dwelling, so the oldest match is the wrong one.
  const dwellingId =
    matches.find((m) => m.status === "CONFIRMED")?.dwellingId ??
    transaction.appliedDwellingId ??
    entries.at(-1)?.dwellingId ??
    matches.at(-1)?.dwellingId ??
    null;
  const [dwelling] = dwellingId
    ? await db
        .select({
          id: dwellings.id,
          number: dwellings.number,
          occupantName: dwellings.occupantName,
          billingName: dwellings.billingName,
        })
        .from(dwellings)
        .where(
          and(
            eq(dwellings.id, dwellingId),
            eq(dwellings.organizationId, organizationId)
          )
        )
        .limit(1)
    : [];

  const matchIds = matches.map((m) => m.id);
  const actor = aliasedTable(appUsers, "event_actor");
  const events = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      beforeData: auditLogs.beforeData,
      afterData: auditLogs.afterData,
      createdAt: auditLogs.createdAt,
      actorName: actor.displayName,
      actorEmail: actor.emailSnapshot,
    })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorUserId))
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        or(
          and(
            eq(auditLogs.entityType, "bank_transaction"),
            eq(auditLogs.entityId, transactionId)
          ),
          matchIds.length
            ? and(
                eq(auditLogs.entityType, "payment_match"),
                inArray(auditLogs.entityId, matchIds)
              )
            : undefined
        )
      )
    )
    .orderBy(asc(auditLogs.createdAt), desc(auditLogs.id));

  return {
    transaction,
    dwelling: dwelling ?? null,
    matches,
    allocations,
    reversals,
    entries,
    events,
  };
}
