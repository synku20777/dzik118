import { describe, expect, it } from "vitest";
import { initials } from "../../src/lib/ui/initials";

describe("initials", () => {
  it("takes the first letters of up to two name parts", () => {
    expect(initials("Anna Bērziņa")).toBe("AB");
    expect(initials("ēriks")).toBe("Ē");
    expect(initials("Ann Marie Ozola")).toBe("AO");
  });
  it("uses the local part of an email address", () => {
    expect(initials("anna.berzina@example.lv")).toBe("AB");
    expect(initials("j_doe@example.lv")).toBe("JD");
    expect(initials("anna@example.lv")).toBe("A");
  });
  it("returns nothing for an empty value", () => {
    expect(initials(null)).toBe("");
    expect(initials("  ")).toBe("");
  });
});
