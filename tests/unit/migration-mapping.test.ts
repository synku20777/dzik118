import { describe, expect, it } from "vitest";
import {
  applySavedMapping,
  fingerprintHeaders,
  proposeMapping,
  scoreHeader,
  toSavedMapping,
  validateMapping,
} from "../../src/domain/migration/mapping";
import { columnShape } from "../../src/domain/migration/shapes";
import { DWELLING_FIELDS } from "../../src/domain/migration/targets";

const field = (key: string) => DWELLING_FIELDS.find((f) => f.key === key)!;
const mapped = (headers: string[], rows: string[][]) =>
  proposeMapping("DWELLINGS", headers, rows).map((p) => p.field);

describe("columnShape", () => {
  it("describes a column without exposing its values", () => {
    expect(columnShape(["45,5", "60", "72,25", ""])).toMatchObject({
      fillRate: 0.8,
      pattern: "decimal",
      range: "10-200",
      hasNegative: false,
    });
    expect(columnShape(["a@b.lv", "c@d.lv"]).pattern).toBe("email");
    expect(columnShape(["1", "2", "3", "2"]).pattern).toBe("integer");
    expect(columnShape(["-12,5", "30", "0"]).hasNegative).toBe(true);
    expect(columnShape(["31.10.2026", "01.11.2026"]).pattern).toBe("date");
    expect(columnShape(["", ""]).pattern).toBe("empty");
  });
});

describe("scoreHeader", () => {
  it("matches aliases across Latvian, Russian and English", () => {
    expect(scoreHeader("Dzīvokļa Nr.", field("number"))).toBe(1);
    expect(scoreHeader("№ квартиры", field("number"))).toBeGreaterThanOrEqual(
      0.8
    );
    expect(scoreHeader("Platība, m²", field("area_m2"))).toBeGreaterThanOrEqual(
      0.8
    );
    expect(scoreHeader("Площадь", field("area_m2"))).toBe(1);
    expect(scoreHeader("Īpašnieks", field("occupant_name"))).toBe(1);
    expect(scoreHeader("E-pasts", field("billing_email"))).toBe(1);
    expect(scoreHeader("Unrelated", field("area_m2"))).toBe(0);
  });
});

describe("proposeMapping", () => {
  it("maps a typical Latvian Excel sheet", () => {
    const headers = [
      "Dzīvokļa Nr.",
      "Īpašnieks",
      "E-pasts",
      "Platība, m²",
      "Iedzīvotāju skaits",
      "Piegāde",
    ];
    const rows = [
      ["1", "Jānis Bērziņš", "janis@example.lv", "45,5", "2", "e-pasts"],
      ["2", "Anna Ozola", "anna@example.lv", "60", "3", "papīrs"],
      ["3", "Pēteris Kalniņš", "peteris@example.lv", "72,25", "1", "e-pasts"],
    ];
    expect(mapped(headers, rows)).toEqual([
      "number",
      "occupant_name",
      "billing_email",
      "area_m2",
      "resident_count",
      "delivery",
    ]);
  });

  it("maps a Russian sheet", () => {
    const headers = ["Квартира", "ФИО", "Площадь", "Жильцов"];
    const rows = [
      ["1", "Иванов И. И.", "45,5", "2"],
      ["2", "Петрова А. С.", "60", "3"],
    ];
    expect(mapped(headers, rows)).toEqual([
      "number",
      "occupant_name",
      "area_m2",
      "resident_count",
    ]);
  });

  it("does not map a column whose values cannot be the field", () => {
    // Header says area, values are emails.
    const result = proposeMapping(
      "DWELLINGS",
      ["Nr", "Platība"],
      [
        ["1", "a@b.lv"],
        ["2", "c@d.lv"],
      ]
    );
    expect(result[1].field).toBeNull();
  });

  it("gives each field to one column only", () => {
    const result = proposeMapping(
      "DWELLINGS",
      ["Nr", "Dzīvokļa Nr."],
      [
        ["1", "1"],
        ["2", "2"],
      ]
    );
    // Two exact matches tie: the first column wins and the other stays free.
    expect(result.map((p) => p.field)).toEqual(["number", null]);
  });

  it("leaves unknown columns unmapped", () => {
    expect(mapped(["Nr", "Color of door"], [["1", "red"]])).toEqual([
      "number",
      null,
    ]);
  });
});

describe("saved mappings", () => {
  it("has the same fingerprint for the same headers in any order", async () => {
    const a = await fingerprintHeaders(["Nr", "Platība", "E-pasts"]);
    const b = await fingerprintHeaders(["E-pasts", "nr", "PLATĪBA"]);
    const c = await fingerprintHeaders(["Nr", "Platība"]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("keeps two columns with the same header apart", () => {
    const saved = toSavedMapping(["Name", "Name"], ["billing_name", null]);
    expect(Object.keys(saved)).toEqual(["name", "name#2"]);
    const applied = applySavedMapping(
      proposeMapping("DWELLINGS", ["Name", "Name"], [["a", "b"]]),
      saved
    );
    expect(applied.map((p) => p.field)).toEqual(["billing_name", null]);
  });

  it("applies a saved mapping by header, whatever the column order", () => {
    const saved = toSavedMapping(["Nr", "Color of door"], ["number", null]);
    const proposals = proposeMapping(
      "DWELLINGS",
      ["Color of door", "Nr"],
      [["red", "1"]]
    );
    const applied = applySavedMapping(proposals, saved);
    expect(applied.map((p) => [p.field, p.source])).toEqual([
      [null, "SAVED"],
      ["number", "SAVED"],
    ]);
  });
});

describe("validateMapping", () => {
  it("accepts a complete mapping", () => {
    expect(
      validateMapping("DWELLINGS", 3, ["number", null, "area_m2"])
    ).toEqual([]);
  });

  it("finds missing, duplicate and unknown fields and a wrong length", () => {
    expect(validateMapping("DWELLINGS", 2, [null, "area_m2"])).toEqual([
      { code: "MISSING_REQUIRED", field: "number" },
    ]);
    expect(
      validateMapping("DWELLINGS", 2, ["number", "number"])
    ).toContainEqual({
      code: "DUPLICATE",
      field: "number",
    });
    expect(
      validateMapping("DWELLINGS", 2, ["number", "balance"])
    ).toContainEqual({
      code: "UNKNOWN_FIELD",
      field: "balance",
    });
    expect(validateMapping("DWELLINGS", 3, ["number"])).toContainEqual({
      code: "WRONG_LENGTH",
    });
  });
});
