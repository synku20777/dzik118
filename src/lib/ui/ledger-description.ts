import { fill, translate, type Locale } from "./i18n";

// Account entries store an English sentence written by the domain code
// (generation.ts, adjustments.ts, matching.ts, direct.ts, reversal.ts,
// balances.ts). This words the known shapes in the UI language and keeps the
// reference (an invoice or bank reference) as it is. Anything else, such as a
// tariff name the organization typed, is shown unchanged.
const PATTERNS: [RegExp, string][] = [
  [/^Current charges (.+)$/, "Current charges {ref}"],
  [/^Late fee (.+)$/, "Late fee {ref}"],
  [/^Manual adjustment (.+)$/, "Manual adjustment {ref}"],
  [/^Manual charge adjustment$/, "Manual charge adjustment"],
  [/^Manual credit adjustment$/, "Manual credit adjustment"],
  [/^Bank payment (.+)$/i, "Bank payment {ref}"],
  [/^Cash payment (.+)$/i, "Cash payment {ref}"],
  [/^Opening balance \(migrated\)$/, "Opening balance (migrated)"],
];

export function ledgerDescriptionText(
  description: string,
  locale: Locale
): string {
  const reversal = description.match(/^Reversal of (.+)$/);
  if (reversal)
    return fill(translate(locale, "Reversal: {entry}"), {
      entry: ledgerDescriptionText(reversal[1], locale),
    });
  for (const [pattern, key] of PATTERNS) {
    const match = description.match(pattern);
    if (match) return fill(translate(locale, key), { ref: match[1] ?? "" });
  }
  return description;
}
