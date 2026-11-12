const units = [
  {
    aliases: [
      "month",
      "months",
      "mēnesis",
      "mēn.",
      "mēn",
      "месяц",
      "мес.",
      "мес",
    ],
    en: "month",
    lv: "mēn.",
    ru: "мес.",
  },
  {
    aliases: [
      "person",
      "persons",
      "persona",
      "personas",
      "pers.",
      "pers",
      "человек",
      "чел.",
      "чел",
    ],
    en: "person",
    lv: "pers.",
    ru: "чел.",
  },
  {
    aliases: ["dwelling", "īpašums", "помещение"],
    en: "dwelling",
    lv: "īpašums",
    ru: "помещение",
  },
  { aliases: ["m3", "m³", "kub.m"], en: "m³", lv: "m³", ru: "m³" },
  { aliases: ["m2", "m²", "kv.m"], en: "m²", lv: "m²", ru: "m²" },
  { aliases: ["kwh"], en: "kWh", lv: "kWh", ru: "kWh" },
];

export function unitLabel(unit: string, locale: "en" | "lv" | "ru"): string {
  const trimmed = unit.trim();
  return (
    units.find(({ aliases }) => aliases.includes(trimmed.toLowerCase()))?.[
      locale
    ] ?? trimmed
  );
}
