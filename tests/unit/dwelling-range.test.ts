import { describe, expect, it } from "vitest";
import {
  dwellingRangeToCsv,
  parseDwellingRange,
} from "../../src/domain/organizations/dwelling-range";

describe("parseDwellingRange", () => {
  it("expands numeric ranges and keeps literals", () => {
    expect(parseDwellingRange("1-3, 14 , 20A,")).toEqual([
      "1",
      "2",
      "3",
      "14",
      "20A",
    ]);
    expect(parseDwellingRange("7 - 8")).toEqual(["7", "8"]);
  });

  it("rejects empty, descending, oversized and duplicate input", () => {
    expect(() => parseDwellingRange(" , ")).toThrow("at least one");
    expect(() => parseDwellingRange("5-3")).toThrow("smaller number");
    expect(() => parseDwellingRange("1-501")).toThrow("up to 500");
    expect(() => parseDwellingRange("1-3, 2")).toThrow('"2" appears');
  });
});

describe("dwellingRangeToCsv", () => {
  it("writes all eleven import headers", () => {
    const csv = dwellingRangeToCsv([
      { number: "1", type: "APARTMENT", areaM2: "45", residentCount: "2" },
    ]);
    const [header, row] = csv.split(/\r?\n/);
    expect(header.split(",")).toHaveLength(11);
    expect(row).toBe("1,APARTMENT,,,,,,45,2,,");
  });
});
