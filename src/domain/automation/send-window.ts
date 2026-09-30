// Which prepared invoices auto send picks on a given run.
//
// The job runs every day. An organization sends on or after its send day, so
// a run that failed, or hit the batch limit, is tried again the next day. Only
// invoices prepared by the END of the send day go out. An admin who prepares
// an invoice later in the month does not see it sent the same day: it waits
// for the next month's send day, as it did before the catch-up rule.
import { orgLocalDateString } from "../../lib/org-time";

// ponytail: a fixed batch keeps one run inside the Workers time limit (each
// send can render a PDF). Raise it, or send in parallel, if an organization
// has more invoices than this per day.
export const AUTO_SEND_BATCH_LIMIT = 50;

export interface AutoSendCandidate {
  id: string;
  preparedAt: Date | null;
  billingEmail: string | null;
  invoiceByEmail: boolean;
}

// A missed run is retried for this many days after the send day. Short enough
// that enabling auto send does not release invoices an admin held back weeks
// ago, long enough to cover a few days of trouble.
export const AUTO_SEND_CATCH_UP_DAYS = 7;

// The most recent occurrence of the send day on or before today, as
// YYYY-MM-DD, or null when it was more than the catch-up window ago. The day
// can fall in the previous month: with send day 28, a run on 2 September
// still belongs to the 28 August window. autoSendDay is 1 to 28, so the day
// exists in every month.
export function latestSendDay(
  todayLocal: string,
  autoSendDay: number,
  catchUpDays = AUTO_SEND_CATCH_UP_DAYS
): string | null {
  const [year, month, day] = todayLocal.split("-").map(Number);
  const candidate =
    day >= autoSendDay
      ? { year, month }
      : month === 1
        ? { year: year - 1, month: 12 }
        : { year, month: month - 1 };
  const candidateMs = Date.UTC(
    candidate.year,
    candidate.month - 1,
    autoSendDay
  );
  const daysSince = Math.round(
    (Date.UTC(year, month - 1, day) - candidateMs) / 86_400_000
  );
  if (daysSince > catchUpDays) return null;
  return `${candidate.year}-${String(candidate.month).padStart(2, "0")}-${String(autoSendDay).padStart(2, "0")}`;
}

export interface AutoSendSelection {
  batch: string[];
  // Not sent because the billing address bounced or sent a complaint.
  suppressed: number;
  // Not sent because auto send cannot email it: paper only, or no billing
  // email. An admin handles these by hand. Left in the queue they would fill
  // the batch every day and block the invoices behind them.
  unsendable: number;
  // Eligible, but over the batch limit. The next run takes them.
  waiting: number;
}

export function selectAutoSendBatch(
  candidates: readonly AutoSendCandidate[],
  options: {
    timezone: string;
    // Date (YYYY-MM-DD) of this month's send day, in the organization's
    // timezone. An invoice prepared after that date is not due yet.
    sendDayDate: string;
    suppressed: ReadonlySet<string>;
    limit?: number;
  }
): AutoSendSelection {
  const limit = options.limit ?? AUTO_SEND_BATCH_LIMIT;
  const due = candidates
    .filter(
      (row) =>
        !row.preparedAt ||
        orgLocalDateString(row.preparedAt, options.timezone) <=
          options.sendDayDate
    )
    .sort(
      (a, b) =>
        (a.preparedAt?.getTime() ?? 0) - (b.preparedAt?.getTime() ?? 0) ||
        a.id.localeCompare(b.id)
    );

  const emailable = due.filter((row) => row.invoiceByEmail && row.billingEmail);
  const eligible = emailable.filter(
    (row) => !options.suppressed.has(row.billingEmail!.trim().toLowerCase())
  );
  return {
    batch: eligible.slice(0, limit).map((row) => row.id),
    suppressed: emailable.length - eligible.length,
    unsendable: due.length - emailable.length,
    waiting: Math.max(0, eligible.length - limit),
  };
}
