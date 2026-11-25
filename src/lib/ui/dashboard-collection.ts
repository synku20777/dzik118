import { compareExact, maxExact, minExact, sumExact } from "../decimal2";
export { computeInvoicePaidAndOutstanding } from "../../domain/periods/invoice-balance";

export function collectionShare(paid: string, due: string): number | null {
  const received = Number(paid);
  const total = Number(due);
  return Number.isFinite(received) && Number.isFinite(total) && total > 0
    ? Math.min(1, Math.max(0, received / total))
    : null;
}

/** Never imply collection is complete merely because a percentage rounds up. */
export function formatCollectionShare(
  share: number | null,
  locale: string
): string {
  if (share === null) return "—";
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  if (share > 0 && share < 0.01) return `<${percent.format(0.01)}`;
  return percent.format(
    share === 1
      ? 1
      : Math.min(99, Math.floor(share * 100 + Number.EPSILON * 100)) / 100
  );
}

export function getReadingsProgressState(
  readingsDone: number,
  dwellingsTotal: number
):
  | { kind: "empty"; remaining: 0 }
  | { kind: "remaining"; remaining: number }
  | { kind: "complete"; remaining: 0 } {
  if (dwellingsTotal <= 0) return { kind: "empty", remaining: 0 };
  const remaining = Math.max(0, dwellingsTotal - readingsDone);
  if (remaining > 0) return { kind: "remaining", remaining };
  return { kind: "complete", remaining: 0 };
}

export interface PeriodPaymentSummaryRow {
  status: string;
  amount: string;
  allocatedAmount?: string;
  currency: string;
  invoiceId?: string;
  invoiceCurrency?: string;
  invoiceAmountDue?: string;
}

export function summarizePeriodPayments(
  rows: readonly PeriodPaymentSummaryRow[],
  orgCurrency: string
) {
  const otherCurrencyRowCount = rows.filter(
    (r) =>
      r.currency !== orgCurrency ||
      (r.invoiceCurrency !== undefined && r.invoiceCurrency !== orgCurrency)
  ).length;
  const mixedCurrency = otherCurrencyRowCount > 0;
  const orgCurrencyConfirmedRows = rows.filter(
    (r) =>
      r.status === "CONFIRMED" &&
      r.currency === orgCurrency &&
      (r.invoiceCurrency === undefined || r.invoiceCurrency === orgCurrency)
  );
  const receivedTotal = sumExact(orgCurrencyConfirmedRows.map((r) => r.amount));
  const byInvoice = new Map<string, { due: string; allocated: string[] }>();
  const unattachedAllocated: string[] = [];
  for (const r of orgCurrencyConfirmedRows) {
    const portion = maxExact(r.allocatedAmount ?? r.amount, "0.00");
    if (r.invoiceId && r.invoiceAmountDue !== undefined) {
      const entry = byInvoice.get(r.invoiceId);
      const due = maxExact(r.invoiceAmountDue, "0.00");
      if (entry) entry.allocated.push(portion);
      else byInvoice.set(r.invoiceId, { due, allocated: [portion] });
    } else {
      unattachedAllocated.push(portion);
    }
  }
  const cappedByInvoice = [...byInvoice.values()].map(({ due, allocated }) =>
    minExact(sumExact(allocated), due)
  );
  const appliedTotal = sumExact([...cappedByInvoice, ...unattachedAllocated]);
  const hasOverpaymentDifference =
    compareExact(receivedTotal, appliedTotal) > 0;
  return {
    mixedCurrency,
    orgCurrencyConfirmedCount: orgCurrencyConfirmedRows.length,
    otherCurrencyRowCount,
    receivedTotal,
    appliedTotal,
    hasOverpaymentDifference,
  };
}

export function resolvePeriodFilter<T extends { id: string }>(
  periods: readonly T[],
  rawPeriodId: string | null
):
  | { kind: "all"; period: undefined }
  | { kind: "selected"; period: T }
  | { kind: "unknown"; period: undefined } {
  const requestedId = rawPeriodId?.trim() || undefined;
  if (!requestedId) return { kind: "all", period: undefined };
  const period = periods.find((p) => p.id === requestedId);
  return period
    ? { kind: "selected", period }
    : { kind: "unknown", period: undefined };
}
