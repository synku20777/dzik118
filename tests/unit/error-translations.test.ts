import { describe, expect, it } from "vitest";
import { errorTranslations } from "../../src/lib/ui/error-translations";
import metersSource from "../../src/domain/organizations/meters.ts?raw";

describe("error translations for client-side saves", () => {
  it("collects thrown literals and message constants that have a translation", () => {
    const source = `
      throw new NotFoundError("Invoice not found");
      throw new ConflictError(\`Dynamic \${x}\`);
      const SOME_ERROR_MESSAGE = "Organization not found";
      throw new ValidationError("A sentence nobody translated yet");
    `;
    const lv = errorTranslations([source], "lv");
    expect(Object.keys(lv).sort()).toEqual([
      "Invoice not found",
      "Organization not found",
    ]);
    expect(lv["Invoice not found"]).not.toBe("Invoice not found");
  });

  it("returns nothing for English, which needs no map", () => {
    expect(
      errorTranslations(['throw new X("Invoice not found")'], "en")
    ).toEqual({});
  });

  it("adds listed messages that are not thrown literals, such as Zod's", () => {
    expect(errorTranslations([], "lv", ["Invalid email address"])).toEqual({
      "Invalid email address": "Nederīga e-pasta adrese",
    });
  });

  it("reads a real domain module through ?raw", () => {
    const ru = errorTranslations([metersSource], "ru");
    expect(Object.keys(ru).length).toBeGreaterThan(0);
    for (const [english, russian] of Object.entries(ru))
      expect(russian).not.toBe(english);
  });
});
