import { describe, expect, it } from "vitest";
import { decodeBytes, parseTable } from "../../src/domain/migration/files";

// TextEncoder only writes UTF-8, so single-byte test files are built by hand.
const LV_1257: Record<string, number> = {
  ā: 0xe2,
  č: 0xe8,
  ē: 0xe7,
  ģ: 0xec,
  ī: 0xee,
  ķ: 0xed,
  ļ: 0xef,
  ņ: 0xf2,
  š: 0xf0,
  ū: 0xfb,
  ž: 0xfe,
  Ā: 0xc2,
  Č: 0xc8,
  Ē: 0xc7,
  Š: 0xd0,
  Ž: 0xde,
  Ģ: 0xcc,
  Ī: 0xce,
  Ķ: 0xcd,
  Ļ: 0xcf,
  Ņ: 0xd2,
  Ū: 0xdb,
};
function to1257(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => LV_1257[c] ?? c.charCodeAt(0)));
}
function to1251(text: string): Uint8Array {
  return Uint8Array.from(
    [...text].map((c) => {
      const code = c.charCodeAt(0);
      if (code >= 0x0410 && code <= 0x044f) return 0xc0 + (code - 0x0410);
      return code;
    })
  );
}

describe("decodeBytes", () => {
  it("reads UTF-8, with and without a BOM", () => {
    const utf8 = new TextEncoder().encode("Dzīvokļa Nr.;Platība");
    expect(decodeBytes(utf8)).toEqual({
      text: "Dzīvokļa Nr.;Platība",
      encoding: "utf-8",
    });
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]);
    expect(decodeBytes(bom).text).toBe("Dzīvokļa Nr.;Platība");
  });

  it("detects Latvian Windows-1257", () => {
    const bytes = to1257(
      "Dzīvokļa Nr.;Īpašnieks;Platība, m²\n1;Jānis Bērziņš;45,5"
    );
    const decoded = decodeBytes(bytes);
    expect(decoded.encoding).toBe("windows-1257");
    expect(decoded.text).toContain("Dzīvokļa Nr.");
    expect(decoded.text).toContain("Bērziņš");
  });

  it("detects Russian Windows-1251", () => {
    const bytes = to1251("Квартира;Площадь;Жильцов\n1;45,5;2\nИтого;100;5");
    const decoded = decodeBytes(bytes);
    expect(decoded.encoding).toBe("windows-1251");
    expect(decoded.text).toContain("Квартира");
  });

  it("lets the caller force an encoding and refuses oversize files", () => {
    const bytes = to1257("Īpašnieks");
    expect(decodeBytes(bytes, "windows-1257").text).toBe("Īpašnieks");
    expect(() => decodeBytes(new Uint8Array(1_000_001))).toThrow("too large");
  });
});

describe("parseTable", () => {
  it("reads a semicolon file with comma decimals", () => {
    const table = parseTable("Nr;Platība;Parāds\n1;45,5;120,00\n2;60;0\n");
    expect(table.delimiter).toBe(";");
    expect(table.headers).toEqual(["Nr", "Platība", "Parāds"]);
    expect(table.rows).toEqual([
      ["1", "45,5", "120,00"],
      ["2", "60", "0"],
    ]);
  });

  it("reads comma, tab and pasted Excel cells", () => {
    expect(parseTable("a,b\n1,2").delimiter).toBe(",");
    expect(parseTable("number\tarea\n1\t45").delimiter).toBe("\t");
  });

  it("skips title lines above the header and total rows below the data", () => {
    const text = [
      "SIA Nams, apsaimniekošanas pārskats",
      "Datums: 31.10.2026",
      "",
      "Dzīvokļa Nr.;Platība;Parāds",
      "1;45,5;10,00",
      "2;60;0",
      "Kopā;105,5;10,00",
    ].join("\n");
    const table = parseTable(text);
    expect(table.headers).toEqual(["Dzīvokļa Nr.", "Platība", "Parāds"]);
    expect(table.skippedTitleRows).toBe(2);
    expect(table.droppedTotalRows).toBe(1);
    expect(table.rows).toHaveLength(2);
  });

  it("drops a total row whose number is ambiguous on its own", () => {
    const table = parseTable("Nr;Rādījums\n1;1,5\n2;2,5\nKopā;1 369,456");
    expect(table.droppedTotalRows).toBe(1);
    expect(table.rows).toHaveLength(2);
  });

  it("keeps real dwellings that look like a total", () => {
    const table = parseTable(
      "Nr;Vārds;Platība\nTotal 1;Summa;45,5\n2;Summa;60\nSumma;;105,5"
    );
    expect(table.rows.map((r) => r[0])).toEqual(["Total 1", "2"]);
    expect(table.droppedTotalRows).toBe(1);
  });

  it("picks the header with field names, not a text title line", () => {
    const table = parseTable(
      "SIA Nams;Dzīvokļu saraksts;Oktobris\nNr;Platība;Parāds\n1;45,5;10"
    );
    expect(table.headers).toEqual(["Nr", "Platība", "Parāds"]);
    expect(table.skippedTitleRows).toBe(1);
  });

  it("finds the semicolon under a title line that has a comma", () => {
    const table = parseTable("Nams, Oktobris\nNr;Platība\n1;45,5\n2;60,25");
    expect(table.delimiter).toBe(";");
    expect(table.headers).toEqual(["Nr", "Platība"]);
    expect(table.rows[0]).toEqual(["1", "45,5"]);
  });

  it("refuses an unclosed quote", () => {
    expect(() => parseTable('Nr;Vārds\n1;"Jānis\n2;Anna')).toThrow("quote");
  });

  it("names blank headers and drops empty trailing columns", () => {
    const table = parseTable("Nr;;Platība;\n1;x;45;\n2;y;60;");
    expect(table.headers).toEqual(["Nr", "Column 2", "Platība"]);
    expect(table.rows[0]).toEqual(["1", "x", "45"]);
  });

  it("refuses empty and oversize tables", () => {
    expect(() => parseTable("")).toThrow("no data rows");
    expect(() => parseTable("a;b\n")).toThrow("no data rows");
    const many =
      "a;b\n" + Array.from({ length: 2001 }, (_, i) => `${i};x`).join("\n");
    expect(() => parseTable(many)).toThrow("too many rows");
  });
});
