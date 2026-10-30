// The Migration Center pages carry an uploaded file between steps, so each one
// must keep its guard and its Origin check, and every English string on them
// needs an LV and an RU entry (the domain-message test does not scan pages).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BALANCE_NO_PERIOD_NOTICE } from "../../src/domain/migration/balances";
import {
  BALANCE_FIELDS,
  DWELLING_FIELDS,
  METER_FIELDS,
} from "../../src/domain/migration/targets";
import { translate } from "../../src/lib/ui/i18n";

const dir = join(
  process.cwd(),
  "src",
  "pages",
  "admin",
  "o",
  "[orgId]",
  "migration"
);
const read = (name: string) => readFileSync(join(dir, name), "utf8");

describe("migration page guards", () => {
  it("the import page needs an active organization and a same-origin POST", () => {
    const page = read("[kind].astro");
    expect(page).toContain("requireActiveOrganization(");
    expect(page).toContain("isSameOriginRequest(");
  });

  it("the history page, the report and the downloads need organization access", () => {
    expect(read("index.astro")).toContain("requireOrganizationAccess(");
    expect(read(join("report", "[importId].astro"))).toContain(
      "requireOrganizationAccess("
    );
    expect(read(join("report", "[importId]", "csv.ts"))).toContain(
      "requireOrganizationAccess("
    );
    expect(read(join("templates", "[name].ts"))).toContain(
      "requireOrganizationAccess("
    );
    const issues = read("issues.ts");
    expect(issues).toContain("requireOrganizationAccess(");
    expect(issues).toContain("isSameOriginRequest(");
  });
});

const T_LITERAL = /\bt\(\s*("(?:[^"\\]|\\.)*")\s*\)/g;
const ERROR_LITERAL =
  /(?:new ValidationError\(|\berror = )\s*("(?:[^"\\]|\\.)*")/g;

describe("migration page strings", () => {
  const strings = new Set<string>();
  for (const name of [
    "[kind].astro",
    "index.astro",
    join("report", "[importId].astro"),
  ]) {
    const page = read(name);
    for (const re of [T_LITERAL, ERROR_LITERAL]) {
      for (const match of page.matchAll(re)) {
        strings.add(JSON.parse(match[1]) as string);
      }
    }
  }
  for (const field of [
    ...DWELLING_FIELDS,
    ...BALANCE_FIELDS,
    ...METER_FIELDS,
  ]) {
    strings.add(field.label);
  }
  // Header and total cells of the CSV files (flow.ts), and a message the
  // import page picks with a conditional.
  for (const word of [
    "Row",
    "Dwelling number",
    "Status",
    "Message",
    "Type",
    "Amount",
    "Balance now",
    "Total debt in the file",
    "Total debt in the ledger",
    "Total credit in the file",
    "Total credit in the ledger",
    "Map the dwelling number column, and use each field once",
    BALANCE_NO_PERIOD_NOTICE,
  ]) {
    strings.add(word);
  }

  it("finds the strings", () => {
    expect(strings.size).toBeGreaterThan(40);
  });

  it("has a Latvian and a Russian entry for each one", () => {
    const missing: string[] = [];
    for (const text of strings) {
      for (const locale of ["lv", "ru"] as const) {
        if (translate(locale, text) === text)
          missing.push(`${locale}: ${text}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
