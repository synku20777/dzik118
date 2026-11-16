// Which invoices a dwelling's payments have settled (ADR 0016). Money paid in
// goes to the account and covers the invoices oldest first, each by its own
// amount: what was posted on that invoice, not the earlier debt it carries.
// The ledger is the only input, so every payment path, reversal and
// adjustment gets the same answer.
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import { accountEntries } from "../../db/schema/accounts";
import { billingCases } from "../../db/schema/billing";
import { dwellings } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import { organizations } from "../../db/schema/organizations";
import {
  addExact,
  compareExact,
  maxExact,
  minExact,
  subtractExact,
} from "../../lib/decimal2";
import { orgLocalDateString } from "../../lib/org-time";
import { PAYABLE_CASE_STATUSES } from "./ledger";

export interface SettlementEntry {
  type: string;
  invoiceId: string | null;
  debit: string;
  credit: string;
  effectiveDate: string;
}

export interface SettlementInvoice {
  id: string;
  dueDate: string;
  issueDate: string;
  invoiceNumber: string;
}

export interface Settlement {
  // Oldest first: the order payments cover invoices in.
  order: string[];
  // What was posted on the invoice (charges, late fee, adjustments).
  own: Map<string, string>;
  // The same without its late fee: what a late fee on it is charged on.
  principal: Map<string, string>;
  // All debt due up to and including the invoice, older debt first.
  through: Map<string, string>;
  // Money paid in, as a running total by date (ascending).
  paidIn: { date: string; total: string }[];
}

const PAYMENT_TYPES = new Set(["PAYMENT", "PAYMENT_REVERSAL"]);
const LATE_FEE_TYPES = new Set(["LATE_FEE", "LATE_FEE_ADJUSTMENT"]);

export function settle(
  invoiceList: SettlementInvoice[],
  entries: SettlementEntry[]
): Settlement {
  const order = [...invoiceList]
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.issueDate.localeCompare(b.issueDate) ||
        a.invoiceNumber.localeCompare(b.invoiceNumber) ||
        a.id.localeCompare(b.id)
    )
    .map((i) => i.id);
  const own = new Map(order.map((id) => [id, "0.00"]));
  const principal = new Map(order.map((id) => [id, "0.00"]));
  // Debt that belongs to no invoice (an opening balance, a manual charge)
  // counts as due on its date. An opening balance is dated before the first
  // invoice, so payments settle it first, as ADR 0013 already did.
  const otherDebt: { date: string; amount: string }[] = [];
  const paidByDate = new Map<string, string>();
  const pay = (date: string, amount: string) =>
    paidByDate.set(date, addExact(paidByDate.get(date) ?? "0.00", amount));

  for (const entry of entries) {
    const net = subtractExact(entry.debit, entry.credit);
    const invoiceId =
      entry.invoiceId && own.has(entry.invoiceId) ? entry.invoiceId : null;
    if (PAYMENT_TYPES.has(entry.type)) {
      pay(entry.effectiveDate, subtractExact("0.00", net));
    } else if (invoiceId) {
      own.set(invoiceId, addExact(own.get(invoiceId)!, net));
      if (!LATE_FEE_TYPES.has(entry.type)) {
        principal.set(invoiceId, addExact(principal.get(invoiceId)!, net));
      }
    } else if (compareExact(net, "0.00") < 0) {
      // A credit on the account (a manual credit) pays like money paid in.
      pay(entry.effectiveDate, subtractExact("0.00", net));
    } else {
      otherDebt.push({ date: entry.effectiveDate, amount: net });
    }
  }

  otherDebt.sort((a, b) => a.date.localeCompare(b.date));
  const dueDate = new Map(invoiceList.map((i) => [i.id, i.dueDate]));
  const through = new Map<string, string>();
  let running = "0.00";
  let next = 0;
  for (const id of order) {
    while (
      next < otherDebt.length &&
      otherDebt[next].date <= dueDate.get(id)!
    ) {
      running = addExact(running, otherDebt[next++].amount);
    }
    running = addExact(running, own.get(id)!);
    through.set(id, running);
  }
  let total = "0.00";
  const paidIn = [...paidByDate.keys()].sort().map((date) => {
    total = addExact(total, paidByDate.get(date)!);
    return { date, total };
  });
  return { order, own, principal, through, paidIn };
}

// Money paid in on or before `date` (all of it without a date).
export function paidInBy(settlement: Settlement, date?: string): string {
  let total = "0.00";
  for (const point of settlement.paidIn) {
    if (date !== undefined && point.date > date) break;
    total = point.total;
  }
  return total;
}

// The part of the invoice's own amount still unpaid when `paidIn` is in.
export function unpaidOwn(
  settlement: Settlement,
  invoiceId: string,
  paidIn: string
): string {
  return minExact(
    maxExact(subtractExact(settlement.through.get(invoiceId)!, paidIn), "0.00"),
    maxExact(settlement.own.get(invoiceId)!, "0.00")
  );
}

export async function loadSettlement(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string,
  currency: string,
  // A late fee is calculated as of an issue date: later entries do not count.
  asOf?: string
) {
  const invoiceRows = await db
    .select({
      id: invoices.id,
      dueDate: invoices.dueDate,
      issueDate: invoices.issueDate,
      invoiceNumber: invoices.invoiceNumber,
      paidAt: invoices.paidAt,
      sentAt: invoices.sentAt,
      billingCaseId: invoices.billingCaseId,
      caseStatus: billingCases.status,
    })
    .from(invoices)
    .innerJoin(billingCases, eq(billingCases.id, invoices.billingCaseId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.dwellingId, dwellingId),
        eq(invoices.currency, currency)
      )
    );
  const entries = (
    await db
      .select({
        type: accountEntries.type,
        invoiceId: accountEntries.invoiceId,
        debit: accountEntries.debit,
        credit: accountEntries.credit,
        effectiveDate: accountEntries.effectiveDate,
      })
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.organizationId, organizationId),
          eq(accountEntries.dwellingId, dwellingId),
          eq(accountEntries.currency, currency)
        )
      )
  ).filter((entry) => asOf === undefined || entry.effectiveDate <= asOf);
  return { invoices: invoiceRows, settlement: settle(invoiceRows, entries) };
}

// Marks each invoice Paid when its own amount is covered, and back to unpaid
// when a reversal uncovers it. Call it in the same transaction as anything
// that posts money or a credit to the account.
export async function syncDwellingSettlement(
  tx: DbOrTx,
  organizationId: string,
  dwellingId: string,
  currency: string
) {
  // The lock prepareInvoice, the reversal and a dwelling payment also take:
  // two payments at the same moment then see each other's money.
  await tx
    .select({ id: dwellings.id })
    .from(dwellings)
    .where(eq(dwellings.id, dwellingId))
    .for("no key update");
  const [org] = await tx
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const today = orgLocalDateString(new Date(), org.timezone);
  const { invoices: rows, settlement } = await loadSettlement(
    tx,
    organizationId,
    dwellingId,
    currency
  );
  const paidIn = paidInBy(settlement);

  for (const invoice of rows) {
    const covered =
      compareExact(unpaidOwn(settlement, invoice.id, paidIn), "0.00") === 0;
    if (
      covered &&
      !invoice.paidAt &&
      PAYABLE_CASE_STATUSES.includes(invoice.caseStatus)
    ) {
      await tx
        .update(invoices)
        .set({ paidAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invoices.id, invoice.id), isNull(invoices.paidAt)));
      await tx
        .update(billingCases)
        .set({ status: "PAID", statusUpdatedAt: new Date() })
        .where(
          and(
            eq(billingCases.id, invoice.billingCaseId),
            inArray(billingCases.status, PAYABLE_CASE_STATUSES)
          )
        );
    } else if (!covered && invoice.paidAt && invoice.caseStatus === "PAID") {
      await tx
        .update(invoices)
        .set({ paidAt: null, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoice.id), isNotNull(invoices.paidAt)));
      // An invoice paid before it was ever sent goes back to Prepared, so it
      // is still sent to the resident.
      await tx
        .update(billingCases)
        .set({
          status: !invoice.sentAt
            ? "PREPARED"
            : invoice.dueDate < today
              ? "OVERDUE"
              : "SENT",
          statusUpdatedAt: new Date(),
        })
        .where(
          and(
            eq(billingCases.id, invoice.billingCaseId),
            eq(billingCases.status, "PAID")
          )
        );
    }
  }
}
