import { describe, expect, it } from "vitest";
import { fill, plural, workbenchSelectionCopy } from "../../src/lib/ui/i18n";

const one = "{n} day late";
const other = "{n} days late";

describe("plural", () => {
  it("picks the English form by count", () => {
    expect(plural("en", 1, one, other)).toBe("1 day late");
    expect(plural("en", 5, one, other)).toBe("5 days late");
  });

  it("uses Latvian singular only for 1, 21, 31 ... but not 11", () => {
    expect(plural("lv", 1, one, other)).toBe("Nokavēts par 1 dienu");
    expect(plural("lv", 21, one, other)).toBe("Nokavēts par 21 dienu");
    expect(plural("lv", 11, one, other)).toBe("Nokavēts par 11 dienām");
    expect(plural("lv", 0, one, other)).toBe("Nokavēts par 0 dienām");
  });

  it("uses the three Russian forms", () => {
    expect(plural("ru", 1, one, other)).toBe("Просрочено на 1 день");
    expect(plural("ru", 3, one, other)).toBe("Просрочено на 3 дня");
    expect(plural("ru", 12, one, other)).toBe("Просрочено на 12 дней");
  });

  it("fills named placeholders", () => {
    expect(fill("{done} of {total}", { done: 1, total: 5 })).toBe("1 of 5");
  });

  it("provides workbench selection forms without sending the full dictionary", () => {
    const lv = workbenchSelectionCopy("lv");
    expect(fill(lv.selected.one, { n: 21 })).toBe("Izvēlēts 21 rēķins");
    const ru = workbenchSelectionCopy("ru");
    expect(fill(ru.selected.few, { n: 3 })).toBe("Выбрано 3 счёта");
    expect(fill(ru.selected.many, { n: 12 })).toBe("Выбрано 12 счетов");
    expect(
      fill(ru.summary, {
        selection: fill(ru.selected.few, { n: 3 }),
        prepare: 2,
        send: 1,
      })
    ).toBe("Выбрано 3 счёта. К подготовке: 2. К отправке: 1.");
  });
});
