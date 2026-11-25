import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function astroFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) return astroFiles(full);
    return full.endsWith(".astro") ? [full] : [];
  });
}

// ADR 0010: "no large Fraunces numbers"; DESIGN_SYSTEM.md "Page header".
describe("Fraunces (.font-display) scope", () => {
  const files = astroFiles(resolve(root, "src/pages")).filter(
    (file) => !file.endsWith("design-system.astro")
  );

  it("never sets a figure (<strong>) in Fraunces", () => {
    const hits = files.filter((file) =>
      /<strong[^>]*\bfont-display\b/.test(readFileSync(file, "utf8"))
    );
    expect(hits.map((file) => relative(root, file))).toEqual([]);
  });

  it("keeps migration and payment-transaction headings in sans", () => {
    const hits = files
      .filter((file) =>
        /[\\/](migration[\\/]|payments[\\/]\[transactionId\])/.test(file)
      )
      .filter((file) =>
        /<h1[^>]*\bfont-display\b/.test(readFileSync(file, "utf8"))
      );
    expect(hits.map((file) => relative(root, file))).toEqual([]);
  });
});
