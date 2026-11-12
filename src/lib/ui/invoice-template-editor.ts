// Invoice template editor (settings/invoice-template.astro). Vanilla
// TypeScript against the DOM, same convention as workbench-drawer.ts --
// this app has no React anywhere (confirmed: no @astrojs/react, nothing
// under src/ imports "react"), so the editor follows the existing pattern
// instead of introducing a framework. SortableJS handles drag reordering
// (mouse/touch) -- "Move up"/"Move down" buttons are the keyboard-
// accessible equivalent, since SortableJS itself has no built-in keyboard
// reordering.
//
// The live preview reuses renderInvoiceHtml() UNMODIFIED -- the exact same
// function that renders the real PDF/portal HTML. That function has no
// server-only runtime dependency (see invoice-html.ts's own header
// comment), so it bundles into this client script safely, and the preview
// can never drift from the real render: there is only one template
// implementation, not two.
//
// V1 simplification: only custom text blocks get bold/alignment controls.
// The four built-in text fields (header/footer/payment instructions/
// default note) render plainly, matching what invoice-html.ts actually
// reads today. Upgrade path if wanted: add the same emphasis/align fields
// to those block types in invoice-template-schema.ts and this file's
// per-block-type rendering.
//
// Each block also carries an optional `title` -- purely an editor-side
// display label (falls back to the block's default name when unset) so an
// admin can rename how a section appears in this block list. Never read by
// invoice-html.ts: none of today's rendered blocks print a section heading
// at all, so this has no effect on the actual invoice.
//
// Block list items are collapsible accordions (transient `expandedBlockIds`
// state, never persisted) -- line-item rows keep their drag handle purely
// decorative (no Sortable instance attached), since reordering individual
// charge rows is out of V1 scope. Each row's "..." button is a native
// <details>/<summary> popover (zero extra JS, keyboard accessible by
// default) holding that row's Spacing control.
import Sortable from "sortablejs";
import { actions } from "astro:actions";
import { onPageLoad } from "./page-lifecycle";
import {
  missingTranslationCount,
  textBlockName,
} from "./invoice-template-translations";
import {
  renderInvoiceHtml,
  rowPresentationKey,
  type InvoiceHtmlInvoice,
  type InvoiceHtmlLine,
} from "../../domain/billing/invoice-html";
import {
  createDefaultInvoiceTemplateConfig,
  MANDATORY_BLOCK_TYPES,
  SPACING_VALUES,
  type InvoiceTemplateBlock,
  type InvoiceTemplateConfigV2,
  type SpacingValue,
} from "../../domain/billing/invoice-template-schema";
import {
  CURRENT_LABEL_SET_VERSION,
  type InvoiceLocale,
} from "../../domain/billing/invoice-i18n";

// A field whose Latvian value is canonical/required and whose EN/RU values
// are optional translated copies -- one small interface lets a single
// localizedTextField() helper handle every translatable field (the 4
// built-in text fields below, plus a custom text block's own text)
// uniformly, rather than four near-duplicate render functions.
interface LocalizedField {
  getLv(): string;
  setLv(value: string): void;
  getTranslation(locale: "en" | "ru"): string | undefined;
  setTranslation(locale: "en" | "ru", value: string): void;
}

interface SampleRow {
  key: string;
  label: string;
}

interface EditorBootstrap {
  headerText: string;
  footerText: string;
  paymentInstructions: string;
  defaultNote: string;
  config: InvoiceTemplateConfigV2;
  sampleInvoice: InvoiceHtmlInvoice;
  sampleLines: InvoiceHtmlLine[];
  strings: Record<string, string>;
}

onPageLoad(() => {
  const root = document.querySelector<HTMLElement>("#template-editor");
  if (!root) return;
  const controller = new AbortController();
  const bootstrapEl = document.querySelector<HTMLScriptElement>(
    "#template-editor-bootstrap"
  );
  const bootstrap: EditorBootstrap = JSON.parse(
    bootstrapEl?.textContent ?? "{}"
  );
  const s = (key: string) => bootstrap.strings[key] ?? key;

  let sampleRows: SampleRow[] = bootstrap.sampleLines.map((line) => ({
    key: rowPresentationKey(line),
    label: line.description,
  }));

  const state = {
    headerText: bootstrap.headerText,
    footerText: bootstrap.footerText,
    paymentInstructions: bootstrap.paymentInstructions,
    defaultNote: bootstrap.defaultNote,
    config: bootstrap.config,
  };

  // Which blocks are expanded in the accordion -- purely local UI state,
  // never saved to the form/config.
  const expandedBlockIds = new Set<string>();

  // Which language the preview renders in AND which language's text the
  // translatable fields below show/edit -- the language tabs above both
  // columns drive both. Purely local UI state: switching it never mutates
  // saved data, only what's currently displayed.
  let editingLocale: InvoiceLocale = "lv";

  const form = document.querySelector<HTMLFormElement>(
    "#template-editor-form"
  )!;
  const blockListEl = root.querySelector<HTMLUListElement>("#tpl-blocks")!;
  const previewFrame = root.querySelector<HTMLIFrameElement>("#tpl-preview")!;
  const previewCanvas = root.querySelector<HTMLElement>(
    "#tpl-preview-container"
  )!;
  const previewZoomWrap = root.querySelector<HTMLElement>(
    "#tpl-preview-zoom-wrap"
  )!;
  // Plain querySelector + cast, not querySelector<HTMLSelectElement>: the
  // generic overload's `T extends Element` constraint fails to resolve for
  // HTMLSelectElement specifically under this project's workers-types/
  // lib.dom.d.ts collision (see the longer note further down this file).
  const zoomSelect = root.querySelector(
    "#tpl-zoom-select"
  ) as unknown as HTMLSelectElement;
  const periodSelect = root.querySelector(
    "#tpl-preview-period"
  ) as unknown as HTMLSelectElement | null;
  const periodError = root.querySelector<HTMLElement>("#tpl-period-error")!;
  const localeRadios = [
    ...root.querySelectorAll<HTMLInputElement>('input[name="tpl-locale"]'),
  ];
  const langHint = root.querySelector<HTMLElement>("#tpl-lang-hint")!;
  const missingBadges = {
    en: root.querySelector<HTMLElement>('[data-missing-for="en"]'),
    ru: root.querySelector<HTMLElement>('[data-missing-for="ru"]'),
  };
  const addTextButton = root.querySelector<HTMLButtonElement>("#tpl-add-text")!;
  const resetButton =
    root.querySelector<HTMLButtonElement>("#tpl-reset-layout")!;
  const statusEl = root.querySelector<HTMLElement>("#tpl-status")!;
  const saveBar = root.querySelector<HTMLElement>("#tpl-savebar")!;
  const saveBarText = root.querySelector<HTMLElement>("#tpl-savebar-text")!;
  const discardButton = root.querySelector<HTMLButtonElement>("#tpl-discard")!;
  const saveButton = root.querySelector<HTMLButtonElement>("#tpl-save")!;
  const organizationId = (
    form.elements.namedItem("organizationId") as HTMLInputElement
  ).value;
  const fill = (text: string, values: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (match, key) =>
      key in values ? String(values[key]) : match
    );
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  // --- Unsaved changes ---------------------------------------------------
  // "Dirty" is computed, not flagged: an edit that is changed back to the
  // saved value is no longer a change (the bar closes again).
  // For comparison only (never sent): an empty translation is the same as no
  // translation (Latvian is used), so typing one and deleting it again is not
  // a change.
  function withoutEmpty(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutEmpty);
    if (!value || typeof value !== "object") return value;
    const kept: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      const next = withoutEmpty(inner);
      const emptyObject =
        !!next &&
        typeof next === "object" &&
        !Array.isArray(next) &&
        Object.keys(next).length === 0;
      if (next !== "" && !emptyObject) kept[key] = next;
    }
    return kept;
  }
  const draft = () =>
    JSON.stringify(
      withoutEmpty([
        state.headerText,
        state.footerText,
        state.paymentInstructions,
        state.defaultNote,
        state.config,
      ])
    );
  let savedDraft = draft();
  let savedState = clone(state);
  const isDirty = () => draft() !== savedDraft;
  let saving = false;
  let saveFailed = false;
  let savedNotice = false;
  let savedNoticeTimer: ReturnType<typeof setTimeout> | undefined;

  function updateSaveBar() {
    const focused = saveBar.contains(document.activeElement)
      ? document.activeElement
      : null;
    const dirty = isDirty();
    const show = dirty || saving || saveFailed || savedNotice;
    saveBar.hidden = !show;
    saveBar.dataset.state = saveFailed
      ? "error"
      : saving
        ? "saving"
        : dirty
          ? "dirty"
          : "saved";
    saveBarText.textContent = saveFailed
      ? s("Could not save the template. Your changes are still here.")
      : saving
        ? s("Saving…")
        : dirty
          ? s("Unsaved changes")
          : s("Template saved.");
    // Once saved only the confirmation stays; Save and Discard have nothing
    // left to do.
    const idle = !dirty && !saving;
    saveButton.hidden = idle;
    discardButton.hidden = idle;
    discardButton.disabled = saving;
    // Keyboard focus must not be left on a button that just went away. Read
    // before hiding: once an element is hidden, activeElement already
    // reports the body.
    if (focused && (saveBar.hidden || (focused as HTMLButtonElement).hidden)) {
      addTextButton.focus();
    }
  }

  function markDirty() {
    saveFailed = false;
    savedNotice = false;
    clearTimeout(savedNoticeTimer);
    updateSaveBar();
    updateLanguageHints();
  }
  window.addEventListener(
    "beforeunload",
    (event) => {
      if (!isDirty()) return;
      event.preventDefault();
    },
    { signal: controller.signal }
  );

  // --- Language tabs -------------------------------------------------------
  // A count next to EN/RU: fields that have Latvian text but no translation
  // yet. Information only -- an empty translation falls back to Latvian.
  function updateLanguageHints() {
    const texts = {
      headerText: state.headerText,
      footerText: state.footerText,
      paymentInstructions: state.paymentInstructions,
      defaultNote: state.defaultNote,
      config: state.config,
    };
    for (const code of ["en", "ru"] as const) {
      const missing = missingTranslationCount(texts, code);
      const badge = missingBadges[code];
      if (!badge) continue;
      badge.hidden = missing === 0;
      badge.textContent = String(missing);
      badge.setAttribute(
        "aria-label",
        fill(s("Without translation: {n}"), { n: missing })
      );
    }
    if (editingLocale === "lv") {
      langHint.textContent = s("Latvian is the main invoice language.");
      return;
    }
    const missing = missingTranslationCount(texts, editingLocale);
    langHint.textContent = [
      s("An empty field uses the Latvian text."),
      missing ? fill(s("Without translation: {n}"), { n: missing }) : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  for (const radio of localeRadios) {
    radio.addEventListener(
      "change",
      () => {
        if (!radio.checked) return;
        editingLocale = radio.value as InvoiceLocale;
        // Re-render the block list too, not just the preview: translatable
        // fields must now show/edit the newly selected language's text.
        renderBlockList();
        renderPreviewNow();
        updateLanguageHints();
      },
      { signal: controller.signal }
    );
  }

  // --- Preview ---------------------------------------------------------------
  // The iframe is always laid out at true A4 width and scaled to fit the
  // column (or to a chosen zoom), so the invoice looks the same on every
  // screen instead of reflowing narrow. Its height follows the document.
  const A4_HEIGHT_PX = 1123;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  function renderPreviewNow() {
    const draftInvoice: InvoiceHtmlInvoice = {
      ...bootstrap.sampleInvoice,
      templateSnapshot: {
        version: 2,
        headerText: state.headerText || null,
        footerText: state.footerText || null,
        paymentInstructions: state.paymentInstructions || null,
        defaultNote: state.defaultNote || null,
        // The preview shows what a NEW invoice will look like.
        labelSetVersion: CURRENT_LABEL_SET_VERSION,
        config: state.config,
      },
    };
    previewFrame.srcdoc = renderInvoiceHtml(
      draftInvoice,
      bootstrap.sampleLines,
      editingLocale
    );
  }
  // Typing re-renders the preview, but not on every single keystroke.
  function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreviewNow, 80);
  }

  previewFrame.addEventListener(
    "load",
    () => {
      const contentHeight =
        previewFrame.contentDocument?.documentElement.scrollHeight ?? 0;
      previewFrame.style.height = `${Math.max(contentHeight, A4_HEIGHT_PX)}px`;
      applyZoom();
    },
    { signal: controller.signal }
  );

  function applyZoom() {
    const naturalWidth = previewFrame.offsetWidth;
    const naturalHeight = previewFrame.offsetHeight;
    let zoom = Number(zoomSelect.value);
    if (zoomSelect.value === "fit" || !zoom) {
      const style = getComputedStyle(previewCanvas);
      const available =
        previewCanvas.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      // Hidden (the phone's Edit view): the observer below runs this again
      // as soon as the canvas has a width.
      if (available <= 0 || !naturalWidth) return;
      zoom = Math.min(1, available / naturalWidth);
    }
    previewFrame.style.transform = `scale(${zoom})`;
    // A CSS transform never changes an element's own layout size, only how
    // it paints -- so the wrapping element's box must be resized to match
    // the iframe's actual visible (scaled) size, or the surrounding
    // .tpl-editor-canvas's `overflow: auto` has no scaled area to compute
    // scrollbars for.
    previewZoomWrap.style.width = `${naturalWidth * zoom}px`;
    previewZoomWrap.style.height = `${naturalHeight * zoom}px`;
  }
  zoomSelect.addEventListener("change", applyZoom, {
    signal: controller.signal,
  });
  let observedWidth = 0;
  const canvasObserver = new ResizeObserver(() => {
    const width = previewCanvas.clientWidth;
    if (zoomSelect.value !== "fit" || Math.abs(width - observedWidth) < 1) {
      return;
    }
    observedWidth = width;
    applyZoom();
  });
  canvasObserver.observe(previewCanvas);

  // --- Sample charges for another billing period ---------------------------
  // Fetched in place, so switching the period never reloads the page (which
  // would throw away unsaved edits).
  const sampleRowsFor = (lines: InvoiceHtmlLine[]): SampleRow[] =>
    lines.map((line) => ({
      key: rowPresentationKey(line),
      label: line.description,
    }));
  let currentPeriodId = periodSelect?.value ?? "";
  periodSelect?.addEventListener(
    "change",
    async () => {
      const select = periodSelect;
      const periodId = select.value;
      periodError.hidden = true;
      select.disabled = true;
      try {
        const { data, error } = await actions.invoiceTemplates.previewLines({
          organizationId,
          periodId,
        });
        if (error || !data) throw error ?? new Error("previewLines");
        bootstrap.sampleLines = data.sampleLines;
        sampleRows = sampleRowsFor(data.sampleLines);
        bootstrap.sampleInvoice = {
          ...bootstrap.sampleInvoice,
          issueDate: data.issueDate,
          dueDate: data.dueDate,
          subtotal: data.totals.subtotal,
          vatTotal: data.totals.vatTotal,
          currentCharges: data.totals.currentCharges,
          amountDue: data.totals.currentCharges,
        };
        currentPeriodId = periodId;
        const url = new URL(location.href);
        url.searchParams.set("previewPeriodId", periodId);
        history.replaceState(null, "", url);
        renderBlockList();
        renderPreviewNow();
      } catch {
        select.value = currentPeriodId;
        periodError.textContent = s(
          "Could not load the sample charges. Try again."
        );
        periodError.hidden = false;
      } finally {
        select.disabled = false;
        select.focus();
      }
    },
    { signal: controller.signal }
  );

  // --- Phone: one column at a time -------------------------------------------
  const viewButtons = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-tpl-view]"),
  ];
  for (const button of viewButtons) {
    button.addEventListener(
      "click",
      () => {
        root.dataset.view = button.dataset.tplView;
        for (const other of viewButtons) {
          other.setAttribute("aria-pressed", String(other === button));
        }
      },
      { signal: controller.signal }
    );
  }

  // --- Status line (reset and its Undo, section limit) -------------------------
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  function clearStatus() {
    clearTimeout(statusTimer);
    statusEl.replaceChildren();
    statusEl.hidden = true;
  }
  function showStatus(message: string, undo?: () => void) {
    clearTimeout(statusTimer);
    statusEl.textContent = message;
    if (undo) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tpl-undo";
      button.textContent = s("Undo");
      button.addEventListener("click", () => {
        clearStatus();
        undo();
      });
      statusEl.appendChild(document.createTextNode(" "));
      statusEl.appendChild(button);
    }
    statusEl.hidden = false;
    statusTimer = setTimeout(clearStatus, 10_000);
  }

  // Concrete element types, not HTMLElement: @cloudflare/workers-types'
  // ambient globals (bundled for the Worker runtime) collide with
  // lib.dom.d.ts's Element.remove() return type in this project, which
  // breaks ordinary DOM subtype checks against the general HTMLElement
  // interface (same class of issue as the documented append() workaround
  // above and in workbench-drawer.ts) -- naming the exact types actually
  // passed sidesteps it.
  function labeled(
    text: string,
    control: HTMLInputElement | HTMLSelectElement
  ): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "tpl-control";
    // appendChild, not append(): this project's TS program resolves
    // Element.append()'s overloads incorrectly (see workbench-drawer.ts's
    // identical note -- @cloudflare/workers-types' ambient globals collide
    // with lib.dom.d.ts here; appendChild is unaffected).
    label.appendChild(document.createTextNode(text + " "));
    label.appendChild(control);
    return label;
  }

  let fieldIdCounter = 0;
  function field(
    text: string,
    control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "tpl-field";
    const id = `tpl-field-${++fieldIdCounter}`;
    control.id = id;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = text;
    wrap.appendChild(label);
    wrap.appendChild(control);
    return wrap;
  }

  function toggle(
    checked: boolean,
    ariaLabel: string,
    onChange: (checked: boolean) => void
  ): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "tpl-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "tpl-toggle-input";
    input.setAttribute("aria-label", ariaLabel);
    input.checked = checked;
    input.addEventListener("change", () => {
      onChange(input.checked);
      markDirty();
      refreshPreview();
    });
    const track = document.createElement("span");
    track.className = "tpl-toggle-track";
    const thumb = document.createElement("span");
    thumb.className = "tpl-toggle-thumb";
    track.appendChild(thumb);
    label.appendChild(input);
    label.appendChild(track);
    return label;
  }

  // The values are the schema's 0-4 steps (invoice-template-schema.ts's
  // SPACING_CSS); only the names shown to the admin are words.
  const SPACING_LABELS: Record<SpacingValue, string> = {
    0: "None",
    1: "Small",
    2: "Medium",
    3: "Large",
    4: "Extra large",
  };

  function spacingSelect(
    value: SpacingValue | undefined,
    onChange: (next: SpacingValue) => void
  ): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "tpl-select";
    for (const spacing of SPACING_VALUES) {
      const option = document.createElement("option");
      option.value = String(spacing);
      option.textContent = s(SPACING_LABELS[spacing]);
      option.selected = (value ?? 0) === spacing;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      onChange(Number(select.value) as SpacingValue);
      markDirty();
      refreshPreview();
    });
    return select;
  }

  function checkbox(
    checked: boolean,
    onChange: (checked: boolean) => void
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => {
      onChange(input.checked);
      markDirty();
      refreshPreview();
    });
    return input;
  }

  function iconButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tpl-icon-button";
    // The label is the visible text, so there is nothing for a tooltip to add.
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function moveBlock(id: string, direction: -1 | 1) {
    const blocks = state.config.document.blocks;
    const index = blocks.findIndex((b) => b.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    markDirty();
    renderBlockList();
    refreshPreview();
    // renderBlockList() replaces every <li>, which drops keyboard focus
    // back to <body> -- restore it to the same Move button on the moved
    // block so repeated keyboard reordering doesn't require re-tabbing in
    // from scratch each time.
    focusMoveButton(id, direction);
  }

  function focusMoveButton(blockId: string, direction: -1 | 1) {
    const li = blockListEl.querySelector<HTMLElement>(
      `[data-block-id="${blockId}"]`
    );
    const label = direction === -1 ? s("Move up") : s("Move down");
    const button = li
      ? [...li.querySelectorAll<HTMLButtonElement>(".tpl-icon-button")].find(
          (b) => b.getAttribute("aria-label") === label
        )
      : undefined;
    button?.focus();
  }

  function updateBlock(
    id: string,
    patch: (block: InvoiceTemplateBlock) => void
  ) {
    const block = state.config.document.blocks.find((b) => b.id === id);
    if (block) patch(block);
  }

  const BLOCK_LABELS: Record<string, string> = {
    meta: s("Invoice details"),
    parties: s("Sender and recipient"),
    "line-items": s("Charges table"),
    payment: s("Payment details"),
    "default-note": s("Default note"),
    footer: s("Footer"),
  };

  function defaultLabelFor(block: InvoiceTemplateBlock): string {
    return block.type === "text" ? s("Custom text") : BLOCK_LABELS[block.type];
  }

  function renderRowLi(row: SampleRow): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "tpl-row";
    const override = state.config.rowOverrides[row.key] ?? {};

    // No drag handle here: individual charge rows cannot be reordered (they
    // follow billing rule order), so nothing should look draggable.
    const title = document.createElement("span");
    title.className = "tpl-row-title";
    title.textContent = row.label;
    li.appendChild(title);

    const controls = document.createElement("div");
    controls.className = "tpl-row-controls";

    // No Show/hide toggle here: a row that contributes to the invoice
    // total can never be hidden (spec requirement B) -- only bold/spacing
    // presentation overrides exist for a charge row.
    controls.appendChild(
      labeled(
        s("Bold"),
        checkbox(override.bold ?? false, (checked) => {
          state.config.rowOverrides[row.key] = {
            ...state.config.rowOverrides[row.key],
            bold: checked,
          };
        })
      )
    );

    const overflow = document.createElement("details");
    overflow.className = "tpl-row-overflow";
    const summary = document.createElement("summary");
    summary.className = "tpl-overflow-btn tpl-icon-button";
    summary.setAttribute("aria-label", s("More options"));
    summary.dataset.tip = s("More options");
    summary.textContent = "⋯";
    overflow.appendChild(summary);
    const popover = document.createElement("div");
    popover.className = "tpl-popover";
    popover.appendChild(
      field(
        s("Spacing"),
        spacingSelect(override.spacingBefore, (value) => {
          state.config.rowOverrides[row.key] = {
            ...state.config.rowOverrides[row.key],
            spacingBefore: value,
          };
        })
      )
    );
    overflow.appendChild(popover);
    controls.appendChild(overflow);

    li.appendChild(controls);
    return li;
  }

  function textField(
    value: string,
    onChange: (value: string) => void,
    maxLength: number
  ): HTMLTextAreaElement {
    const textarea = document.createElement("textarea");
    textarea.className = "tpl-textarea";
    textarea.rows = 2;
    textarea.value = value;
    textarea.maxLength = maxLength;
    textarea.addEventListener("input", () => {
      onChange(textarea.value);
      markDirty();
      refreshPreview();
    });
    return textarea;
  }

  // Shows/edits whichever language is currently selected (editingLocale).
  // In Latvian mode this behaves exactly like textField() above (editing
  // the canonical value directly). In EN/RU mode it edits the translation
  // only, with the Latvian text shown as a placeholder -- so an empty
  // translation visibly falls back to Latvian rather than looking like a
  // blank required field.
  function localizedTextField(
    localizedField: LocalizedField,
    maxLength: number
  ): HTMLTextAreaElement {
    if (editingLocale === "lv") {
      return textField(localizedField.getLv(), localizedField.setLv, maxLength);
    }
    const locale = editingLocale;
    const textarea = document.createElement("textarea");
    textarea.className = "tpl-textarea";
    textarea.rows = 2;
    textarea.value = localizedField.getTranslation(locale) ?? "";
    textarea.placeholder = localizedField.getLv();
    textarea.maxLength = maxLength;
    textarea.addEventListener("input", () => {
      localizedField.setTranslation(locale, textarea.value);
      markDirty();
      refreshPreview();
    });
    return textarea;
  }

  function headerTextField(): LocalizedField {
    return {
      getLv: () => state.headerText,
      setLv: (v) => (state.headerText = v),
      getTranslation: (locale) =>
        state.config.textTranslations?.headerText?.[locale],
      setTranslation: (locale, v) => {
        state.config.textTranslations ??= {};
        state.config.textTranslations.headerText ??= {};
        state.config.textTranslations.headerText[locale] = v;
      },
    };
  }

  function footerTextField(): LocalizedField {
    return {
      getLv: () => state.footerText,
      setLv: (v) => (state.footerText = v),
      getTranslation: (locale) =>
        state.config.textTranslations?.footerText?.[locale],
      setTranslation: (locale, v) => {
        state.config.textTranslations ??= {};
        state.config.textTranslations.footerText ??= {};
        state.config.textTranslations.footerText[locale] = v;
      },
    };
  }

  function paymentInstructionsField(): LocalizedField {
    return {
      getLv: () => state.paymentInstructions,
      setLv: (v) => (state.paymentInstructions = v),
      getTranslation: (locale) =>
        state.config.textTranslations?.paymentInstructions?.[locale],
      setTranslation: (locale, v) => {
        state.config.textTranslations ??= {};
        state.config.textTranslations.paymentInstructions ??= {};
        state.config.textTranslations.paymentInstructions[locale] = v;
      },
    };
  }

  function defaultNoteField(): LocalizedField {
    return {
      getLv: () => state.defaultNote,
      setLv: (v) => (state.defaultNote = v),
      getTranslation: (locale) =>
        state.config.textTranslations?.defaultNote?.[locale],
      setTranslation: (locale, v) => {
        state.config.textTranslations ??= {};
        state.config.textTranslations.defaultNote ??= {};
        state.config.textTranslations.defaultNote[locale] = v;
      },
    };
  }

  function customTextField(blockId: string): LocalizedField {
    return {
      getLv: () => {
        const block = state.config.document.blocks.find(
          (b) => b.id === blockId
        );
        return block?.type === "text" ? block.text : "";
      },
      setLv: (v) =>
        updateBlock(blockId, (b) => {
          if (b.type === "text") b.text = v;
        }),
      getTranslation: (locale) => {
        const block = state.config.document.blocks.find(
          (b) => b.id === blockId
        );
        if (block?.type !== "text") return undefined;
        return locale === "en" ? block.textEn : block.textRu;
      },
      setTranslation: (locale, v) =>
        updateBlock(blockId, (b) => {
          if (b.type !== "text") return;
          if (locale === "en") b.textEn = v;
          else b.textRu = v;
        }),
    };
  }

  // Sections keep their fixed names; a custom text block is named from its
  // first words (the old per-section "title" was an editor-only label that
  // never reached the invoice, so it is no longer offered).
  function displayName(block: InvoiceTemplateBlock): string {
    const fallback = defaultLabelFor(block);
    return block.type === "text"
      ? textBlockName(block.text, fallback)
      : fallback;
  }

  function renderBlockLi(
    block: InvoiceTemplateBlock,
    index: number
  ): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "tpl-block";
    li.dataset.blockId = block.id;
    const header = document.createElement("div");
    header.className = "tpl-block-header";

    const handle = document.createElement("span");
    handle.className = "tpl-drag-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "⋮⋮";
    header.appendChild(handle);

    const num = document.createElement("span");
    num.className = "tpl-block-num";
    num.textContent = `${index + 1}.`;
    header.appendChild(num);

    const name = document.createElement("span");
    name.className = "tpl-block-name";
    name.textContent = displayName(block);
    header.appendChild(name);

    const headerActions = document.createElement("div");
    headerActions.className = "tpl-block-header-actions";

    // Invoice details, Sender and recipient, Charges table, and Payment
    // details can never be hidden -- enforced in the schema
    // (MANDATORY_BLOCK_TYPES), not just by omitting this toggle.
    if (!(MANDATORY_BLOCK_TYPES as readonly string[]).includes(block.type)) {
      const showToggle = toggle(
        block.visible,
        `${s("Show")}: ${displayName(block)}`,
        (checked) => updateBlock(block.id, (b) => (b.visible = checked))
      );
      showToggle.addEventListener("click", (event) => event.stopPropagation());
      headerActions.appendChild(showToggle);
    }

    const accordionBtn = document.createElement("button");
    accordionBtn.type = "button";
    accordionBtn.className = "tpl-accordion-btn";
    const chevron = document.createElement("span");
    chevron.className = "tpl-chevron-icon";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";
    accordionBtn.appendChild(chevron);
    headerActions.appendChild(accordionBtn);

    header.appendChild(headerActions);
    li.appendChild(header);

    const detail = document.createElement("div");
    detail.className = "tpl-block-detail";

    function setExpanded(next: boolean) {
      if (next) expandedBlockIds.add(block.id);
      else expandedBlockIds.delete(block.id);
      detail.hidden = !next;
      accordionBtn.setAttribute("aria-expanded", String(next));
      accordionBtn.setAttribute(
        "aria-label",
        next ? s("Collapse section") : s("Expand section")
      );
    }
    setExpanded(expandedBlockIds.has(block.id));

    accordionBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setExpanded(!expandedBlockIds.has(block.id));
    });
    header.addEventListener("click", () => {
      setExpanded(!expandedBlockIds.has(block.id));
    });

    if (block.type === "meta") {
      detail.appendChild(
        field(s("Invoice details"), localizedTextField(headerTextField(), 500))
      );
    } else if (block.type === "payment") {
      detail.appendChild(
        field(
          s("Payment details"),
          localizedTextField(paymentInstructionsField(), 1000)
        )
      );
    } else if (block.type === "default-note") {
      detail.appendChild(
        field(s("Default note"), localizedTextField(defaultNoteField(), 1000))
      );
    } else if (block.type === "footer") {
      detail.appendChild(
        field(s("Footer"), localizedTextField(footerTextField(), 1000))
      );
    } else if (block.type === "text") {
      const customText = localizedTextField(customTextField(block.id), 5000);
      // The list shows the Latvian text's first words; keep it in step while
      // typing (not a full re-render, so the field keeps focus and cursor).
      customText.addEventListener("input", () => {
        const current = state.config.document.blocks.find(
          (b) => b.id === block.id
        );
        if (current) name.textContent = displayName(current);
      });
      detail.appendChild(field(s("Custom text"), customText));
      detail.appendChild(
        labeled(
          s("Bold"),
          checkbox(block.emphasis === "bold", (checked) =>
            updateBlock(block.id, (b) => {
              if (b.type === "text") b.emphasis = checked ? "bold" : "normal";
            })
          )
        )
      );
      const alignSelect = document.createElement("select");
      alignSelect.className = "tpl-select";
      const ALIGN_LABELS = {
        left: "Left",
        center: "Center",
        right: "Right",
      } as const;
      for (const align of ["left", "center", "right"] as const) {
        const option = document.createElement("option");
        option.value = align;
        option.textContent = s(ALIGN_LABELS[align]);
        option.selected = (block.align ?? "left") === align;
        alignSelect.appendChild(option);
      }
      alignSelect.addEventListener("change", () => {
        updateBlock(block.id, (b) => {
          if (b.type === "text") {
            b.align = alignSelect.value as "left" | "center" | "right";
          }
        });
        markDirty();
        refreshPreview();
      });
      detail.appendChild(field(s("Align"), alignSelect));
    }

    detail.appendChild(
      field(
        s("Spacing"),
        spacingSelect(block.presentation?.spacingBefore, (value) =>
          updateBlock(block.id, (b) => {
            b.presentation = { ...b.presentation, spacingBefore: value };
          })
        )
      )
    );

    if (block.type === "line-items") {
      const subLabel = document.createElement("p");
      subLabel.className = "tpl-sub-label";
      subLabel.textContent = s("Line items");
      detail.appendChild(subLabel);
      const rows = document.createElement("ul");
      rows.className = "tpl-rows";
      for (const row of sampleRows) rows.appendChild(renderRowLi(row));
      detail.appendChild(rows);
    }

    const actions = document.createElement("div");
    actions.className = "tpl-block-actions";
    actions.appendChild(
      iconButton(s("Move up"), () => moveBlock(block.id, -1))
    );
    actions.appendChild(
      iconButton(s("Move down"), () => moveBlock(block.id, 1))
    );
    if (block.type === "text") {
      actions.appendChild(
        iconButton(s("Duplicate"), () => duplicateTextBlock(block.id))
      );
      actions.appendChild(
        iconButton(s("Delete"), () => deleteTextBlock(block.id))
      );
    }
    detail.appendChild(actions);

    li.appendChild(detail);
    return li;
  }

  function renderBlockList() {
    blockListEl.replaceChildren(
      ...state.config.document.blocks.map((block, index) =>
        renderBlockLi(block, index)
      )
    );
  }

  // Mirrors invoice-template-schema.ts's `blocks` array cap (30) -- without
  // this, the editor could show a layout the server will reject on save,
  // and the failed save silently discards whatever else the admin edited.
  const MAX_BLOCKS = 30;

  function duplicateTextBlock(id: string) {
    const blocks = state.config.document.blocks;
    if (blocks.length >= MAX_BLOCKS) {
      showStatus(
        s("This invoice layout has reached the maximum of 30 sections.")
      );
      return;
    }
    const index = blocks.findIndex((b) => b.id === id);
    const source = blocks[index];
    if (index < 0 || source.type !== "text") return;
    blocks.splice(index + 1, 0, { ...source, id: crypto.randomUUID() });
    markDirty();
    renderBlockList();
    refreshPreview();
  }

  function deleteTextBlock(id: string) {
    state.config.document.blocks = state.config.document.blocks.filter(
      (b) => b.id !== id
    );
    expandedBlockIds.delete(id);
    markDirty();
    renderBlockList();
    refreshPreview();
  }

  addTextButton.addEventListener(
    "click",
    () => {
      if (state.config.document.blocks.length >= MAX_BLOCKS) {
        showStatus(
          s("This invoice layout has reached the maximum of 30 sections.")
        );
        return;
      }
      clearStatus();
      const id = crypto.randomUUID();
      state.config.document.blocks.push({
        id,
        type: "text",
        visible: true,
        text: "",
        emphasis: "normal",
        align: "left",
      });
      expandedBlockIds.add(id);
      markDirty();
      renderBlockList();
      refreshPreview();
      // The new block is at the end of the list, usually out of sight:
      // take the cursor there so typing starts straight away.
      blockListEl
        .querySelector<HTMLElement>(`[data-block-id="${id}"] textarea`)
        ?.focus();
    },
    { signal: controller.signal }
  );

  // No confirmation: Reset applies at once and offers Undo for a few seconds,
  // which is easier to recover from than a pop-up that is clicked through.
  resetButton.addEventListener(
    "click",
    () => {
      const before = clone(state.config);
      const expandedBefore = [...expandedBlockIds];
      // Header/footer/payment-instructions/note TEXT is kept -- that must
      // include their EN/RU translations too, not just the Latvian value.
      // Custom text blocks' own translations are lost with the blocks.
      const textTranslations = state.config.textTranslations;
      state.config = createDefaultInvoiceTemplateConfig();
      if (textTranslations) state.config.textTranslations = textTranslations;
      expandedBlockIds.clear();
      markDirty();
      renderBlockList();
      refreshPreview();
      showStatus(s("Layout reset to the default."), () => {
        state.config = before;
        // Which sections were open is part of what Undo puts back.
        for (const id of expandedBefore) expandedBlockIds.add(id);
        markDirty();
        renderBlockList();
        refreshPreview();
        showStatus(s("Reset undone."));
      });
    },
    { signal: controller.signal }
  );

  const sortable = new Sortable(blockListEl, {
    handle: ".tpl-drag-handle",
    animation: 150,
    onEnd: () => {
      const order = [...blockListEl.children].map(
        (li) => (li as HTMLElement).dataset.blockId
      );
      state.config.document.blocks.sort(
        (a, b) => order.indexOf(a.id) - order.indexOf(b.id)
      );
      markDirty();
      // Re-render, not just re-sort the data: each block's "N." number is
      // baked into its DOM at render time, and Sortable only physically
      // moves the existing <li> nodes -- it never updates that number.
      renderBlockList();
      refreshPreview();
    },
  });

  // Only one row-level "..." popover open at a time -- a single delegated
  // listener survives renderBlockList() regenerating the <details> nodes,
  // unlike per-element listeners that would need re-attaching every time.
  document.addEventListener(
    "toggle",
    (event) => {
      const target = event.target as HTMLElement;
      if (
        !(target instanceof HTMLDetailsElement) ||
        !target.classList.contains("tpl-row-overflow") ||
        !target.open
      ) {
        return;
      }
      document
        .querySelectorAll<HTMLDetailsElement>("details.tpl-row-overflow[open]")
        .forEach((details) => {
          if (details !== target) details.open = false;
        });
    },
    { capture: true, signal: controller.signal }
  );

  // Back to the last saved version, after asking: the edits cannot be
  // recovered.
  discardButton.addEventListener(
    "click",
    () => {
      if (saving || !isDirty()) return;
      if (
        !window.confirm(
          s("Discard unsaved changes? Your edits have not been saved.")
        )
      ) {
        return;
      }
      Object.assign(state, clone(savedState));
      clearStatus();
      markDirty();
      renderBlockList();
      renderPreviewNow();
    },
    { signal: controller.signal }
  );

  // Saved without leaving the page: a rejected save keeps every edit (the old
  // full-page post reloaded from the database and lost them).
  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (saving || !isDirty()) return;
      saving = true;
      saveFailed = false;
      updateSaveBar();
      // What was sent, so an edit made while saving still counts as unsaved.
      const sentDraft = draft();
      const sentState = clone(state);
      const data = new FormData();
      data.set("organizationId", organizationId);
      data.set("headerText", state.headerText);
      data.set("footerText", state.footerText);
      data.set("paymentInstructions", state.paymentInstructions);
      data.set("defaultNote", state.defaultNote);
      data.set("config", JSON.stringify(state.config));
      try {
        const { error } = await actions.invoiceTemplates.update(data);
        if (error) {
          saveFailed = true;
        } else {
          savedDraft = sentDraft;
          savedState = sentState;
          savedNotice = true;
          clearTimeout(savedNoticeTimer);
          savedNoticeTimer = setTimeout(() => {
            savedNotice = false;
            updateSaveBar();
          }, 3000);
        }
      } catch {
        saveFailed = true;
      } finally {
        saving = false;
        updateSaveBar();
      }
    },
    { signal: controller.signal }
  );

  // Ctrl/Cmd+S saves instead of opening the browser's own save dialog.
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "s"
      ) {
        return;
      }
      event.preventDefault();
      if (isDirty() && !saving) form.requestSubmit();
    },
    { signal: controller.signal }
  );

  renderBlockList();
  renderPreviewNow();
  updateLanguageHints();
  updateSaveBar();
  return () => {
    controller.abort();
    sortable.destroy();
    canvasObserver.disconnect();
    clearTimeout(previewTimer);
    clearTimeout(statusTimer);
    clearTimeout(savedNoticeTimer);
  };
});
