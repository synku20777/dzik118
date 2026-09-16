import { describe, expect, it } from "vitest";
import {
  buildInvoiceTemplateSnapshot,
  createDefaultInvoiceTemplateConfig,
  invoiceTemplateConfigV1Schema,
  parseInvoiceTemplateConfig,
} from "../../src/domain/billing/invoice-template-schema";

describe("createDefaultInvoiceTemplateConfig", () => {
  it("returns a valid V1 config with every built-in block visible", () => {
    const config = createDefaultInvoiceTemplateConfig();
    expect(invoiceTemplateConfigV1Schema.safeParse(config).success).toBe(true);
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

describe("parseInvoiceTemplateConfig", () => {
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
    expect(parseInvoiceTemplateConfig({ ...config, version: 2 })).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
  });

  it("falls back to the default config when the line-items block is hidden", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks = config.document.blocks.map((b) =>
      b.type === "line-items" ? { ...b, visible: false } : b
    );
    expect(parseInvoiceTemplateConfig(config)).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
  });

  it("accepts a valid config with a custom text block and row overrides", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks.push({
      id: "custom-1",
      type: "text",
      visible: true,
      text: "hello",
    });
    config.rowOverrides.water = { visible: false, bold: true };
    expect(parseInvoiceTemplateConfig(config)).toEqual(config);
  });

  it("falls back to the default config when the line-items block is missing entirely", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks = config.document.blocks.filter(
      (b) => b.type !== "line-items"
    );
    expect(parseInvoiceTemplateConfig(config)).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
  });

  it("falls back to the default config when a built-in block type is duplicated", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks.push({
      id: "invoice-line-items-2",
      type: "line-items",
      visible: true,
    });
    expect(parseInvoiceTemplateConfig(config)).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
  });

  it("falls back to the default config when two blocks share the same id", () => {
    const config = createDefaultInvoiceTemplateConfig();
    config.document.blocks.push({
      id: "invoice-meta",
      type: "text",
      visible: true,
      text: "duplicate id",
    });
    expect(parseInvoiceTemplateConfig(config)).toEqual(
      createDefaultInvoiceTemplateConfig()
    );
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
      version: 1,
      headerText: "Header",
      footerText: "Footer",
      paymentInstructions: "Pay now",
      defaultNote: "Note",
      config: createDefaultInvoiceTemplateConfig(),
    });
  });

  it("builds a complete default snapshot when no template row exists yet", () => {
    const snapshot = buildInvoiceTemplateSnapshot(null);
    expect(snapshot).toEqual({
      version: 1,
      headerText: null,
      footerText: null,
      paymentInstructions: null,
      defaultNote: null,
      config: createDefaultInvoiceTemplateConfig(),
    });
  });
});
