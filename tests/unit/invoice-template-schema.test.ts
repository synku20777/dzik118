import { describe, expect, it } from "vitest";
import {
  buildInvoiceTemplateSnapshot,
  normalizeInvoiceTemplateSnapshot,
  createDefaultInvoiceTemplateConfig,
  invoiceTemplateConfigV2Schema,
  parseInvoiceTemplateConfig,
  validateInvoiceTemplateConfig,
} from "../../src/domain/billing/invoice-template-schema";

describe("createDefaultInvoiceTemplateConfig", () => {
  it("returns a valid V2 config with every built-in block visible", () => {
    const config = createDefaultInvoiceTemplateConfig();
    expect(invoiceTemplateConfigV2Schema.safeParse(config).success).toBe(true);
    expect(config.version).toBe(2);
    expect(config.document.blocks.every((b) => b.visible)).toBe(true);
    expect(config.document.blocks.map((b) => b.type)).toEqual([
      "meta",
      "parties",
      "line-items",
      "payment",
      "default-note",
      "footer",
    ]);
  });

  it("returns a fresh object each call so callers can't mutate the shared default", () => {
    const a = createDefaultInvoiceTemplateConfig();
    a.document.blocks[0].visible = false;
    const b = createDefaultInvoiceTemplateConfig();
    expect(b.document.blocks[0].visible).toBe(true);
  });
});

describe("parseInvoiceTemplateConfig - malformed/unknown input", () => {
  it("falls back to the default config for malformed input", () => {
    expect(parseInvoiceTemplateConfig({ not: "a config" })).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
    expect(parseInvoiceTemplateConfig(null)).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
    expect(parseInvoiceTemplateConfig("garbage")).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
  });

  it("falls back to the default config for an unknown/future version", () => {
    const config = createDefaultInvoiceTemplateConfig();
    expect(parseInvoiceTemplateConfig({ ...config, version: 3 })).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
  });
});

describe("parseInvoiceTemplateConfig - V1 -> V2 migration", () => {
  it("coerces a stored V1 config into V2 rather than discarding it", () => {
    const v1 = {
      version: 1,
      document: {
        blocks: [
          { id: "invoice-meta", type: "meta", visible: true },
          { id: "invoice-parties", type: "parties", visible: true },
          { id: "invoice-line-items", type: "line-items", visible: true },
          { id: "invoice-payment", type: "payment", visible: true },
          { id: "invoice-default-note", type: "default-note", visible: true },
          { id: "invoice-footer", type: "footer", visible: true },
          { id: "custom-1", type: "text", visible: true, text: "Thanks!" },
        ],
      },
      rowOverrides: { water: { visible: false, bold: true } },
    };
    const result = parseInvoiceTemplateConfig(v1);
    expect(result.version).toBe(2);
    // The custom block and its position/content survive the migration --
    // this is not a reject-to-default fallback.
    expect(result.document.blocks.map((b) => b.id)).toContain("custom-1");
    // The obsolete `visible` key on the row override is stripped, not
    // rejected; `bold` survives.
    expect(result.rowOverrides.water).toEqual({ bold: true });
  });
});

describe("parseInvoiceTemplateConfig - mandatory-block repair (not reject-to-default)", () => {
  it("repairs a hidden mandatory block to visible while preserving custom blocks and order", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks.push({
      id: "custom-1",
      type: "text",
      visible: true,
      text: "Thank you",
    });
    config.document.blocks = config.document.blocks.map((b) =>
      b.type === "payment" ? { ...b, visible: false } : b
    );
    const result = parseInvoiceTemplateConfig(config);
    const payment = result.document.blocks.find((b) => b.type === "payment");
    expect(payment?.visible).toBe(true);
    expect(result.document.blocks.map((b) => b.id)).toContain("custom-1");
    expect(result.document.blocks).toHaveLength(7);
  });

  it("inserts a missing mandatory block (e.g. a config saved before `payment` became mandatory) rather than discarding the rest", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks = config.document.blocks.filter(
      (b) => b.type !== "payment"
    );
    config.document.blocks.push({
      id: "custom-1",
      type: "text",
      visible: true,
      text: "Kept",
    });
    const result = parseInvoiceTemplateConfig(config);
    expect(result.document.blocks.some((b) => b.type === "payment")).toBe(true);
    expect(result.document.blocks.map((b) => b.id)).toContain("custom-1");
  });

  it("deduplicates a repeated mandatory block type, keeping the first occurrence", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks.push({
      id: "invoice-line-items-2",
      type: "line-items",
      visible: true,
    });
    const result = parseInvoiceTemplateConfig(config);
    expect(
      result.document.blocks.filter((b) => b.type === "line-items")
    ).toHaveLength(1);
  });

  it("deduplicates blocks sharing the same id, keeping the first occurrence", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks.push({
      id: "invoice-meta",
      type: "text",
      visible: true,
      text: "duplicate id",
    });
    const result = parseInvoiceTemplateConfig(config);
    const ids = result.document.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.document.blocks.some((b) => b.type === "text")).toBe(false);
  });
});

describe("parseInvoiceTemplateConfig - optional builtin blocks", () => {
  it("accepts a config missing default-note and footer entirely (genuinely optional, not just hideable)", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks = config.document.blocks.filter(
      (b) => b.type !== "default-note" && b.type !== "footer"
    );
    const result = parseInvoiceTemplateConfig(config);
    expect(result.document.blocks.some((b) => b.type === "default-note")).toBe(
      false
    );
    expect(result.document.blocks.some((b) => b.type === "footer")).toBe(false);
  });

  it("accepts a valid config with a custom text block and row overrides", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks.push({
      id: "custom-1",
      type: "text",
      visible: true,
      text: "hello",
    });
    config.rowOverrides.water = { bold: true };
    expect(parseInvoiceTemplateConfig(config)).toEqual(config);
  });
});

describe("validateInvoiceTemplateConfig - strict write path", () => {
  it("rejects (does not silently repair) a config missing a mandatory block", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks = config.document.blocks.filter(
      (b) => b.type !== "payment"
    );
    expect(validateInvoiceTemplateConfig(config).success).toBe(false);
  });

  it("accepts a valid config", () => {
    expect(
      validateInvoiceTemplateConfig(createDefaultInvoiceTemplateConfig())
        .success
    ).toBe(true);
  });

  it("rejects a V1-shaped payload instead of silently upgrading it (unlike the lenient read path)", () => {
    const v1 = {
      version: 1,
      document: createDefaultInvoiceTemplateConfig().document,
      rowOverrides: {},
    };
    expect(validateInvoiceTemplateConfig(v1).success).toBe(false);
  });
});

describe("buildInvoiceTemplateSnapshot", () => {
  it("builds a complete, versioned snapshot from a stored template row", () => {
    const snapshot = buildInvoiceTemplateSnapshot({
      headerText: "Header",
      footerText: "Footer",
      paymentInstructions: "Pay now",
      defaultNote: "Note",
      config: createDefaultInvoiceTemplateConfig(),
    });
    expect(snapshot).toEqual({
      version: 2,
      headerText: "Header",
      footerText: "Footer",
      paymentInstructions: "Pay now",
      defaultNote: "Note",
      labelSetVersion: 2,
      config: createDefaultInvoiceTemplateConfig(),
    });
  });

  it("builds a complete default snapshot when no template row exists yet", () => {
    const snapshot = buildInvoiceTemplateSnapshot(null);
    expect(snapshot).toEqual({
      version: 2,
      headerText: null,
      footerText: null,
      paymentInstructions: null,
      defaultNote: null,
      labelSetVersion: 2,
      config: createDefaultInvoiceTemplateConfig(),
    });
  });

  it("treats a stored snapshot with no labelSetVersion as label set 1, but stamps new ones with the current set", () => {
    expect(normalizeInvoiceTemplateSnapshot({}).labelSetVersion).toBe(1);
    expect(buildInvoiceTemplateSnapshot(null).labelSetVersion).toBe(2);
  });
});
