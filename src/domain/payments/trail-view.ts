// Pure helpers that turn a PaymentTrail into what the payment page shows: a
// timeline of who did what, and where the money went. No I/O, so the rules are
// unit-tested. User-visible words live in the page, keyed by `kind`.
import { subtractExact, sumExact, compareExact } from "../../lib/decimal2";
import type { PaymentTrail } from "./trail";

export type TrailEventKind =
  | "RECEIVED"
  | "TYPED_IN"
  | "POSTED_TO_ACCOUNT"
  | "SUGGESTED"
  | "MATCHED"
  | "APPLIED"
  | "REJECTED"
  | "CORRECTED"
  | "REVERSED";

export interface TrailEvent {
  kind: TrailEventKind;
  at: Date;
  actor: string | null;
  invoiceNumber?: string;
  periodId?: string;
  invoiceId?: string;
  amount?: string;
  reason?: string;
  // What the system said about the row's source: the statement file name.
  source?: string;
  importId?: string;
  // For a corrected row: what changed, old and new.
  changes?: {
    field: "amount" | "bookingDate" | "payerName" | "reference";
    from: string;
    to: string;
  }[];
}

const STEP_ORDER: Record<TrailEventKind, number> = {
  RECEIVED: 0,
  CORRECTED: 1,
  TYPED_IN: 2,
  POSTED_TO_ACCOUNT: 2,
  SUGGESTED: 3,
  MATCHED: 3,
  APPLIED: 4,
  REJECTED: 4,
  REVERSED: 5,
};

const MANUAL_IMPORT_NAME = "Manual entry";

function actorName(name: string | null, email: string | null) {
  return name ?? email ?? null;
}

function afterField(data: unknown, key: string): string | undefined {
  if (data && typeof data === "object" && key in data) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "number")
      return String(value);
  }
  return undefined;
}

const CORRECTABLE = [
  "amount",
  "bookingDate",
  "payerName",
  "reference",
] as const;

function changedFields(before: unknown, after: unknown) {
  return CORRECTABLE.flatMap((field) => {
    const from = afterField(before, field) ?? "";
    const to = afterField(after, field) ?? "";
    return from === to ? [] : [{ field, from, to }];
  });
}

const APPLIED_ACTIONS = new Set([
  "PAYMENT_MATCH_CONFIRMED",
  "PAYMENT_PARTIALLY_ALLOCATED",
  "PAYMENT_OVERPAYMENT_ALLOCATED",
]);

export function buildTrailEvents(trail: PaymentTrail): TrailEvent[] {
  const { transaction, matches, events } = trail;
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const out: TrailEvent[] = [];

  const typedIn = events.some(
    (e) =>
      e.action === "MANUAL_PAYMENT_RECORDED" ||
      e.action === "DWELLING_PAYMENT_RECORDED"
  );
  // A typed-in payment has its own first event; a statement row arrived with
  // the import.
  if (!typedIn) {
    out.push({
      kind: "RECEIVED",
      at: transaction.importedAt,
      actor: actorName(transaction.importerName, transaction.importerEmail),
      source:
        transaction.importFilename === MANUAL_IMPORT_NAME
          ? undefined
          : transaction.importFilename,
      importId:
        transaction.importFilename === MANUAL_IMPORT_NAME
          ? undefined
          : transaction.bankImportId,
    });
  }

  for (const e of events) {
    const actor = actorName(e.actorName, e.actorEmail);
    const match =
      e.entityType === "payment_match"
        ? matchById.get(e.entityId ?? "")
        : undefined;
    const invoice = match
      ? {
          invoiceNumber: match.invoiceNumber,
          invoiceId: match.invoiceId,
          periodId: match.periodId,
        }
      : {};
    const base = { at: e.createdAt, actor, ...invoice };
    switch (e.action) {
      case "MANUAL_PAYMENT_RECORDED":
        out.push({
          ...base,
          kind: "TYPED_IN",
          invoiceNumber: undefined,
          reason: afterField(e.afterData, "reason"),
          // The invoice a typed-in payment was entered against.
          ...(matches[0]
            ? {
                invoiceNumber: matches[0].invoiceNumber,
                invoiceId: matches[0].invoiceId,
                periodId: matches[0].periodId,
              }
            : {}),
        });
        break;
      case "DWELLING_PAYMENT_RECORDED":
        out.push({
          ...base,
          kind: "POSTED_TO_ACCOUNT",
          reason: afterField(e.afterData, "reason"),
        });
        break;
      case "PAYMENT_MATCH_PROPOSED":
        // The system suggests. An admin who picks the invoice is a step of
        // their own, except for the match made by typing the payment in: that
        // is already the "typed in" step. A later re-match is still shown.
        if (
          (afterField(e.afterData, "matchType") ?? match?.matchType) !==
          "MANUAL"
        )
          out.push({ ...base, kind: "SUGGESTED" });
        else if (!(typedIn && match?.id === matches[0]?.id))
          out.push({ ...base, kind: "MATCHED" });
        break;
      case "PAYMENT_MATCH_REJECTED":
        out.push({ ...base, kind: "REJECTED" });
        break;
      case "BANK_TRANSACTION_EDITED":
        out.push({
          ...base,
          kind: "CORRECTED",
          reason: afterField(e.afterData, "reason"),
          changes: changedFields(e.beforeData, e.afterData),
        });
        break;
      case "PAYMENT_REVERSED":
      case "DWELLING_PAYMENT_REVERSED":
        out.push({
          ...base,
          kind: "REVERSED",
          reason: afterField(e.afterData, "reason"),
        });
        break;
      default:
        if (APPLIED_ACTIONS.has(e.action))
          out.push({
            ...base,
            kind: "APPLIED",
            amount: afterField(e.afterData, "allocatedAmount"),
          });
    }
  }
  // Events written in one database transaction share a timestamp (typing a
  // payment in records "typed in", "suggested" and "applied" together), so
  // ties fall back to the order the steps really happen in.
  return out.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() || STEP_ORDER[a.kind] - STEP_ORDER[b.kind]
  );
}

export interface PaymentSplit {
  total: string;
  // Allocations still in force, and the ones a reversal cancelled.
  invoices: {
    invoiceId: string;
    periodId: string;
    invoiceNumber: string;
    amount: string;
    reversed: boolean;
  }[];
  applied: string; // in force, to invoices
  // Money that is still on the dwelling account (overpayment or no invoice).
  credit: string;
  // What the credit part was before any reversal, for showing history.
  originalCredit: string;
  // The ledger nets to zero for this payment: it did nothing in the end.
  reversed: boolean;
  // The payment has reached the ledger at all.
  posted: boolean;
}

// Where the money went, as of now. The ledger is the authority on whether the
// payment still counts: credits minus debits for this transaction. A payment
// can be reversed and then matched to another invoice, so a reversal does not
// make the payment "reversed" unless the ledger nets to zero. Each allocation
// a reversal cancelled is listed, flagged, but not counted.
export function buildPaymentSplit(trail: PaymentTrail): PaymentSplit {
  const cancelled = new Set(trail.reversals.map((r) => r.invoiceId));
  const invoices = trail.allocations.map((a) => ({
    invoiceId: a.invoiceId,
    periodId: a.periodId,
    invoiceNumber: a.invoiceNumber,
    amount: a.amount,
    reversed: cancelled.has(a.invoiceId),
  }));
  const posted = trail.entries.length > 0;
  const live = posted
    ? subtractExact(
        sumExact(trail.entries.map((e) => e.credit)),
        sumExact(trail.entries.map((e) => e.debit))
      )
    : "0.00";
  const reversed = posted && compareExact(live, "0") <= 0;
  const applied = reversed
    ? "0.00"
    : sumExact(invoices.filter((i) => !i.reversed).map((i) => i.amount));
  const credit =
    reversed || compareExact(applied, live) >= 0
      ? "0.00"
      : subtractExact(live, applied);
  // Each allocation of a payment re-matched twice is the whole payment's
  // share at the time, so the credit it left is measured against the last one.
  // Measured against what the ledger posted, not the bank row's amount: that
  // can be corrected after a reversal without changing what was reversed.
  const lastPosted =
    [...trail.entries].reverse().find((e) => e.type === "PAYMENT")?.credit ??
    "0.00";
  const lastAllocation = invoices.at(-1)?.amount ?? "0.00";
  const originalCredit =
    posted && compareExact(lastAllocation, lastPosted) < 0
      ? subtractExact(lastPosted, lastAllocation)
      : "0.00";
  return {
    total: reversed ? lastPosted : trail.transaction.amount,
    invoices,
    applied,
    credit,
    originalCredit,
    reversed,
    posted,
  };
}
