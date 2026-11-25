import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePaginationLinks } from "../../src/lib/ui/pagination";
import { translate } from "../../src/lib/ui/i18n";

const root = resolve(import.meta.dirname, "../..");
const srcDir = resolve(root, "src");

function listAstroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAstroFiles(full));
    else if (full.endsWith(".astro")) out.push(full);
  }
  return out;
}

function scanQuoted(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return i;
}

function scanTemplateLiteral(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && src[i + 1] === "{") {
      i = scanJsExpression(src, i + 1);
      continue;
    }
    i++;
  }
  return i;
}

function scanJsExpression(src: string, openBrace: number): number {
  let i = openBrace + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      i = scanQuoted(src, i, ch);
      continue;
    }
    if (ch === "`") {
      i = scanTemplateLiteral(src, i);
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return i;
}

function findFrontmatterEnd(src: string): number {
  if (!/^---\r?\n/.test(src)) return 0;
  let i = src.indexOf("\n") + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      i = scanQuoted(src, i, ch);
      continue;
    }
    if (ch === "`") {
      i = scanTemplateLiteral(src, i);
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (
      src[i - 1] === "\n" &&
      src.startsWith("---", i) &&
      (i + 3 === src.length || src[i + 3] === "\n" || src[i + 3] === "\r")
    ) {
      const nl = src.indexOf("\n", i + 3);
      return nl === -1 ? src.length : nl + 1;
    }
    i++;
  }
  return 0;
}

function maskNonMarkup(src: string): string {
  const fmEnd = findFrontmatterEnd(src);
  const keepNewlines = (s: string) => s.replace(/[^\n]/g, " ");
  let masked = keepNewlines(src.slice(0, fmEnd)) + src.slice(fmEnd);
  masked = masked.replace(/<!--[\s\S]*?-->/g, keepNewlines);
  masked = masked.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, keepNewlines);
  masked = masked.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, keepNewlines);
  return masked;
}

function findAnchorStartTags(
  src: string
): Array<{ line: number; tag: string }> {
  const masked = maskNonMarkup(src);
  const anchors: Array<{ line: number; tag: string }> = [];
  let i = 0;

  while (i < masked.length) {
    if (masked[i] === "{") {
      i = scanJsExpression(masked, i);
      continue;
    }
    if (masked[i] === "<" && /^<a(?=[\s/>])/i.test(masked.slice(i))) {
      let j = i + 2;
      while (j < masked.length) {
        const ch = masked[j];
        if (ch === "'" || ch === '"') {
          j = scanQuoted(masked, j, ch);
          continue;
        }
        if (ch === "{") {
          j = scanJsExpression(masked, j);
          continue;
        }
        if (ch === ">") break;
        j++;
      }
      anchors.push({
        line: masked.slice(0, i).split(/\r?\n/).length,
        tag: masked.slice(i, j + 1),
      });
      i = j + 1;
      continue;
    }
    i++;
  }
  return anchors;
}

function isDisabledAnchorTag(tag: string): boolean {
  if (/pointer-events-none/.test(tag)) return true;
  if (/\baria-disabled\s*=\s*"true"/.test(tag)) return true;
  if (/\baria-disabled\s*=\s*'true'/.test(tag)) return true;
  if (/\baria-disabled\s*=\s*\{/.test(tag)) return true;
  if (/(?:^|\s)aria-disabled(?=[\s/>])/.test(tag)) return true;
  return false;
}

export function scanDisabledAnchorViolations(
  fileLabel: string,
  content: string
): string[] {
  const violations: string[] = [];
  if (content.includes("pointer-events-none opacity-40")) {
    violations.push(`${fileLabel}: contains pointer-events-none opacity-40`);
  }
  for (const { line, tag } of findAnchorStartTags(content)) {
    if (isDisabledAnchorTag(tag)) {
      violations.push(`${fileLabel}:${line}: disabled <a> element found`);
    }
  }
  return violations;
}

describe("pagination accessibility and design-system uniformity", () => {
  it("computes boundary links accurately for first, middle, last, and single pages", () => {
    const buildHref = (p: number) => `?page=${p}`;

    // Page 1 of multiple
    expect(
      resolvePaginationLinks({ page: 1, hasNext: true, buildHref })
    ).toEqual({
      previousHref: null,
      nextHref: "?page=2",
    });

    // Middle page
    expect(
      resolvePaginationLinks({ page: 2, hasNext: true, buildHref })
    ).toEqual({
      previousHref: "?page=1",
      nextHref: "?page=3",
    });

    // Last page
    expect(
      resolvePaginationLinks({ page: 3, hasNext: false, buildHref })
    ).toEqual({
      previousHref: "?page=2",
      nextHref: null,
    });

    // Single page
    expect(
      resolvePaginationLinks({ page: 1, hasNext: false, buildHref })
    ).toEqual({
      previousHref: null,
      nextHref: null,
    });
  });

  it("renders non-focusable role=link aria-disabled spans in both PaginationBar boundary branches", () => {
    const paginationBar = readFileSync(
      resolve(root, "src/components/ui/PaginationBar.astro"),
      "utf8"
    );
    expect(paginationBar).toContain(
      'class:list={["pagination-bar", className]}'
    );

    const prevBranch = paginationBar.match(
      /previousHref\s*\?\s*\(([\s\S]*?)\)\s*:\s*\(([\s\S]*?)\)\s*\}/
    );
    expect(prevBranch, "missing previousHref branch").not.toBeNull();
    expect(prevBranch![1]).toMatch(/<a\s+href=\{previousHref\}/);
    expect(prevBranch![2]).toContain(
      '<span class="btn-secondary btn-sm" role="link" aria-disabled="true">'
    );
    expect(prevBranch![2]).not.toMatch(/<a\b|tabindex/i);

    const nextBranch = paginationBar.match(
      /nextHref\s*\?\s*\(([\s\S]*?)\)\s*:\s*\(([\s\S]*?)\)\s*\}/
    );
    expect(nextBranch, "missing nextHref branch").not.toBeNull();
    expect(nextBranch![1]).toMatch(/<a\s+href=\{nextHref\}/);
    expect(nextBranch![2]).toContain(
      '<span class="btn-secondary btn-sm" role="link" aria-disabled="true">'
    );
    expect(nextBranch![2]).not.toMatch(/<a\b|tabindex/i);

    const paginatedPages = [
      "src/pages/admin/o/[orgId]/dwellings/index.astro",
      "src/pages/admin/o/[orgId]/periods/index.astro",
      "src/pages/admin/o/[orgId]/audit/index.astro",
      "src/pages/admin/o/[orgId]/messages/index.astro",
    ];
    for (const rel of paginatedPages) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(
        src,
        `${rel} should compute links with resolvePaginationLinks`
      ).toContain("resolvePaginationLinks(");
      expect(src, `${rel} should render <PaginationBar>`).toContain(
        "<PaginationBar"
      );
      expect(src).toContain("previousHref={previousHref}");
      expect(src).toContain("nextHref={nextHref}");
    }
  });

  it("handles JSX > expressions inside href and distinguishes aria-disabled=true from aria-disabled=false", () => {
    const disabledAfterComparison = `<a href={page > 1 ? "/p/1" : "/p"} aria-disabled="true">Prev</a>`;
    expect(
      scanDisabledAnchorViolations("Test.astro", disabledAfterComparison)
    ).toEqual(["Test.astro:1: disabled <a> element found"]);

    const enabledExplicit = `<a href="/ok" aria-disabled="false">Next</a>`;
    expect(scanDisabledAnchorViolations("Test.astro", enabledExplicit)).toEqual(
      []
    );
  });

  it("forbids disabled anchors (<a aria-disabled|pointer-events-none>) across all Astro templates", () => {
    const violations: string[] = [];
    for (const file of listAstroFiles(srcDir)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      violations.push(
        ...scanDisabledAnchorViolations(rel, readFileSync(file, "utf8"))
      );
    }
    expect(violations).toEqual([]);
  });

  it("localizes pagination labels into Latvian and Russian", () => {
    for (const key of ["Pagination", "Previous", "Next", "Page", "of"]) {
      expect(translate("lv", key)).not.toBe(key);
      expect(translate("ru", key)).not.toBe(key);
    }
  });
});
