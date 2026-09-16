// Phase G (Invoices/delivery) - versioned invoice template configuration
// (spec Section 22, 30). Stored in invoice_templates.config (jsonb) and
// copied once, verbatim, into every generated invoice's templateSnapshot --
// see invoice-templates.ts (get/update) and generation.ts (snapshot
// capture).
//
// No arbitrary HTML: a template is a small, strongly typed document model
// (an ordered list of blocks, plus per-row presentation overrides), never a
// free-form HTML string. invoice-html.ts renders every text field through
// escapeHtml(), the same XSS boundary this app already uses everywhere else.
//
// V2 (this file) vs V1 (superseded): V1 only forced `line-items` to stay
// visible and allowed a row override to hide an actually-billed charge. V2
// makes four block types (meta/parties/line-items/payment) structurally
// mandatory -- exactly once, always visible, never deletable -- and removes
// row-level `visible` entirely, so a financially charged line can no longer
// disappear under any stored config, current or historical. `default-note`
// and `footer` become genuinely optional (zero or one), not just hideable.
// See normalizeConfigV1Draft/repairConfig below for how old data migrates.
import { z } from "astro/zod";
import { CURRENT_LABEL_SET_VERSION } from "./invoice-i18n";

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

// Structurally mandatory: exactly one of each, always visible, never
// deletable/duplicable. Enforced below in the invariant refine, and the
// editor (src/lib/ui/invoice-template-editor.ts) imports this same constant
// to hide the Show toggle for these types -- one source of truth, not a
// second hardcoded list in the client script.
export const MANDATORY_BLOCK_TYPES = [
  "meta",
  "parties",
  "line-items",
  "payment",
] as const;
export type MandatoryBlockType = (typeof MANDATORY_BLOCK_TYPES)[number];

// Genuinely optional: zero or one of each, visibility toggleable. Unlike
// V1, these may be entirely absent from `document.blocks` -- "optional"
// means may-not-exist, not just may-be-hidden.
export const OPTIONAL_BUILTIN_BLOCK_TYPES = ["default-note", "footer"] as const;
export type OptionalBuiltinBlockType =
  (typeof OPTIONAL_BUILTIN_BLOCK_TYPES)[number];

export const BUILTIN_BLOCK_TYPES = [
  ...MANDATORY_BLOCK_TYPES,
  ...OPTIONAL_BUILTIN_BLOCK_TYPES,
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
    // Optional translated copies of this custom block's own text -- LV
    // (`text` above) is canonical; EN/RU fall back to it when unset. Same
    // snapshot-at-generation-time mechanism as everything else here: once
    // copied into an invoice's templateSnapshot, a later edit to these
    // fields can never change that invoice's already-rendered content.
    textEn: z.string().max(5000).optional(),
    textRu: z.string().max(5000).optional(),
    emphasis: z.enum(["normal", "bold"]).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  }),
]);
export type InvoiceTemplateBlock = z.infer<typeof invoiceTemplateBlockSchema>;
export type InvoiceCustomTextBlock = Extract<
  InvoiceTemplateBlock,
  { type: "text" }
>;

// `visible` deliberately removed (V1 had it): a row that contributes to the
// invoice total must always render. Bold/spacing are harmless presentation
// and stay. Zod's default z.object() parsing silently strips unknown keys,
// so an old stored `{visible: false, bold: true}` override safely becomes
// `{bold: true}` on read -- no explicit migration code needed for this
// specific field.
const rowPresentationSchema = z.object({
  bold: z.boolean().optional(),
  spacingBefore: spacingSchema.optional(),
});
export type InvoiceRowPresentation = z.infer<typeof rowPresentationSchema>;

// Optional translated copies of an admin-configured template text field.
// LV lives on the existing top-level column/field (headerText, etc.); EN/RU
// are optional siblings here. Folding these into `config` (already a
// versioned jsonb blob that's already copied whole into templateSnapshot)
// needs zero new invoice_templates columns, unlike giving each of the 4
// existing text fields its own *_en/*_ru column pair.
const localizedTextSchema = z.object({
  en: z.string().max(1000).optional(),
  ru: z.string().max(1000).optional(),
});
const templateTextTranslationsSchema = z.object({
  headerText: localizedTextSchema.optional(),
  footerText: localizedTextSchema.optional(),
  paymentInstructions: localizedTextSchema.optional(),
  defaultNote: localizedTextSchema.optional(),
});
export type TemplateTextTranslations = z.infer<
  typeof templateTextTranslationsSchema
>;

// Structural shape only -- no cross-field invariants yet. Split out from
// invoiceTemplateConfigV2Schema below so the read path can validate shape,
// *repair* known-fixable invariant violations (missing/hidden mandatory
// block, duplicate ids), and only THEN check invariants -- a plain
// `.refine()` can reject data but can't repair it, so the two-pass split is
// required, not stylistic.
const invoiceTemplateConfigV2StructuralSchema = z.object({
  version: z.literal(2),
  document: z.object({
    blocks: z.array(invoiceTemplateBlockSchema).min(1).max(30),
  }),
  rowOverrides: z.record(z.string().max(100), rowPresentationSchema),
  textTranslations: templateTextTranslationsSchema.optional(),
});
type InvoiceTemplateConfigV2Draft = z.infer<
  typeof invoiceTemplateConfigV2StructuralSchema
>;

function checkConfigInvariants(config: InvoiceTemplateConfigV2Draft): boolean {
  const ids = config.document.blocks.map((b) => b.id);
  if (new Set(ids).size !== ids.length) return false;

  const builtinTypes = config.document.blocks
    .map((b) => b.type)
    .filter((type): type is BuiltinBlockType =>
      (BUILTIN_BLOCK_TYPES as readonly string[]).includes(type)
    );
  // Every builtin type (mandatory or optional) may appear at most once.
  if (new Set(builtinTypes).size !== builtinTypes.length) return false;
  // Every mandatory type must appear exactly once (implied by "at most
  // once" above plus "at least once" here) and stay visible.
  for (const type of MANDATORY_BLOCK_TYPES) {
    const block = config.document.blocks.find((b) => b.type === type);
    if (!block || !block.visible) return false;
  }
  return true;
}

// Every mandatory section must appear exactly once and stay visible;
// optional builtin sections (default-note, footer) may appear at most once;
// block ids must be unique. Enforced here so both the lenient read-path
// repair below and the strict write-path rejection agree on the same
// invariant instead of two hand-maintained checks.
export const invoiceTemplateConfigV2Schema =
  invoiceTemplateConfigV2StructuralSchema.refine(checkConfigInvariants, {
    message:
      "Invalid invoice layout: Invoice details, Sender and recipient, Charges table, and Payment details must each appear exactly once and stay visible; other sections may appear at most once; block ids must be unique",
  });
export type InvoiceTemplateConfigV2 = z.infer<
  typeof invoiceTemplateConfigV2Schema
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

export function createDefaultInvoiceTemplateConfig(): InvoiceTemplateConfigV2 {
  return {
    version: 2,
    document: { blocks: DEFAULT_BLOCKS.map((block) => ({ ...block })) },
    rowOverrides: {},
  };
}

// Repairs the specific invariant violations a V1->V2 migration or corrupted
// jsonb can produce, rather than rejecting the whole config to default the
// moment any single thing is wrong -- an org that once toggled
// `payment.visible = false` (valid under V1) must not lose its custom block
// order/text/row overrides just because that one flag is no longer legal.
// Only truly irreparable shapes (e.g. an id collision the repair itself
// can't resolve) return null, and the caller falls back to the full
// default in that case.
function repairConfig(
  draft: InvoiceTemplateConfigV2Draft
): InvoiceTemplateConfigV2Draft | null {
  let blocks = [...draft.document.blocks];

  // 1. Drop duplicate occurrences of any builtin type, keeping the first.
  //    Custom "text" blocks are never deduplicated by type.
  const seenTypes = new Set<string>();
  blocks = blocks.filter((b) => {
    if (b.type === "text") return true;
    if (seenTypes.has(b.type)) return false;
    seenTypes.add(b.type);
    return true;
  });

  // 2. Drop duplicate ids, keeping the first occurrence.
  const seenIds = new Set<string>();
  blocks = blocks.filter((b) => {
    if (seenIds.has(b.id)) return false;
    seenIds.add(b.id);
    return true;
  });

  // 3. Force every mandatory block visible.
  blocks = blocks.map((b) =>
    (MANDATORY_BLOCK_TYPES as readonly string[]).includes(b.type)
      ? { ...b, visible: true }
      : b
  );

  // 4. Insert any missing mandatory block at a deterministic position
  //    (appended in canonical order) -- e.g. a config saved before
  //    `payment` became mandatory simply never had that entry.
  for (const type of MANDATORY_BLOCK_TYPES) {
    if (!blocks.some((b) => b.type === type)) {
      const fallback = DEFAULT_BLOCKS.find((b) => b.type === type);
      if (!fallback) return null;
      if (blocks.some((b) => b.id === fallback.id)) return null;
      blocks.push({ ...fallback });
    }
  }

  const finalIds = blocks.map((b) => b.id);
  if (new Set(finalIds).size !== finalIds.length) return null;

  return {
    ...draft,
    document: { blocks },
    // rowOverrides' obsolete `visible` key is already stripped by the
    // structural schema parse that produced `draft` in the first place
    // (Zod strips unknown keys by default) -- nothing left to do here.
    rowOverrides: draft.rowOverrides,
  };
}

// A stored `version: 1` config (pre-mandatory-payment, pre-translations,
// still allowing row visibility) decodes into a V2 draft by relabeling the
// version and reusing the same block/row shapes -- V1's block fields are a
// subset of V2's, and rowOverrides' obsolete `visible` key is dropped
// automatically by the V2 structural schema's parse (unknown keys are
// stripped, never an explicit migration step). This keeps exactly one read
// path for both versions instead of two.
function coerceToV2Draft(value: unknown): unknown | null {
  if (!value || typeof value !== "object") return null;
  const version = (value as { version?: unknown }).version;
  if (version === 1) return { ...(value as object), version: 2 };
  if (version === 2) return value;
  return null;
}

// Lenient: used when READING a config back (from invoice_templates.config,
// or from an invoice's frozen templateSnapshot) -- malformed JSON, a V1
// document, or a fixable invariant violation are all repaired or fall back
// to the default config rather than throwing, since a stored value the app
// itself wrote (or an old invoice's snapshot) must never crash a render.
export function parseInvoiceTemplateConfig(
  value: unknown
): InvoiceTemplateConfigV2 {
  const draft = coerceToV2Draft(value);
  if (draft === null) return createDefaultInvoiceTemplateConfig();

  const structural = invoiceTemplateConfigV2StructuralSchema.safeParse(draft);
  if (!structural.success) return createDefaultInvoiceTemplateConfig();

  const repaired = repairConfig(structural.data);
  if (repaired === null) return createDefaultInvoiceTemplateConfig();

  const final = invoiceTemplateConfigV2Schema.safeParse(repaired);
  return final.success ? final.data : createDefaultInvoiceTemplateConfig();
}

// Strict validation on write (unlike parseInvoiceTemplateConfig's lenient
// read-path repair/V1-migration): this is the admin's own just-edited
// config -- the editor always sends a current-version payload -- so a
// malformed OR stale-version payload should come back as a clear error,
// not be silently coerced/repaired. Deliberately does NOT call
// coerceToV2Draft (that's a read-path concern only): a hand-crafted V1
// payload posted directly to the action must be rejected, not silently
// upgraded.
export function validateInvoiceTemplateConfig(value: unknown) {
  return invoiceTemplateConfigV2Schema.safeParse(value);
}

const nullableTextSchema = (max: number) => z.string().max(max).nullable();

function safeNullableText(value: unknown, max: number): string | null {
  const result = nullableTextSchema(max).safeParse(value);
  return result.success ? result.data : null;
}

// Full shape for a *frozen* snapshot read back off an invoice row --
// version 2 adds labelSetVersion, defaulted so every caller gets a complete
// object regardless of how old the underlying data is. Translated copies of
// the 4 admin-configured text fields live inside `config.textTranslations`
// (folded into the already-versioned config jsonb, not new top-level
// columns/fields -- see templateTextTranslationsSchema above). `config` is
// always run through the same repair pipeline as the live template, which
// is what lets "a real charge can never disappear" hold for historical
// invoices too, not just newly generated ones.
export interface InvoiceTemplateSnapshotV2 {
  version: 2;
  headerText: string | null;
  footerText: string | null;
  paymentInstructions: string | null;
  defaultNote: string | null;
  labelSetVersion: number;
  config: InvoiceTemplateConfigV2;
}

export function normalizeInvoiceTemplateSnapshot(
  raw: unknown
): InvoiceTemplateSnapshotV2 {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    version: 2,
    headerText: safeNullableText(obj.headerText, 500),
    footerText: safeNullableText(obj.footerText, 1000),
    paymentInstructions: safeNullableText(obj.paymentInstructions, 1000),
    defaultNote: safeNullableText(obj.defaultNote, 1000),
    labelSetVersion:
      typeof obj.labelSetVersion === "number"
        ? obj.labelSetVersion
        : CURRENT_LABEL_SET_VERSION,
    config: parseInvoiceTemplateConfig(obj.config),
  };
}

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
): InvoiceTemplateSnapshotV2 {
  return normalizeInvoiceTemplateSnapshot(template ?? {});
}
