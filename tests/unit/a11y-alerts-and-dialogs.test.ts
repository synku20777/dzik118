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

interface AstroOpeningElement {
  name?: { type?: string; name?: string };
  attributes?: AstroAttr[];
  start?: number;
  end?: number;
}

interface AstroElementNode {
  type: "JSXElement";
  openingElement?: AstroOpeningElement;
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

function walkAst(node: unknown, visit: (node: AstroElementNode) => void): void {
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
  const elements: AstroElementNode[] = [];
  walkAst((parsed as unknown as { ast: { body: unknown } }).ast.body, (el) =>
    elements.push(el)
  );
  return elements;
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

function collectDialogViolations(rel: string, content: string): string[] {
  const violations: string[] = [];
  for (const el of extractElements(content)) {
    if (
      tagNameOf(el) === "dialog" &&
      attrRawOf(el, "aria-labelledby", content) === null
    ) {
      violations.push(`${rel}:${lineOf(el, content)}`);
    }
  }
  return violations;
}

function collectStaticDanglingErrorDescribedBy(
  rel: string,
  content: string
): string[] {
  if (rel === "src/pages/design-system.astro") return [];
  const violations: string[] = [];
  for (const el of extractElements(content)) {
    const raw = attrRawOf(el, "aria-describedby", content);
    if (!raw) continue;
    const staticMatch = raw.match(
      /^(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\})$/
    );
    if (!staticMatch) continue;
    const val = staticMatch[1] ?? staticMatch[2] ?? staticMatch[3] ?? "";
    if (/\b\S*-error\b/.test(val)) {
      violations.push(`${rel}:${lineOf(el, content)} (${val})`);
    }
  }
  return violations;
}

function collectAlertNoticeViolations(
  rel: string,
  content: string
): {
  handRolledAlerts: string[];
  missingLiveRoles: string[];
  noticeCount: number;
} {
  const handRolledAlerts: string[] = [];
  const missingLiveRoles: string[] = [];
  let noticeCount = 0;

  for (const el of extractElements(content)) {
    const tag = tagNameOf(el);
    const clsRaw = attrRawOf(el, "class", content);
    if (!clsRaw) continue;

    if (tag === "p" && /\bbg-(?:danger|success)-surface\b/.test(clsRaw)) {
      handRolledAlerts.push(`${rel}:${lineOf(el, content)}`);
    }
    if (rel === "src/pages/design-system.astro") continue;

    if (/\bnotice-danger\b/.test(clsRaw)) {
      noticeCount++;
      const roleRaw = attrRawOf(el, "role", content) ?? "";
      const isStaticAdminBanner =
        rel === "src/layouts/AdminLayout.astro" &&
        /^"status"$|^'status'$/.test(roleRaw.trim());
      if (
        !isStaticAdminBanner &&
        !/^"alert"$|^'alert'$|\{[^}]*"alert"[^}]*\}/.test(roleRaw.trim())
      ) {
        missingLiveRoles.push(`${rel}:${lineOf(el, content)} (notice-danger)`);
      }
    }
    if (/\bnotice-success\b/.test(clsRaw)) {
      noticeCount++;
      const roleRaw = attrRawOf(el, "role", content) ?? "";
      if (
        !/^"status"$|^'status'$|\{[^}]*"status"[^}]*\}/.test(roleRaw.trim())
      ) {
        missingLiveRoles.push(`${rel}:${lineOf(el, content)} (notice-success)`);
      }
    }
  }

  return { handRolledAlerts, missingLiveRoles, noticeCount };
}

describe("dialog ARIA, live alert notices, and non-dangling aria-describedby", () => {
  it("defines .notice-success with semantic success tokens in global.css", () => {
    const globalCss = readFileSync(
      resolve(root, "src/styles/global.css"),
      "utf8"
    );
    expect(globalCss).toMatch(
      /\.notice-success\s*\{[^}]*background:\s*var\(--tone-success-bg\);[^}]*color:\s*var\(--tone-success-text\);/
    );
  });

  it("ensures every <dialog> has a label and production lock dialogs use the shared title and description", () => {
    const missingLabelledBy: string[] = [];
    for (const file of listAstroFiles(srcDir)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      missingLabelledBy.push(
        ...collectDialogViolations(rel, readFileSync(file, "utf8"))
      );
    }
    expect(missingLabelledBy).toEqual([]);

    const dwellingDetail = readFileSync(
      resolve(root, "src/pages/admin/o/[orgId]/dwellings/[dwellingId].astro"),
      "utf8"
    );
    const lockDialog = readFileSync(
      resolve(root, "src/components/ui/LockDialog.astro"),
      "utf8"
    );
    const periodDetail = readFileSync(
      resolve(root, "src/pages/admin/o/[orgId]/periods/[periodId]/index.astro"),
      "utf8"
    );
    expect(dwellingDetail).toMatch(/<LockDialog\s+id="archive-dialog"/);
    expect(periodDetail).toMatch(/<LockDialog\s+id="lock-period-dialog"/);
    expect(lockDialog).toContain("aria-labelledby={`${id}-title`}");
    expect(lockDialog).toContain("aria-describedby={`${id}-description`}");
    expect(lockDialog).toContain("<h2 id={`${id}-title`}>");
    expect(lockDialog).toContain("<p id={`${id}-description`}>");
  });

  it("has zero static dangling aria-describedby='*-error' references outside static design-system specimen", () => {
    const violations: string[] = [];
    for (const file of listAstroFiles(srcDir)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      violations.push(
        ...collectStaticDanglingErrorDescribedBy(
          rel,
          readFileSync(file, "utf8")
        )
      );
    }
    expect(violations).toEqual([]);
  });

  it("replaces hand-rolled bg-danger-surface/bg-success-surface alert <p> elements with semantic .notice + live roles across JSX conditionals", () => {
    const handRolledAlerts: string[] = [];
    const missingLiveRoles: string[] = [];
    let scannedNoticeCount = 0;

    for (const file of listAstroFiles(srcDir)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      const res = collectAlertNoticeViolations(rel, readFileSync(file, "utf8"));
      handRolledAlerts.push(...res.handRolledAlerts);
      missingLiveRoles.push(...res.missingLiveRoles);
      scannedNoticeCount += res.noticeCount;
    }

    expect(scannedNoticeCount).toBeGreaterThanOrEqual(24);
    expect(handRolledAlerts).toEqual([]);
    expect(missingLiveRoles).toEqual([]);
  });

  it("AST checker detects violations nested inside JSX conditional expressions", () => {
    const sample = `---
const err = "bad";
const show = true;
---
<div>
  {err && (<p class="notice notice-danger">{err}</p>)}
  {err && (<p class="bg-danger-surface">{err}</p>)}
  {show && (<input id="year" aria-describedby="year-error" />)}
</div>`;
    const alertCheck = collectAlertNoticeViolations(
      "src/pages/synthetic.astro",
      sample
    );
    expect(alertCheck.noticeCount).toBe(1);
    expect(alertCheck.missingLiveRoles).toEqual([
      "src/pages/synthetic.astro:6 (notice-danger)",
    ]);
    expect(alertCheck.handRolledAlerts).toEqual([
      "src/pages/synthetic.astro:7",
    ]);
    expect(
      collectStaticDanglingErrorDescribedBy("src/pages/synthetic.astro", sample)
    ).toEqual(["src/pages/synthetic.astro:8 (year-error)"]);
  });

  it("wires fieldErrorAttrs alongside <FieldError> across all SSR forms", () => {
    const filesUsingFieldError: string[] = [];
    const missingFieldErrorAttrs: string[] = [];

    for (const file of listAstroFiles(srcDir)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      if (rel === "src/components/ui/FieldError.astro") continue;
      const content = readFileSync(file, "utf8");
      if (!content.includes("<FieldError")) continue;
      filesUsingFieldError.push(rel);
      if (!content.includes("fieldErrorAttrs(")) {
        missingFieldErrorAttrs.push(rel);
      }
    }

    expect(filesUsingFieldError.length).toBeGreaterThanOrEqual(11);
    expect(missingFieldErrorAttrs).toEqual([]);
  });

  it("adopts FieldError in dwelling detail and per-field ARIA in the tariff drawer", () => {
    const dwellingDetail = readFileSync(
      resolve(root, "src/pages/admin/o/[orgId]/dwellings/[dwellingId].astro"),
      "utf8"
    );
    expect(dwellingDetail).toContain("<FieldError");
    expect(dwellingDetail).toContain('name="billingEmail"');

    const rules = readFileSync(
      resolve(root, "src/pages/admin/o/[orgId]/settings/rules.astro"),
      "utf8"
    );
    // Each field error is its own paragraph after the field, linked by
    // aria-describedby, and cleared with the field's invalid state.
    expect(rules).toContain('paragraph.className = "field-error"');
    expect(rules).toContain('field.setAttribute("aria-invalid", "true")');
    expect(rules).toContain('field.removeAttribute("aria-invalid")');
    expect(rules).toMatch(/aria-describedby[\s\S]*paragraph\.id/);
  });
});
