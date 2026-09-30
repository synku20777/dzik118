import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage } from "../../src/lib/ui/i18n";

describe("localeFromAcceptLanguage", () => {
  it("picks Latvian and Russian, including regional tags", () => {
    expect(localeFromAcceptLanguage("lv")).toBe("lv");
    expect(localeFromAcceptLanguage("lv-LV,lv;q=0.9,en;q=0.8")).toBe("lv");
    expect(localeFromAcceptLanguage("ru-RU,ru;q=0.9")).toBe("ru");
  });

  it("uses quality, then order", () => {
    expect(localeFromAcceptLanguage("en;q=0.5,ru;q=0.9")).toBe("ru");
    expect(localeFromAcceptLanguage("ru,lv")).toBe("ru");
  });

  it("skips unsupported languages and zero quality", () => {
    expect(localeFromAcceptLanguage("de,fr;q=0.9,lv;q=0.1")).toBe("lv");
    expect(localeFromAcceptLanguage("lv;q=0,ru;q=0.5")).toBe("ru");
  });

  it("falls back to English", () => {
    expect(localeFromAcceptLanguage(null)).toBe("en");
    expect(localeFromAcceptLanguage("")).toBe("en");
    expect(localeFromAcceptLanguage("de,fr")).toBe("en");
    expect(localeFromAcceptLanguage("*")).toBe("en");
  });
});
