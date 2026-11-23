import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@astrojs/compiler-rs";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const srcDir = resolve(root, "src");

interface AstroAttr {
  type?: string;
  name?: { type?: string; name?: string };
  value?: { start?: number; end?: number } | null;
}

interface AstroElementNode {
  type: "JSXElement";
  openingElement?: {
    name?: { type?: string; name?: string };
    attributes?: AstroAttr[];
    start?: number;
  };
  children?: unknown[];
  start?: number;
}

function listAstroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAstroFiles(full));
    else if (full.endsWith(".astro")) out.push(full);
  }
  return out;
}

function walkAst(node: unknown, visit: (el: AstroElementNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "JSXElement") {
    visit(rec as unknown as AstroElementNode);
  }
  for (const key of Object.keys(rec)) {
    if (key === "frontmatter" || key === "loc" || key === "parent") continue;
    const val = rec[key];
    if (val && typeof val === "object") walkAst(val, visit);
  }
}

function extractElements(src: string): AstroElementNode[] {
  const parsed = parse(src);
  const out: AstroElementNode[] = [];
  walkAst((parsed as unknown as { ast: { body: unknown } }).ast.body, (el) =>
    out.push(el)
  );
  return out;
}

function tagNameOf(el: AstroElementNode): string {
  const name = el.openingElement?.name;
  return name?.type === "JSXIdentifier" && typeof name.name === "string"
    ? name.name.toLowerCase()
    : "";
}

function attrRawOf(
  el: AstroElementNode,
  attrName: string,
  src: string
): string | null {
  for (const attr of el.openingElement?.attributes ?? []) {
    if (
      attr.type === "JSXAttribute" &&
      attr.name?.type === "JSXIdentifier" &&
      attr.name.name === attrName
    ) {
      if (
        attr.value &&
        typeof attr.value.start === "number" &&
        typeof attr.value.end === "number"
      ) {
        return src.slice(attr.value.start, attr.value.end);
      }
      return "";
    }
  }
  return null;
}

function lineOf(el: AstroElementNode, src: string): number {
  const start = el.start ?? el.openingElement?.start ?? 0;
  return src.slice(0, start).split(/\r?\n/).length;
}

function findBareCheckboxLabelViolations(
  rel: string,
  content: string
): string[] {
  const violations: string[] = [];
  for (const el of extractElements(content)) {
    if (tagNameOf(el) !== "label") continue;
    let wrapsCheckbox = false;
    walkAst(el.children, (child) => {
      if (tagNameOf(child) === "input") {
        const typeRaw = attrRawOf(child, "type", content) ?? "";
        if (/^["']checkbox["']$/.test(typeRaw.trim())) wrapsCheckbox = true;
      }
    });
    if (!wrapsCheckbox) continue;
    const clsRaw = attrRawOf(el, "class", content) ?? "";
    if (/\bflex\b/.test(clsRaw) && /\bpb-2\b/.test(clsRaw)) {
      violations.push(`${rel}:${lineOf(el, content)} (${clsRaw})`);
    }
  }
  return violations;
}

describe("P1-6 touch targets: .check-row, .check-target, and .icon-btn consolidation", () => {
  it("defines .check-row (44px) and .check-target (36px desktop / 44px coarse) in global.css", () => {
    const globalCss = readFileSync(
      resolve(root, "src/styles/global.css"),
      "utf8"
    );
    expect(globalCss).toMatch(
      /\.check-row\s*\{[^}]*min-height:\s*var\(--control-size-md\);/
    );
    expect(globalCss).toMatch(
      /\.check-target\s*\{[^}]*min-width:\s*var\(--control-size-sm\);[^}]*min-height:\s*var\(--control-size-sm\);/
    );
    expect(globalCss).toMatch(
      /@media\s*\(pointer:\s*coarse\)\s*\{\s*\.check-target\s*\{[^}]*min-width:\s*var\(--control-size-md\);[^}]*min-height:\s*var\(--control-size-md\);/
    );
  });

  it("adopts .check-row across all labelled bare checkbox controls and has zero bare flex-pb-2 checkbox labels", () => {
    const checkRowPages = [
      "src/pages/admin/o/[orgId]/dwellings/index.astro",
      "src/pages/admin/o/[orgId]/settings/rules.astro",
      "src/pages/admin/o/[orgId]/messages/index.astro",
      "src/pages/admin/o/[orgId]/periods/[periodId]/dwellings/[dwellingId].astro",
    ];
    for (const rel of checkRowPages) {
      const content = readFileSync(resolve(root, rel), "utf8");
      const checkboxCheckRows = extractElements(content).filter((el) => {
        if (tagNameOf(el) !== "label") return false;
        const cls = attrRawOf(el, "class", content) ?? "";
        if (!/\bcheck-row\b/.test(cls)) return false;
        let hasCb = false;
        walkAst(el.children, (child) => {
          if (tagNameOf(child) === "input") {
            const typeRaw = attrRawOf(child, "type", content) ?? "";
            if (/^["']checkbox["']$/.test(typeRaw.trim())) hasCb = true;
          }
        });
        return hasCb;
      });
      expect(checkboxCheckRows.length).toBeGreaterThanOrEqual(1);
    }

    const rulesContent = readFileSync(
      resolve(root, "src/pages/admin/o/[orgId]/settings/rules.astro"),
      "utf8"
    );
    expect(rulesContent).not.toContain("rule-edit-checkbox");

    const violations: string[] = [];
    for (const file of listAstroFiles(srcDir)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      violations.push(
        ...findBareCheckboxLabelViolations(rel, readFileSync(file, "utf8"))
      );
    }
    expect(violations).toEqual([]);

    const syntheticViolation = `---
const m = { currentValue: "10" };
---
{m.currentValue !== null && (
  <label class="flex items-center gap-2 pb-2 text-body-sm text-foreground">
    <input type="checkbox" name="force" value="true" />
    Confirm
  </label>
)}`;
    expect(
      findBareCheckboxLabelViolations(
        "src/pages/synthetic.astro",
        syntheticViolation
      )
    ).toHaveLength(1);
  });

  it("wraps workbench bulk checkboxes (#select-all and invoiceIds) in <label class='check-target'>", () => {
    const workbenchPath = resolve(
      root,
      "src/pages/admin/o/[orgId]/periods/[periodId]/index.astro"
    );
    const content = readFileSync(workbenchPath, "utf8");
    const checkTargets = extractElements(content).filter(
      (el) =>
        tagNameOf(el) === "label" &&
        /\bcheck-target\b/.test(attrRawOf(el, "class", content) ?? "")
    );

    let wrapsSelectAll = false;
    let wrapsInvoiceId = false;
    for (const lbl of checkTargets) {
      walkAst(lbl.children, (child) => {
        if (tagNameOf(child) !== "input") return;
        const idRaw = attrRawOf(child, "id", content) ?? "";
        const nameRaw = attrRawOf(child, "name", content) ?? "";
        if (idRaw === '"select-all"') wrapsSelectAll = true;
        if (nameRaw === '"invoiceIds"') wrapsInvoiceId = true;
      });
    }
    expect(wrapsSelectAll).toBe(true);
    expect(wrapsInvoiceId).toBe(true);
  });

  it("consolidates .tpl-accordion-btn onto .icon-btn.icon-btn-sm with ICONS['chevron-right'] and reduced-motion transition", () => {
    const editorTs = readFileSync(
      resolve(root, "src/lib/ui/invoice-template-editor.ts"),
      "utf8"
    );
    expect(editorTs).toContain("icon-btn icon-btn-sm tpl-accordion-btn");
    expect(editorTs).toContain('ICONS["chevron-right"]');
    expect(editorTs).not.toContain('textContent = "›"');

    const tplAstro = readFileSync(
      resolve(
        root,
        "src/pages/admin/o/[orgId]/settings/invoice-template.astro"
      ),
      "utf8"
    );
    const accordionCssMatch = tplAstro.match(
      /\.tpl-accordion-btn\s*\{([^}]*)\}/
    );
    expect(accordionCssMatch?.[1]).toBeDefined();
    expect(accordionCssMatch?.[1]).not.toMatch(
      /\b(?:border|padding|background)\b/
    );
    expect(tplAstro).not.toMatch(/\.tpl-accordion-btn:hover\s*\{/);
    expect(tplAstro).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.tpl-chevron-icon\s*\{[^}]*transition:\s*none;/
    );
  });

  it("keeps the template Bold checkboxes and phone stack-table check targets at full size", () => {
    const editorTs = readFileSync(
      resolve(root, "src/lib/ui/invoice-template-editor.ts"),
      "utf8"
    );
    expect(editorTs).toContain('"tpl-control check-row"');
    const css = readFileSync(resolve(root, "src/styles/global.css"), "utf8");
    // A bare `.stack-table td > *` min-width reset would shrink .check-target.
    expect(css).not.toMatch(/\.stack-table td > \*\s*\{/);
    expect(css).toContain(".stack-table td > :not(.check-target)");
  });
});
