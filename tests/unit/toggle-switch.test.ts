import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const globalCss = readFileSync(resolve(root, "src/styles/global.css"), "utf8");
const billingAstro = readFileSync(
  resolve(root, "src/pages/admin/o/[orgId]/settings/billing.astro"),
  "utf8"
);
const templateAstro = readFileSync(
  resolve(root, "src/pages/admin/o/[orgId]/settings/invoice-template.astro"),
  "utf8"
);
const templateEditorTs = readFileSync(
  resolve(root, "src/lib/ui/invoice-template-editor.ts"),
  "utf8"
);

function paletteHex(token: string): string {
  const match = globalCss.match(
    new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`)
  );
  if (!match) throw new Error(`Missing hex token ${token} in global.css`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("design-system toggle switch", () => {
  it("keeps WCAG 1.4.11 >= 3:1 contrast across light and dark themes", () => {
    expect(globalCss).toMatch(
      /--color-control-thumb:\s*var\(--color-on-primary\)/
    );

    const light = {
      surface: paletteHex("--palette-paper"),
      surfaceHover: paletteHex("--palette-limestone-100"),
      muted: paletteHex("--palette-ink-500"),
      primary: paletteHex("--palette-daugava-700"),
      thumbOn: paletteHex("--palette-paper"),
    };
    const dark = {
      surface: paletteHex("--palette-night-900"),
      surfaceHover: paletteHex("--palette-night-800"),
      muted: paletteHex("--palette-night-300"),
      primary: paletteHex("--palette-daugava-200"),
      thumbOn: paletteHex("--palette-ink-900"),
    };

    for (const [name, theme] of Object.entries({ light, dark })) {
      expect(
        contrastRatio(theme.muted, theme.surface),
        `${name} unchecked border vs surface`
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(theme.muted, theme.surfaceHover),
        `${name} unchecked border vs surface-hover`
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(theme.primary, theme.surface),
        `${name} checked track vs surface`
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(theme.thumbOn, theme.primary),
        `${name} checked thumb vs checked track`
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("centralizes switch styling and enforces switch semantics everywhere", () => {
    expect(globalCss).toContain(".toggle-switch");
    expect(globalCss).toContain("pointer-events: none;");
    expect(globalCss).toContain("outline: 2px solid var(--color-focus-ring)");
    expect(globalCss).toContain("outline-color: CanvasText;");
    expect(globalCss).toContain("border-color: GrayText;");
    expect(globalCss).toContain("@media (pointer: coarse)");
    expect(globalCss).toContain(
      "@media (prefers-reduced-motion: no-preference)"
    );
    expect(globalCss).toContain("forced-colors: active");

    const switchInputsInBilling = billingAstro.match(/role="switch"/g) ?? [];
    expect(switchInputsInBilling).toHaveLength(3);
    expect(billingAstro).not.toContain('<label class="toggle-row" form=');
    expect(billingAstro).not.toContain(".toggle-switch-track");

    expect(templateEditorTs).toContain('input.setAttribute("role", "switch")');
    expect(templateEditorTs).toContain(
      'track.setAttribute("aria-hidden", "true")'
    );
    expect(templateEditorTs).toContain('"toggle-switch"');
    expect(templateEditorTs).not.toContain("tpl-toggle");
    expect(templateAstro).not.toContain(".tpl-toggle");
  });
});
