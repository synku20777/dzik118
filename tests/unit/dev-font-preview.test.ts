import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDevFontPreview } from "../../src/lib/ui/dev-font-preview";

const root = resolve(import.meta.dirname, "../..");

describe("dev font preview parity", () => {
  it("defaults to Switzer (null preview) in dev when opt-in flag is absent or non-medeo", () => {
    expect(resolveDevFontPreview(true, undefined)).toBeNull();
    expect(resolveDevFontPreview(true, "")).toBeNull();
    expect(resolveDevFontPreview(true, "switzer")).toBeNull();
    expect(resolveDevFontPreview(true, "true")).toBeNull();
  });

  it("loads Medeo Sans only in dev when explicitly opted in", () => {
    expect(resolveDevFontPreview(true, "medeo")).toEqual({
      regular: "/src/fonts/MedeoSansVariable.woff2",
      italic: "/src/fonts/MedeoSansVariable-Italic.woff2",
    });
    expect(resolveDevFontPreview(true, " MEDEO ")).toEqual({
      regular: "/src/fonts/MedeoSansVariable.woff2",
      italic: "/src/fonts/MedeoSansVariable-Italic.woff2",
    });
  });

  it("never activates in production even when the flag is set", () => {
    expect(resolveDevFontPreview(false, "medeo")).toBeNull();
  });

  it("gates AdminLayout font preview on Astro's compile-time dev command and PUBLIC_FONT_PREVIEW", () => {
    const astroConfig = readFileSync(resolve(root, "astro.config.ts"), "utf8");
    expect(astroConfig).toMatch(/"astro:config:setup"/);
    expect(astroConfig).toMatch(
      /__ASTRO_DEV_SERVER__:\s*JSON\.stringify\(command === "dev"\)/
    );

    const adminLayout = readFileSync(
      resolve(root, "src/layouts/AdminLayout.astro"),
      "utf8"
    );
    expect(adminLayout).toContain("resolveDevFontPreview");
    expect(adminLayout).toContain("__ASTRO_DEV_SERVER__");
    expect(adminLayout).toContain("import.meta.env.PUBLIC_FONT_PREVIEW");
    expect(adminLayout).not.toContain("import.meta.env.DEV");
    expect(adminLayout).not.toContain("MedeoSansVariable");

    const authLayout = readFileSync(
      resolve(root, "src/layouts/AuthLayout.astro"),
      "utf8"
    );
    const residentLayout = readFileSync(
      resolve(root, "src/layouts/ResidentLayout.astro"),
      "utf8"
    );
    expect(authLayout).not.toMatch(/DevFontPreview|Medeo/);
    expect(residentLayout).not.toMatch(/DevFontPreview|Medeo/);
  });
});
