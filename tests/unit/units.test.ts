import { describe, expect, it } from "vitest";
import { unitLabel } from "../../src/lib/ui/units";

describe("unitLabel", () => {
  it.each([
    [
      ["month", "months", "mēnesis", "mēn.", "mēn", "месяц", "мес.", "мес"],
      ["month", "mēn.", "мес."],
    ],
    [
      [
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
      ["person", "pers.", "чел."],
    ],
    [
      ["dwelling", "īpašums", "помещение"],
      ["dwelling", "īpašums", "помещение"],
    ],
    [
      ["m3", "m³", "kub.m"],
      ["m³", "m³", "m³"],
    ],
    [
      ["m2", "m²", "kv.m"],
      ["m²", "m²", "m²"],
    ],
    [["kwh"], ["kWh", "kWh", "kWh"]],
  ])(
    "localizes all aliases in %j, ignoring case and surrounding whitespace",
    (aliases, labels) => {
      for (const alias of aliases) {
        for (const [index, locale] of (["en", "lv", "ru"] as const).entries()) {
          expect(unitLabel(alias, locale)).toBe(labels[index]);
          expect(unitLabel(`  ${alias.toUpperCase()} \t`, locale)).toBe(
            labels[index]
          );
        }
      }
    }
  );

  it("preserves unknown spelling and case, trimming only the edges", () => {
    for (const locale of ["en", "lv", "ru"] as const) {
      expect(unitLabel("  Custom Unit  ", locale)).toBe("Custom Unit");
      expect(unitLabel("  ", locale)).toBe("");
    }
  });
});
