# 0004 - Invoice template mandatory sections, tariff/template synchronization, multilingual invoice documents, and SEPA QR payment codes

**Status:** Accepted
**Phase:** F (Billing) / G (Invoices/delivery)

## Context

The invoice template editor (ADR-adjacent feature, not itself a prior ADR) shipped with a V1 schema that had three problems once used in practice:

1. **No tariff/template synchronization guarantee.** The editor's preview and the schema had no explicit relationship to `getEffectiveRules()` -- the exact resolver `generateInvoice()` uses -- creating the risk of a second, drifting "which tariffs are active" concept, and of a stale/hardcoded preview that never reflected a newly-activated tariff.
2. **No true mandatory-section guarantee.** Every block, including `line-items`, had a `visible` flag; a schema check required `line-items` to be present and visible, but row-level overrides also had their own `visible` flag with no equivalent protection, so a financially charged row could be hidden by stored configuration with no server-side invariant preventing it.
3. **No localization model.** The invoice document was always rendered in English regardless of the organization's own locale (`lv` by default for this Latvia-focused product), tariff names had no translation concept, and there was no path to a Latvian-canonical/English-Russian-optional invoice document model or a SEPA payment QR code, both of which the product needs.

Fixing all three required touching the same schema, the same renderer, and the same editor simultaneously, so they were designed and implemented together as one connected effort (internally decomposed into five work packages: schema/domain foundation, tariff/template sync, multilingual renderer, SEPA QR, and invoice language-copy UX), each independently reviewed before the next began.

## Decision

### 1. Mandatory vs. optional blocks, enforced in the schema and the renderer

`InvoiceTemplateConfigV1` became `InvoiceTemplateConfigV2`. `MANDATORY_BLOCK_TYPES` (`meta`, `parties`, `line-items`, `payment`) must each appear exactly once with `visible: true`; `OPTIONAL_BUILTIN_BLOCK_TYPES` (`default-note`, `footer`) may appear at most once and may be entirely absent. The row-override schema's `visible` field was removed entirely (not deprecated, not hidden behind a flag) -- a financially charged row cannot be hidden by any stored configuration, in the type system or at render time, because the code path that would check it no longer exists.

A malformed, legacy V1-shaped, or hand-edited stored config is **repaired**, not rejected outright: dedupe duplicate blocks, force every mandatory block's `visible` back to `true`, insert any entirely-missing mandatory block from the default layout, then re-validate; only if repair itself cannot produce a valid document does the reader fall back to the full default configuration. This is what lets a pre-feature invoice's `{}` snapshot, or a hand-crafted config that once hid a row via the old `visible` flag, still render correctly today with no separate legacy-handling branch.

### 2. Tariff/template synchronization has exactly one source of truth

The editor's live preview builds its illustrative charge rows from `getEffectiveRules()` -- the identical resolver `generateInvoice()` calls -- via a new, presentation-only `invoice-template-preview.ts` module. There is no second "which tariffs count as active" concept: a newly-activated tariff appears in the preview automatically, and a disabled/archived/foreign-organization tariff never does, because both the preview and real generation query the same function. The preview quantity is a fixed illustrative `"1"` rather than inventing a per-dwelling number, but reuses the exact same `decimal2.ts` rounding/VAT primitives `generateInvoice()` itself calls, so the preview is honest about being illustrative without duplicating financial-calculation logic.

### 3. Invoice document localization: Latvian canonical, English/Russian optional derived copies

Three independent translation surfaces, each following the same Latvian-required/English-Russian-optional/Latvian-fallback model, and each captured into the frozen invoice/line snapshot at generation time so a later edit never changes a historical invoice:

- **System-generated labels** ("Invoice", "Amount due", etc.): a frozen, versioned dictionary (`invoice-i18n.ts`), pinned per invoice via a `labelSetVersion` stamped into the snapshot.
- **Tariff labels**: two new nullable columns, `billing_rules.name_en`/`name_ru` (the only new database columns this effort required -- `name` remains the Latvian canonical value with no data migration). Because the whole `billing_rules` row is already snapshotted onto every invoice line's `source_snapshot`, translated labels are frozen into invoice history automatically, with no new snapshot plumbing.
- **Configurable template text** (header/footer/payment instructions/default note/custom text blocks): folded into the existing `invoice_templates.config` jsonb as `config.textTranslations` and each custom block's `textEn`/`textRu` -- zero new database columns, since this rides the config's existing versioned-snapshot mechanism for free.

`renderInvoiceHtml(invoice, lines, locale)` takes an explicit `InvoiceLocale` (default `"lv"`) and sets `<html lang>` accordingly. This is an intentional, disclosed behavior change for four existing callers (the canonical PDF, the public token page, and the admin/resident views), which previously hardcoded `lang="en"` regardless of the organization's actual language -- they now default to Latvian, matching the product's actual target market, rather than being a no-op.

### 4. English/Russian PDF copies are rendered on demand, never persisted

There is exactly one persisted PDF artifact per invoice: the canonical Latvian PDF (`invoices.pdf_object_key`/`pdf_sha256`), generated once on first send and never regenerated. An English or Russian PDF download re-renders the same invoice/lines through the same `renderPdf()` Cloudflare Browser Rendering call, on every request, and is never uploaded to storage or written to the database. This was chosen over persisting a second artifact per language because it keeps the data model unchanged (no new storage keys, no new "which language is this stored PDF" bookkeeping, no risk of a stored translated copy silently going stale relative to a later-corrected translation) at the cost of a repeated render per download -- judged the right trade-off for a translated copy that is, by definition, secondary to the canonical document.

### 5. SEPA QR payment codes

A new `src/domain/billing/sepa-qr.ts` module builds an EPC069-12 v3.1 payload from the exact same snapshot fields the adjacent human-readable payment text already prints (issuer name as beneficiary, `payment_snapshot.iban`/`bic`, `invoice.amount_due`, `invoice.invoice_number`) -- there is no second, independently editable "QR data" source. The remittance reference is always the Latvian `Rēķins {invoiceNumber}`, identical across every language copy, never truncated. A strict builder throws on any invalid input (non-EUR currency, missing/invalid BIC or IBAN, zero/out-of-range amount, oversized fields); a non-throwing wrapper used by the actual renderer catches every failure -- including a QR-library-internal failure, not just payload validation -- and simply omits the QR, so `renderInvoiceHtml` can never throw because of QR generation. QR image generation uses the `qrcode-generator` npm package (chosen as an already-well-scoped, zero-dependency, actively-maintained library over hand-rolling a QR encoder), with its default byte-encoder overridden to real UTF-8 (its own default silently mangles non-ASCII text, which would corrupt every Latvian diacritic in the payload despite the payload declaring UTF-8).

## Consequences

### Benefits

- A financially charged row or a mandatory section can no longer disappear via any stored template configuration -- enforced by the type system and the renderer, not just a UI convention.
- Tariff activation has exactly one implementation; the editor preview cannot drift from real invoice generation.
- Historical invoices are provably unaffected by later tariff renames, template text edits, or label-dictionary wording fixes, because every translatable value is captured into the frozen snapshot at generation time, the same way every other financial field already was.
- Adding SEPA QR and invoice-language-copy support required exactly two new database columns (`billing_rules.name_en`/`name_ru`); every other addition rode an existing versioned-snapshot mechanism.

### Trade-offs & Boundaries

- English/Russian PDF downloads are re-rendered on every request rather than cached, trading a small repeated Browser Rendering cost for a simpler, single-persisted-artifact data model (see docs/KNOWN_LIMITATIONS.md).
- The SEPA QR's BIC-required and IBAN-country-registry checks are deliberate simplifications of the full EPC069-12 EEA-domestic-optional-BIC determination and worldwide IBAN registry, scoped to what this app's actual organizations would realistically use (see docs/KNOWN_LIMITATIONS.md).
- No React or other component framework was introduced; the editor's document-language selector, tariff-sync preview, and locale-aware live preview are all built with the existing Astro SSR + vanilla TypeScript + SortableJS architecture.
