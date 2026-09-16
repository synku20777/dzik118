// Phase G (Invoices/delivery) - illustrative charge rows for the invoice
// template editor's live preview (spec Section 22, 30 "tariff/template
// synchronization"). Deliberately presentation-only: this file builds a
// synthetic line per currently-effective billing rule so the editor's
// charges table always reflects live tariffs (getEffectiveRules -- the
// exact same resolver generateInvoice() uses, never a second one), without
// ever computing what any one dwelling would actually be billed. There is
// no dwelling in scope here, so there is no real quantity to derive (area,
// meter consumption, manual input) -- inventing one would mean either
// re-deriving generation.ts's calculation logic a second time (a
// duplicated financial-calculation path) or fabricating a number with no
// defined meaning. Every row instead uses a fixed placeholder quantity of
// "1", run through the exact same rounding/VAT primitives generation.ts
// itself uses (decimal2.ts), so the preview's arithmetic is honest about
// being illustrative while still demonstrating real bold/spacing/order
// presentation.
import {
  addExact,
  multiplyAndRound,
  percentOf,
  sumExact,
} from "../../lib/decimal2";
import type { InvoiceHtmlLine } from "./invoice-html";
import type { getEffectiveRules } from "./rules";

type EffectiveRule = Awaited<ReturnType<typeof getEffectiveRules>>[number];

const PREVIEW_QUANTITY = "1";

export function buildPreviewLines(rules: EffectiveRule[]): InvoiceHtmlLine[] {
  return rules.map((rule) => {
    const unitPrice = rule.unitPrice ?? "0";
    const netAmount = multiplyAndRound(PREVIEW_QUANTITY, unitPrice, 2);
    const vatAmount = percentOf(netAmount, rule.vatRate, 2);
    const grossAmount = addExact(netAmount, vatAmount);
    return {
      id: `preview-${rule.id}`,
      description: rule.name,
      quantity: PREVIEW_QUANTITY,
      unit: rule.unit,
      unitPrice: rule.unitPrice,
      netAmount,
      vatAmount,
      grossAmount,
      // rowPresentationKey (invoice-html.ts) reads sourceSnapshot.code --
      // billing_rules.code is already the stable identifier row overrides
      // are keyed by. nameEn/nameRu are included too so the editor's own
      // locale switch can actually localize a tariff's preview description
      // (localizedLineDescription reads them the same way it would from a
      // real invoice line's sourceSnapshot, which generation.ts populates
      // by snapshotting the whole rule row).
      sourceSnapshot: {
        code: rule.code,
        nameEn: rule.nameEn,
        nameRu: rule.nameRu,
      },
    };
  });
}

export interface PreviewTotals {
  subtotal: string;
  vatTotal: string;
  currentCharges: string;
}

export function buildPreviewTotals(lines: InvoiceHtmlLine[]): PreviewTotals {
  const subtotal = sumExact(lines.map((l) => l.netAmount));
  const vatTotal = sumExact(lines.map((l) => l.vatAmount));
  return { subtotal, vatTotal, currentCharges: addExact(subtotal, vatTotal) };
}

export interface PreviewPeriodCandidate {
  id: string;
  startsOn: string;
  endsOn: string;
}

// Which period's tariffs the editor's preview shows: an explicitly
// requested period (the admin's own selector) wins, then the current open
// period (the one they're actually about to bill), then the most recent
// period of any status if none is open. No second "tariff activation"
// model -- this only ever picks a date range to feed into
// getEffectiveRules, the exact resolver generateInvoice() itself uses.
export function resolvePreviewPeriod<T extends PreviewPeriodCandidate>(input: {
  periods: T[];
  requestedPeriodId: string | null;
  currentOpenPeriod: T | null;
}): T | null {
  const requested = input.requestedPeriodId
    ? input.periods.find((p) => p.id === input.requestedPeriodId)
    : undefined;
  if (requested) return requested;
  if (input.currentOpenPeriod) return input.currentOpenPeriod;
  // Picked by comparing `startsOn` directly rather than trusting
  // `periods[0]` to already be the most recent -- this function's own
  // contract shouldn't depend on a caller happening to pass a pre-sorted
  // array (listPeriods() does today, but nothing here should silently
  // break if that ever changes).
  return input.periods.reduce<T | null>(
    (latest, period) =>
      !latest || period.startsOn > latest.startsOn ? period : latest,
    null
  );
}

// An organization with no billing periods at all yet still has active
// tariffs worth previewing -- fall back to a same-day range, never
// persisted, used only as a parameter to getEffectiveRules.
export function previewPeriodDateRange(period: PreviewPeriodCandidate | null): {
  startsOn: string;
  endsOn: string;
} {
  if (period) return { startsOn: period.startsOn, endsOn: period.endsOn };
  const today = new Date().toISOString().slice(0, 10);
  return { startsOn: today, endsOn: today };
}
