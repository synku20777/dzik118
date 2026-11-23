import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const srcDir = resolve(root, "src");

const FORBIDDEN_FIELD_UTILITIES = new Set([
  "rounded-control",
  "rounded-input",
  "border",
  "border-(--color-input-border)",
  "px-3",
  "py-1.5",
  "py-2",
  "bg-surface",
  "text-foreground",
]);

function listFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full));
    else results.push(full);
  }
  return results;
}

function toRelPath(file: string): string {
  return file.slice(root.length + 1).replace(/\\/g, "/");
}

function stripCssComments(css: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < css.length) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < css.length) {
        out += css[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (let k = i; k < stop; k++) {
        out += css[k] === "\n" ? "\n" : " ";
      }
      i = stop;
      continue;
    }
    out += ch;
    i++;
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

function scanTemplateLiteral(
  src: string,
  start: number,
  onStaticChunk?: (chunk: string) => void
): number {
  let i = start + 1;
  let chunkStart = i;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (ch === "`") {
      onStaticChunk?.(src.slice(chunkStart, i));
      return i + 1;
    }
    if (ch === "$" && src[i + 1] === "{") {
      onStaticChunk?.(src.slice(chunkStart, i));
      i = scanJsExpression(src, i + 1);
      chunkStart = i;
      continue;
    }
    i++;
  }
  onStaticChunk?.(src.slice(chunkStart, i));
  return i;
}

function scanJsExpression(src: string, openBraceIndex: number): number {
  let i = openBraceIndex + 1;
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

function stripAtLayerBlocks(css: string): string {
  const clean = stripCssComments(css);
  let out = "";
  let i = 0;
  let quote: string | null = null;

  while (i < clean.length) {
    const ch = clean[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < clean.length) {
        out += clean[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (
      clean.startsWith("@layer", i) &&
      (i === 0 || !/[A-Za-z0-9_-]/.test(clean[i - 1])) &&
      /[\s{;]/.test(clean[i + 6] ?? "")
    ) {
      let j = i + 6;
      let innerQuote: string | null = null;
      while (j < clean.length) {
        const cj = clean[j];
        if (innerQuote) {
          if (cj === "\\" && j + 1 < clean.length) {
            j += 2;
            continue;
          }
          if (cj === innerQuote) innerQuote = null;
          j++;
          continue;
        }
        if (cj === "'" || cj === '"') {
          innerQuote = cj;
          j++;
          continue;
        }
        if (cj === ";" || cj === "{") break;
        j++;
      }
      if (clean[j] === ";") {
        out += clean.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (clean[j] === "{") {
        let depth = 1;
        let k = j + 1;
        let blockQuote: string | null = null;
        while (k < clean.length && depth > 0) {
          const ck = clean[k];
          if (blockQuote) {
            if (ck === "\\" && k + 1 < clean.length) {
              k += 2;
              continue;
            }
            if (ck === blockQuote) blockQuote = null;
            k++;
            continue;
          }
          if (ck === "'" || ck === '"') {
            blockQuote = ck;
            k++;
            continue;
          }
          if (ck === "{") depth++;
          else if (ck === "}") depth--;
          k++;
        }
        i = k;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function hasUnlayeredSelectChevronRule(css: string): boolean {
  const unlayered = stripAtLayerBlocks(css);
  return /:where\(\s*select:not\(\[multiple\]\)\s*\)\s*\{[^}]*\bpadding-inline-end:\s*2\.25rem\b[^}]*\}/.test(
    unlayered
  );
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
      (i === 0 || src[i - 1] === "\n") &&
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

function extractTokensFromJsExpression(
  expr: string,
  frontmatterConsts?: Map<string, string[]>
): string[] {
  const tokens: string[] = [];
  const pushWords = (raw: string) => {
    for (const part of raw.split(/\s+/)) {
      if (part) tokens.push(part);
    }
  };

  let i = 0;
  let prevSignificantChar = "";
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = scanQuoted(expr, i, ch);
      pushWords(expr.slice(i + 1, end - 1));
      prevSignificantChar = ch;
      i = end;
      continue;
    }
    if (ch === "`") {
      i = scanTemplateLiteral(expr, i, pushWords);
      prevSignificantChar = "`";
      continue;
    }
    if (ch === "/" && expr[i + 1] === "/") {
      const nl = expr.indexOf("\n", i + 2);
      i = nl === -1 ? expr.length : nl + 1;
      continue;
    }
    if (ch === "/" && expr[i + 1] === "*") {
      const end = expr.indexOf("*/", i + 2);
      i = end === -1 ? expr.length : end + 2;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1;
      while (end < expr.length && /[A-Za-z0-9_$-]/.test(expr[end])) end++;
      const ident = expr.slice(i, end);
      let after = end;
      while (after < expr.length && /\s/.test(expr[after])) after++;
      const isObjectKey =
        (prevSignificantChar === "{" || prevSignificantChar === ",") &&
        expr[after] === ":";
      if (isObjectKey) {
        tokens.push(ident);
      } else if (prevSignificantChar !== "." && frontmatterConsts?.has(ident)) {
        tokens.push(...(frontmatterConsts.get(ident) ?? []));
      }
      prevSignificantChar = ident[ident.length - 1];
      i = end;
      continue;
    }
    prevSignificantChar = ch;
    i++;
  }
  return tokens;
}

function extractFrontmatterConsts(frontmatter: string): Map<string, string[]> {
  const consts = new Map<string, string[]>();
  const declRe =
    /(?:^|\n)[ \t]*(?:const|let)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*=[ \t]*/g;
  let match: RegExpExecArray | null;
  while ((match = declRe.exec(frontmatter)) !== null) {
    const name = match[1];
    let i = match.index + match[0].length;
    let depth = 0;
    while (i < frontmatter.length) {
      const ch = frontmatter[i];
      if (ch === "'" || ch === '"') {
        i = scanQuoted(frontmatter, i, ch);
        continue;
      }
      if (ch === "`") {
        i = scanTemplateLiteral(frontmatter, i);
        continue;
      }
      if (ch === "/" && frontmatter[i + 1] === "/") {
        const nl = frontmatter.indexOf("\n", i + 2);
        if (depth === 0) break;
        i = nl === -1 ? frontmatter.length : nl + 1;
        continue;
      }
      if (ch === "/" && frontmatter[i + 1] === "*") {
        const end = frontmatter.indexOf("*/", i + 2);
        i = end === -1 ? frontmatter.length : end + 2;
        continue;
      }
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") {
        if (depth > 0) depth--;
      } else if (depth === 0 && (ch === ";" || ch === "\n")) {
        break;
      }
      i++;
    }
    const initExpr = frontmatter.slice(match.index + match[0].length, i);
    const extracted = extractTokensFromJsExpression(initExpr);
    if (extracted.length > 0) {
      consts.set(name, extracted);
    }
  }
  return consts;
}

function maskSlicePreservingNewlines(slice: string): string {
  return slice.replace(/[^\n]/g, " ");
}

function prepareTemplateForScan(src: string) {
  const fmEnd = findFrontmatterEnd(src);
  const frontmatter = src.slice(0, fmEnd);
  const frontmatterConsts = extractFrontmatterConsts(frontmatter);

  let masked = maskSlicePreservingNewlines(frontmatter) + src.slice(fmEnd);
  const styles: string[] = [];

  masked = masked.replace(/<!--[\s\S]*?-->/g, (comment) =>
    maskSlicePreservingNewlines(comment)
  );
  masked = masked.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (full, body: string) => {
      styles.push(body);
      return maskSlicePreservingNewlines(full);
    }
  );
  masked = masked.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (full) =>
    maskSlicePreservingNewlines(full)
  );

  return { masked, frontmatterConsts, styles };
}

interface ParsedControlTag {
  tag: "input" | "select" | "textarea";
  index: number;
  line: number;
  type: string | null;
  classTokens: string[];
}

function parseTagAttributes(
  attrs: string,
  frontmatterConsts: Map<string, string[]>
): { type: string | null; classTokens: string[] } {
  let type: string | null = null;
  const classTokens: string[] = [];
  let i = 0;

  while (i < attrs.length) {
    while (i < attrs.length && /[\s/]/.test(attrs[i])) i++;
    if (i >= attrs.length) break;

    if (attrs[i] === "{") {
      i = scanJsExpression(attrs, i);
      continue;
    }

    const nameStart = i;
    while (i < attrs.length && !/[\s=/>]/.test(attrs[i])) i++;
    const name = attrs.slice(nameStart, i);
    while (i < attrs.length && /\s/.test(attrs[i])) i++;

    if (attrs[i] !== "=") continue;
    i++;
    while (i < attrs.length && /\s/.test(attrs[i])) i++;
    if (i >= attrs.length) break;

    let rawVal: string;
    let isExpr = false;
    if (attrs[i] === "'" || attrs[i] === '"') {
      const end = scanQuoted(attrs, i, attrs[i]);
      rawVal = attrs.slice(i + 1, end - 1);
      i = end;
    } else if (attrs[i] === "{") {
      const end = scanJsExpression(attrs, i);
      rawVal = attrs.slice(i + 1, end - 1);
      isExpr = true;
      i = end;
    } else {
      const valStart = i;
      while (i < attrs.length && !/[\s>]/.test(attrs[i])) i++;
      rawVal = attrs.slice(valStart, i);
    }

    if (name === "type" && !isExpr) {
      type = rawVal.toLowerCase();
    } else if (name === "class" || name === "class:list") {
      if (isExpr) {
        classTokens.push(
          ...extractTokensFromJsExpression(rawVal, frontmatterConsts)
        );
      } else {
        for (const token of rawVal.split(/\s+/)) {
          if (token) classTokens.push(token);
        }
      }
    }
  }

  return { type, classTokens };
}

function findControlTags(
  masked: string,
  frontmatterConsts: Map<string, string[]>
): ParsedControlTag[] {
  const tags: ParsedControlTag[] = [];
  let i = 0;

  while (i < masked.length) {
    if (masked[i] === "{") {
      i = scanJsExpression(masked, i);
      continue;
    }
    if (masked[i] === "<") {
      const match = masked
        .slice(i)
        .match(/^<(input|select|textarea)(?=[\s/>])/);
      if (match) {
        const tag = match[1] as ParsedControlTag["tag"];
        let j = i + match[0].length;
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
        const attrs = masked.slice(i + match[0].length, j);
        const { type, classTokens } = parseTagAttributes(
          attrs,
          frontmatterConsts
        );
        tags.push({
          tag,
          index: i,
          line: masked.slice(0, i).split(/\r?\n/).length,
          type,
          classTokens,
        });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return tags;
}

function splitCssSelectorList(selectorList: string): string[] {
  const parts: string[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < selectorList.length; i++) {
    const ch = selectorList[i];
    if (quote) {
      if (ch === "\\" && i + 1 < selectorList.length) i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") parenDepth++;
    else if (ch === ")" && parenDepth > 0) parenDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]" && bracketDepth > 0) bracketDepth--;
    else if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
      parts.push(selectorList.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = selectorList.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function getSelectorSubject(selector: string): string {
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;
  let lastSplit = -1;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === "\\" && i + 1 < selector.length) i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") parenDepth++;
    else if (ch === ")" && parenDepth > 0) parenDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]" && bracketDepth > 0) bracketDepth--;
    else if (
      parenDepth === 0 &&
      bracketDepth === 0 &&
      (ch === " " ||
        ch === "\t" ||
        ch === "\n" ||
        ch === ">" ||
        ch === "+" ||
        ch === "~")
    ) {
      lastSplit = i;
    }
  }
  return selector.slice(lastSplit + 1).trim();
}

function selectorTargetsSelect(
  selector: string,
  selectClasses: Set<string>
): boolean {
  const subject = getSelectorSubject(selector);
  if (!subject) return false;
  if (/^select(?:$|[.#:[])/i.test(subject)) return true;

  for (const m of subject.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) {
    if (selectClasses.has(m[1])) return true;
  }
  return false;
}

function visitCssRuleBlocks(
  css: string,
  onRule: (selectorList: string, declarations: string) => void
): void {
  let i = 0;
  let stmtStart = 0;
  let quote: string | null = null;

  while (i < css.length) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\" && i + 1 < css.length) {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      i++;
      continue;
    }
    if (ch === ";") {
      stmtStart = i + 1;
      i++;
      continue;
    }
    if (ch === "{") {
      const header = css.slice(stmtStart, i).trim();
      let depth = 1;
      let j = i + 1;
      let innerQuote: string | null = null;
      while (j < css.length && depth > 0) {
        const cj = css[j];
        if (innerQuote) {
          if (cj === "\\" && j + 1 < css.length) {
            j += 2;
            continue;
          }
          if (cj === innerQuote) innerQuote = null;
          j++;
          continue;
        }
        if (cj === "'" || cj === '"') {
          innerQuote = cj;
          j++;
          continue;
        }
        if (cj === "{") depth++;
        else if (cj === "}") depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      if (header.startsWith("@")) {
        if (!/^@(?:keyframes|font-face|page|property)\b/i.test(header)) {
          visitCssRuleBlocks(body, onRule);
        }
      } else if (header) {
        onRule(header, stripNestedBlocks(body));
        visitCssRuleBlocks(body, onRule);
      }
      i = j;
      stmtStart = j;
      continue;
    }
    i++;
  }
}

function stripNestedBlocks(body: string): string {
  let out = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (depth === 0) out += ch;
      if (ch === "\\" && i + 1 < body.length) {
        if (depth === 0) out += body[i + 1];
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      if (depth === 0) out += ch;
      continue;
    }
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth--;
      out += ";";
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

export function scanAstroFormControlViolations(
  fileLabel: string,
  src: string
): string[] {
  const violations: string[] = [];
  const { masked, frontmatterConsts, styles } = prepareTemplateForScan(src);
  const tags = findControlTags(masked, frontmatterConsts);
  const selectClasses = new Set<string>();

  for (const { tag, line, type, classTokens } of tags) {
    if (
      tag === "input" &&
      type &&
      /^(hidden|checkbox|radio|file|color|range)$/.test(type)
    ) {
      continue;
    }
    if (tag === "select") {
      for (const cls of classTokens) selectClasses.add(cls);
    }
    const offending = classTokens.filter((cls) =>
      FORBIDDEN_FIELD_UTILITIES.has(cls)
    );
    if (offending.length > 0) {
      violations.push(
        `${fileLabel}:${line} <${tag}> (${offending.join(", ")})`
      );
    }
  }

  for (const styleBody of styles) {
    const cleanCss = stripCssComments(styleBody);
    visitCssRuleBlocks(cleanCss, (selectorList, decls) => {
      const selectors = splitCssSelectorList(selectorList);
      if (!selectors.some((sel) => selectorTargetsSelect(sel, selectClasses))) {
        return;
      }
      if (/(?:^|[\s;{])padding(?:-right|-inline-end)?\s*:/i.test(decls)) {
        violations.push(
          `${fileLabel} <style> "${selectorList.replace(/\s+/g, " ")}" overrides select chevron padding`
        );
      }
    });
  }

  return violations;
}

describe("form control base-layer fidelity", () => {
  it("protects <select> chevron clearance unlayered in global.css", () => {
    const globalCss = readFileSync(
      resolve(root, "src/styles/global.css"),
      "utf8"
    );
    expect(hasUnlayeredSelectChevronRule(globalCss)).toBe(true);
  });

  it("rejects chevron rule moved inside @layer base and accepts unlayered rule", () => {
    expect(
      hasUnlayeredSelectChevronRule(
        `@layer base { :where(select:not([multiple])) { padding-inline-end: 2.25rem; } }`
      )
    ).toBe(false);
    expect(
      hasUnlayeredSelectChevronRule(
        `@layer base, components;\n:where(select:not([multiple])) {\n  padding-inline-end: 2.25rem;\n}`
      )
    ).toBe(true);
  });

  it("detects dynamic, class:list, template-literal apostrophe, and <style> padding counterexamples without frontmatter/script false positives", () => {
    const dynamicOverride = `---
const field = "mt-1 w-full text-sm px-3";
---
<input class={field} />`;
    expect(
      scanAstroFormControlViolations("Test.astro", dynamicOverride)
    ).toEqual(["Test.astro:4 <input> (px-3)"]);

    const classListOverride = `<select class:list={["w-full", { "px-3": compact }]}></select>`;
    expect(
      scanAstroFormControlViolations("Test.astro", classListOverride)
    ).toEqual(["Test.astro:1 <select> (px-3)"]);

    const conditionalClassOverride = `<input class={hasError ? "px-3" : "w-full"} />`;
    expect(
      scanAstroFormControlViolations("Test.astro", conditionalClassOverride)
    ).toEqual(["Test.astro:1 <input> (px-3)"]);

    const apostropheInTemplateExpr = `<input title={\`User's name\`} class="px-3" />`;
    expect(
      scanAstroFormControlViolations("Test.astro", apostropheInTemplateExpr)
    ).toEqual(["Test.astro:1 <input> (px-3)"]);

    const quotedInFrontmatterAndScript = `---
const example = "<select class='px-3'>";
---
<input class="w-full" />
<script>
  const snippet = "<textarea class='border px-3'></textarea>";
</script>`;
    expect(
      scanAstroFormControlViolations("Test.astro", quotedInFrontmatterAndScript)
    ).toEqual([]);

    const stylePaddingOverride = `<select class="tpl-zoom-select"><option>100%</option></select>
<style>
  .tpl-zoom-select {
    padding: 0.5rem;
  }
</style>`;
    expect(
      scanAstroFormControlViolations("Test.astro", stylePaddingOverride)
    ).toEqual([
      'Test.astro <style> ".tpl-zoom-select" overrides select chevron padding',
    ]);
  });

  it("does not override base field chrome or select chevron clearance across src/**/*.astro", () => {
    const astroFiles = listFiles(srcDir).filter((file) =>
      file.endsWith(".astro")
    );
    const violations = astroFiles.flatMap((file) =>
      scanAstroFormControlViolations(
        toRelPath(file),
        readFileSync(file, "utf8")
      )
    );
    expect(violations).toEqual([]);
  });
});
