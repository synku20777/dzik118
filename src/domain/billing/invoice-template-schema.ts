// Phase G (Invoices/delivery) - versioned invoice template configuration
// (spec Section 22). Stored in invoice_templates.config (jsonb) and copied
// once, verbatim, into every generated invoice's templateSnapshot -- see
// invoice-templates.ts (get/update) and generation.ts (snapshot capture).
//
// No arbitrary HTML: a template is a small, strongly typed document model
// (an ordered list of blocks, plus per-row presentation overrides), never a
// free-form HTML string. invoice-html.ts renders every text field through
// escapeHtml(), the same XSS boundary this app already uses everywhere else.
import { z } from "astro/zod";

export const SPACING_VALUES = [0, 1, 2, 3, 4] as const;
export type SpacingValue = (typeof SPACING_VALUES)[number];

// Single source of truth for spacing -> CSS, consumed by both the PDF/HTML
// renderer and the editor's live preview -- never let a client invent a raw
// pixel value.
export const SPACING_CSS: Record<SpacingValue, string> = {
  0: "0",
  1: "0.375rem",
  2: "0.75rem",
  3: "1.125rem",
  4: "1.5rem",
};

const spacingSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const presentationSchema = z.object({
  spacingBefore: spacingSchema.optional(),
});

const baseBlockFields = {
  id: z.string().min(1).max(100),
  visible: z.boolean(),
  presentation: presentationSchema.optional(),
  // Editor-only display label (e.g. renaming "Charges table" to something
  // org-specific in the block list). Deliberately never read by
  // invoice-html.ts -- none of today's rendered blocks print a section
  // heading at all, so this has no effect on the actual invoice, only on
  // how the block appears in the settings editor's own block list.
  title: z.string().max(100).optional(),
};

export const BUILTIN_BLOCK_TYPES = [
  "meta",
  "parties",
  "line-items",
  "payment",
  "default-note",
  "footer",
] as const;
export type BuiltinBlockType = (typeof BUILTIN_BLOCK_TYPES)[number];

const invoiceTemplateBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...baseBlockFields, type: z.literal("meta") }),
  z.object({ ...baseBlockFields, type: z.literal("parties") }),
  z.object({ ...baseBlockFields, type: z.literal("line-items") }),
  z.object({ ...baseBlockFields, type: z.literal("payment") }),
  z.object({ ...baseBlockFields, type: z.literal("default-note") }),
  z.object({ ...baseBlockFields, type: z.literal("footer") }),
  z.object({
    ...baseBlockFields,
    type: z.literal("text"),
    text: z.string().max(5000),
    emphasis: z.enum(["normal", "bold"]).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  }),
]);
export type InvoiceTemplateBlock = z.infer<typeof invoiceTemplateBlockSchema>;
export type InvoiceCustomTextBlock = Extract<
  InvoiceTemplateBlock,
  { type: "text" }
>;

const rowPresentationSchema = z.object({
  visible: z.boolean().optional(),
  bold: z.boolean().optional(),
  spacingBefore: spacingSchema.optional(),
});
export type InvoiceRowPresentation = z.infer<typeof rowPresentationSchema>;

// Every built-in section must appear exactly once (a block is hidden via
// `visible: false`, never by omitting it), block ids must be unique (the
// editor keys drag/move/duplicate/delete off `id`), and the line-items
// table can never be hidden or duplicated -- a partial invoice with no
// charges shown, or one that prints its totals twice, would misrepresent
// what's owed. Enforced here so both the lenient read-path fallback and the
// strict write-path rejection agree on the same invariant instead of two
// hand-maintained checks.
export const invoiceTemplateConfigV1Schema = z
  .object({
    version: z.literal(1),
    document: z.object({
      blocks: z.array(invoiceTemplateBlockSchema).min(1).max(30),
    }),
    rowOverrides: z.record(z.string().max(100), rowPresentationSchema),
  })
  .refine(
    (config) => {
      const ids = config.document.blocks.map((b) => b.id);
      if (new Set(ids).size !== ids.length) return false;

      const builtinTypes = config.document.blocks
        .map((b) => b.type)
        .filter((type): type is BuiltinBlockType =>
          (BUILTIN_BLOCK_TYPES as readonly string[]).includes(type)
        );
      if (new Set(builtinTypes).size !== builtinTypes.length) return false;
      if (!BUILTIN_BLOCK_TYPES.every((type) => builtinTypes.includes(type)))
        return false;

      const lineItems = config.document.blocks.find(
        (b) => b.type === "line-items"
      );
      return !!lineItems && lineItems.visible;
    },
    {
      message:
        "Invalid invoice layout: every section must appear exactly once, block ids must be unique, and the line items table must stay visible",
    }
  );
export type InvoiceTemplateConfigV1 = z.infer<
  typeof invoiceTemplateConfigV1Schema
>;

const DEFAULT_BLOCKS: ReadonlyArray<
  Extract<InvoiceTemplateBlock, { type: BuiltinBlockType }>
> = [
  { id: "invoice-meta", type: "meta", visible: true },
  { id: "invoice-parties", type: "parties", visible: true },
  { id: "invoice-line-items", type: "line-items", visible: true },
  { id: "invoice-payment", type: "payment", visible: true },
  { id: "invoice-default-note", type: "default-note", visible: true },
  { id: "invoice-footer", type: "footer", visible: true },
];

export function createDefaultInvoiceTemplateConfig(): InvoiceTemplateConfigV1 {
  return {
    version: 1,
    document: { blocks: DEFAULT_BLOCKS.map((block) => ({ ...block })) },
    rowOverrides: {},
  };
}

// Lenient: used when READING a config back (from invoice_templates.config,
// or from an invoice's frozen templateSnapshot) -- malformed JSON, a future
// schema version, or a violated invariant all fall back to the default
// config rather than throwing, since a stored value the app itself wrote
// (or an old invoice's snapshot) must never crash a render.
export function parseInvoiceTemplateConfig(
  value: unknown
): InvoiceTemplateConfigV1 {
  const result = invoiceTemplateConfigV1Schema.safeParse(value);
  return result.success ? result.data : createDefaultInvoiceTemplateConfig();
}

// Same length caps as the action's write-path input (src/actions/
// invoice-templates.ts) -- a corrupted/hand-edited snapshot with a
// multi-megabyte text field must fall back to the legacy layout, not be
// trusted straight into HTML/PDF rendering.
const nullableTextSchema = (max: number) => z.string().max(max).nullable();

// Full validation for a *frozen* snapshot read back off an invoice row --
// deliberately stricter than parseInvoiceTemplateConfig's bare `"config" in
// value` duck-type check used to be. A snapshot's config must satisfy every
// rule in invoiceTemplateConfigV1Schema (known block types, valid `align`/
// `emphasis` enums, unique ids, line-items present and visible, etc.), not
// just superficially look like an object with a `config` key -- otherwise a
// corrupted/hand-edited jsonb value could carry an attacker-controlled
// `align` string straight into a rendered `style` attribute.
export const invoiceTemplateSnapshotV1Schema = z.object({
  version: z.literal(1),
  headerText: nullableTextSchema(500),
  footerText: nullableTextSchema(1000),
  paymentInstructions: nullableTextSchema(1000),
  defaultNote: nullableTextSchema(1000),
  config: invoiceTemplateConfigV1Schema,
});
export type InvoiceTemplateSnapshotV1 = z.infer<
  typeof invoiceTemplateSnapshotV1Schema
>;

// Built once at invoice-generation time (generation.ts) from whatever the
// organization's invoice_templates row currently says, then copied onto
// invoices.template_snapshot -- never a live join back to invoice_templates
// afterward (spec Section 21 immutability).
export function buildInvoiceTemplateSnapshot(
  template: {
    headerText: string | null;
    footerText: string | null;
    paymentInstructions: string | null;
    defaultNote: string | null;
    config: unknown;
  } | null
): InvoiceTemplateSnapshotV1 {
  return {
    version: 1,
    headerText: template?.headerText ?? null,
    footerText: template?.footerText ?? null,
    paymentInstructions: template?.paymentInstructions ?? null,
    defaultNote: template?.defaultNote ?? null,
    config: parseInvoiceTemplateConfig(template?.config),
  };
}
