import { translate, type Locale } from "./i18n";

export const calculationTypes = [
  "FIXED",
  "AREA",
  "RESIDENT_COUNT",
  "METER_CONSUMPTION",
  "MANUAL_QUANTITY",
  "MANUAL_AMOUNT",
] as const;
export function tariffCalculationLabels(
  locale: Locale
): Record<string, string> {
  const t = (message: string) => translate(locale, message);
  return {
    FIXED: t("Fixed"),
    AREA: t("Area"),
    RESIDENT_COUNT: t("Resident count"),
    METER_CONSUMPTION: t("Meter consumption"),
    MANUAL_QUANTITY: t("Manual quantity"),
    MANUAL_AMOUNT: t("Manual amount"),
  };
}
