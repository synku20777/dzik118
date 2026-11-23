import { fill, translate, type Locale } from "./i18n";
import { invoiceStatusBadge } from "./invoice-status";

// Bulk generate, prepare and send return the reason an item was skipped as the
// domain's English message. Most are fixed sentences with a dictionary key;
// these three carry a case status code and need the label put in.
const WITH_STATUS: [RegExp, string][] = [
  [/^Already ([A-Z_]+)$/, "Already {status}"],
  [
    /^Cannot generate an invoice for a case in ([A-Z_]+) status$/,
    "Cannot generate an invoice for a case in {status} status",
  ],
  [
    /^Cannot send an invoice in ([A-Z_]+) status$/,
    "Cannot send an invoice in {status} status",
  ],
];

export function skipReasonText(reason: string, locale: Locale): string {
  for (const [pattern, key] of WITH_STATUS) {
    const code = reason.match(pattern)?.[1];
    if (code)
      return fill(translate(locale, key), {
        status: translate(locale, invoiceStatusBadge(code).label),
      });
  }
  return translate(locale, reason);
}

/** The distinct reasons of a skipped list, worded for the screen. */
export function skipReasonsText(
  skipped: { reason: string }[],
  locale: Locale
): string {
  return [
    ...new Set(skipped.map((item) => skipReasonText(item.reason, locale))),
  ].join("; ");
}
