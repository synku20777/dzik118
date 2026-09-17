// Contextual admin drawer UX (workbench). Owns: opening/closing the shared
// #admin-context-drawer, URL/history sync, focus management, dirty-state
// protection, submitting via the existing readings.adminSubmit/
// dwellings.update actions, and refreshing the workbench in place after a
// successful save.
//
// Body content is built with DOM APIs (createElement/textContent), never
// innerHTML with interpolated data -- this app treats untrusted-string-into-
// HTML as an XSS boundary everywhere else (see lib/html-escape.ts), and a
// dwelling's occupant name/billing fields are admin-entered, not
// hardcoded, so the same discipline applies here.
import { actions, isInputError } from "astro:actions";
import { ICONS, type IconName } from "./icons";

type DrawerKind = "readings" | "billing-details";

interface DrawerData {
  dwelling: {
    id: string;
    number: string;
    occupantName: string | null;
    billingName: string | null;
    billingEmail: string | null;
    billingAddress: string | null;
    notes: string | null;
  };
  organization: {
    addressLine1: string;
  };
  billingCase: {
    status: string;
    invoiceId: string | null;
    invoiceNumber: string | null;
  } | null;
  meters: Array<{
    meterId: string;
    type: string;
    label: string | null;
    serialNumber: string | null;
    unit: string;
    currentValue: string | null;
    previousValue: string | null;
    consumption: string | null;
  }>;
  manualRuleInputs: Array<{
    billingRuleId: string;
    ruleName: string;
    unit: string;
    calculationType: "MANUAL_QUANTITY" | "MANUAL_AMOUNT";
    value: string | null;
  }>;
}

interface StatusInfo {
  label: string;
  tone: string;
  icon: string;
}

interface DrawerConfig {
  organizationId: string;
  periodId: string;
  periodStatus: string;
  periodName: string;
  workbenchPath: string;
  refreshSelectors: string[];
  strings: Record<string, string>;
  meterTypeLabels: Record<string, string>;
  caseStatuses: Record<string, StatusInfo>;
}

// Element.append()'s overloads resolve incorrectly in this project's TS
// program -- @cloudflare/workers-types' ambient globals (Response,
// ReadableStream, ...) collide with lib.dom.d.ts here, corrupting overload
// resolution for the unrelated DOM append() method (appendChild is
// unaffected, hence this helper instead of native multi-arg append()).
function appendAll(parent: Node, ...children: Node[]): void {
  for (const child of children) parent.appendChild(child);
}

// Tabler Icons (Outline) per meter type. Hot water is "droplet-hot", a
// custom droplet+wave variant (see icons.ts) -- never a flame, which reads
// as gas/heating rather than water.
const METER_ICON_NAMES: Record<string, IconName> = {
  COLD_WATER: "droplet",
  HOT_WATER: "droplet-hot",
  ELECTRICITY: "bolt",
  GAS: "flame",
  HEAT: "thermometer",
  OTHER: "tool",
};

// Builds a Tabler-outline <svg> from the shared icon registry (icons.ts).
// The registry only holds static, developer-authored path data (never
// user/dwelling input), so innerHTML here does not cross the untrusted-
// string-into-HTML boundary the DOM-API convention above exists to guard.
function iconSvg(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = ICONS[name];
  return svg;
}

const dialogEl = document.querySelector<HTMLDialogElement>(
  "#admin-context-drawer"
);
if (dialogEl) {
  const dialog = dialogEl;
  const config: DrawerConfig = JSON.parse(dialog.dataset.config ?? "{}");
  const eyebrowEl = dialog.querySelector<HTMLElement>(
    "#context-drawer-eyebrow"
  )!;
  const titleEl = dialog.querySelector<HTMLElement>("#context-drawer-title")!;
  const statusPillEl = dialog.querySelector<HTMLElement>(
    "#context-drawer-status-pill"
  )!;
  const metaEl = dialog.querySelector<HTMLElement>("#context-drawer-meta")!;
  const bodyEl = dialog.querySelector<HTMLElement>("#context-drawer-body")!;
  const footerEl = dialog.querySelector<HTMLElement>("#context-drawer-footer")!;
  const closeButton = dialog.querySelector<HTMLButtonElement>(
    "[data-close-drawer]"
  )!;

  const s = (key: string) => config.strings[key] ?? key;

  let dirtySnapshot: string | null = null;
  let returnFocusTo: HTMLElement | null = null;
  let currentForm: HTMLFormElement | null = null;
  let openParams: {
    kind: DrawerKind;
    dwellingId: string;
    focus?: string;
  } | null = null;

  function formSnapshot(form: HTMLFormElement): string {
    return JSON.stringify([...new FormData(form).entries()]);
  }

  function isDirty(): boolean {
    if (!currentForm || dirtySnapshot === null) return false;
    return formSnapshot(currentForm) !== dirtySnapshot;
  }

  function drawerUrl(kind: DrawerKind, dwellingId: string, focus?: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("drawer", kind);
    url.searchParams.set("dwelling", dwellingId);
    if (focus) url.searchParams.set("focus", focus);
    else url.searchParams.delete("focus");
    return url;
  }

  function clearedUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("drawer");
    url.searchParams.delete("dwelling");
    url.searchParams.delete("focus");
    return url;
  }

  // Matches the CSS close-animation duration in AdminContextDrawer.astro --
  // dialog.close() itself is instant, but the panel keeps sliding out on
  // screen for this long, so clearing its contents has to wait or the
  // drawer visibly goes blank mid-animation.
  const CLOSE_ANIMATION_MS = 220;

  function closeDrawer(options: { fromPopstate?: boolean } = {}) {
    if (!dialog.open) return;
    dialog.close();
    currentForm = null;
    dirtySnapshot = null;
    openParams = null;
    if (!options.fromPopstate) {
      history.pushState(null, "", clearedUrl());
    }
    if (returnFocusTo && document.contains(returnFocusTo)) {
      returnFocusTo.focus();
    }
    returnFocusTo = null;
    window.setTimeout(() => {
      // Reopened (openDrawer() calls showModal(), setting dialog.open back
      // to true) before this fired -- skip, or this would wipe out the
      // content the reopen just rendered.
      if (dialog.open) return;
      bodyEl.replaceChildren();
      footerEl.replaceChildren();
    }, CLOSE_ANIMATION_MS);
  }

  function requestClose(options: { fromPopstate?: boolean } = {}) {
    if (isDirty()) {
      const discard = window.confirm(s("discardConfirm"));
      if (!discard) {
        if (options.fromPopstate && openParams) {
          // Undo the back-navigation's URL change; the drawer stays open.
          history.pushState(
            null,
            "",
            drawerUrl(openParams.kind, openParams.dwellingId, openParams.focus)
          );
        }
        return;
      }
    }
    closeDrawer(options);
  }

  function labeled(text: string, forId: string): HTMLLabelElement {
    const label = document.createElement("label");
    label.htmlFor = forId;
    label.textContent = text;
    label.className = "drawer-field-label";
    return label;
  }

  function fieldWrap(...children: Node[]): HTMLDivElement {
    const div = document.createElement("div");
    div.className = "drawer-field";
    appendAll(div, ...children);
    return div;
  }

  function errorNode(id: string): HTMLParagraphElement {
    const p = document.createElement("p");
    p.id = id;
    p.className = "drawer-field-error";
    p.setAttribute("role", "alert");
    p.hidden = true;
    return p;
  }

  function fieldRow(
    labelText: string,
    control: HTMLElement,
    unit: string,
    forId?: string
  ): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "drawer-field-row";
    const label = document.createElement("label");
    label.className = "drawer-field-row-label";
    label.textContent = labelText;
    if (forId) label.htmlFor = forId;
    const controlRow = document.createElement("div");
    controlRow.className = "drawer-field-row-control";
    const unitEl = document.createElement("span");
    unitEl.className = "drawer-field-unit";
    unitEl.textContent = unit;
    appendAll(controlRow, control, unitEl);
    appendAll(row, label, controlRow);
    return row;
  }

  function readonlyBox(text: string): HTMLDivElement {
    const box = document.createElement("div");
    box.className = "drawer-readonly-box";
    box.textContent = text;
    return box;
  }

  function renderResidentCard(
    data: DrawerData,
    options: {
      eyebrow?: string;
      action?: { label: string; href: string };
    } = {}
  ): HTMLDivElement | null {
    if (!data.dwelling.occupantName) return null;
    const card = document.createElement("div");
    card.className = "drawer-resident-card";
    const main = document.createElement("div");
    main.className = "drawer-resident-main";
    const icon = document.createElement("span");
    icon.className = "drawer-resident-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.appendChild(iconSvg("user"));
    const text = document.createElement("div");
    if (options.eyebrow) {
      const eyebrow = document.createElement("p");
      eyebrow.className = "drawer-resident-eyebrow";
      eyebrow.textContent = options.eyebrow;
      text.appendChild(eyebrow);
    }
    const name = document.createElement("p");
    name.className = "drawer-resident-name";
    name.textContent = data.dwelling.occupantName;
    const address = document.createElement("p");
    address.className = "drawer-resident-address";
    address.textContent = `${data.organization.addressLine1} – ${data.dwelling.number}`;
    appendAll(text, name, address);
    appendAll(main, icon, text);
    card.appendChild(main);
    if (options.action) {
      const action = document.createElement("a");
      action.href = options.action.href;
      action.className = "btn-secondary btn-sm";
      const actionIcon = document.createElement("span");
      actionIcon.setAttribute("aria-hidden", "true");
      actionIcon.appendChild(iconSvg("external-link"));
      appendAll(
        action,
        document.createTextNode(options.action.label + " "),
        actionIcon
      );
      card.appendChild(action);
    }
    return card;
  }

  function renderReadingsBody(data: DrawerData, focus?: string) {
    const banner = document.createElement("div");
    banner.className = "drawer-info-banner";
    const bannerIcon = document.createElement("span");
    bannerIcon.className = "drawer-info-icon";
    bannerIcon.setAttribute("aria-hidden", "true");
    bannerIcon.appendChild(iconSvg("info-circle"));
    const bannerText = document.createElement("div");
    const bannerTitle = document.createElement("p");
    bannerTitle.className = "drawer-info-title";
    bannerTitle.textContent = s("readingsBannerTitle");
    const bannerBody = document.createElement("p");
    bannerBody.className = "drawer-info-text";
    bannerBody.textContent = s("readingsBannerText");
    appendAll(bannerText, bannerTitle, bannerBody);
    appendAll(banner, bannerIcon, bannerText);

    const form = document.createElement("form");
    form.dataset.drawerForm = "readings";
    form.noValidate = true;
    const hidden = (name: string, value: string) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };
    hidden("organizationId", config.organizationId);
    hidden("periodId", config.periodId);

    let firstInput: HTMLInputElement | null = null;
    for (const meter of data.meters) {
      const meterTypeKey = meter.type.toLowerCase().replace(/_/g, "-");
      const section = document.createElement("section");
      section.className = "drawer-meter";

      const head = document.createElement("div");
      head.className = "drawer-meter-head";
      const icon = document.createElement("span");
      icon.className = "drawer-meter-icon";
      icon.dataset.meterType = meter.type;
      icon.setAttribute("aria-hidden", "true");
      icon.appendChild(iconSvg(METER_ICON_NAMES[meter.type] ?? "tool"));
      const nameWrap = document.createElement("div");
      const heading = document.createElement("h3");
      heading.className = "drawer-meter-name";
      heading.textContent =
        meter.label ?? config.meterTypeLabels[meter.type] ?? meter.type;
      const sub = document.createElement("p");
      sub.className = "drawer-meter-sub";
      sub.textContent = [meter.serialNumber, meter.unit]
        .filter(Boolean)
        .join(" · ");
      appendAll(nameWrap, heading, sub);
      appendAll(head, icon, nameWrap);

      const prevRow = fieldRow(
        s("previousReading"),
        readonlyBox(meter.previousValue ?? "—"),
        meter.unit
      );

      const inputId = `drawer-reading-${meter.meterId}`;
      const errorId = `${inputId}-error`;
      const input = document.createElement("input");
      input.id = inputId;
      input.name = "currentValue";
      input.type = "text";
      input.inputMode = "decimal";
      input.required = true;
      input.className = "drawer-input-box";
      input.value = meter.currentValue ?? "";
      input.setAttribute("aria-describedby", errorId);
      const err = errorNode(errorId);
      const currentRow = fieldRow(
        `${s("currentReading")} *`,
        input,
        meter.unit,
        inputId
      );
      currentRow.appendChild(err);

      const consumptionBox = readonlyBox(
        meter.consumption ? meter.consumption : "—"
      );
      consumptionBox.dataset.consumptionFor = meter.meterId;
      const consumptionRow = fieldRow(
        s("calculatedConsumption"),
        consumptionBox,
        meter.unit
      );

      input.addEventListener("input", () => {
        const current = Number.parseFloat(input.value);
        const previous = meter.previousValue
          ? Number.parseFloat(meter.previousValue)
          : null;
        if (Number.isFinite(current) && previous !== null) {
          consumptionBox.textContent = (current - previous).toFixed(3);
        } else if (Number.isFinite(current) && previous === null) {
          consumptionBox.textContent = current.toFixed(3);
        } else {
          consumptionBox.textContent = "—";
        }
      });

      appendAll(section, head, prevRow, currentRow, consumptionRow);
      section.dataset.meterId = meter.meterId;
      form.appendChild(section);

      if (!firstInput) firstInput = input;
      if (focus === meterTypeKey) firstInput = input;
    }

    for (const rule of data.manualRuleInputs) {
      const section = document.createElement("section");
      section.className = "drawer-meter";

      const head = document.createElement("div");
      head.className = "drawer-meter-head";
      const icon = document.createElement("span");
      icon.className = "drawer-meter-icon";
      icon.dataset.meterType = "MANUAL";
      icon.setAttribute("aria-hidden", "true");
      icon.appendChild(iconSvg("percentage"));
      const nameWrap = document.createElement("div");
      const heading = document.createElement("h3");
      heading.className = "drawer-meter-name";
      heading.textContent = rule.ruleName;
      const sub = document.createElement("p");
      sub.className = "drawer-meter-sub";
      sub.textContent =
        rule.calculationType === "MANUAL_QUANTITY"
          ? s("manualInputQuantityHelp")
          : s("manualInputAmountHelp");
      appendAll(nameWrap, heading, sub);
      appendAll(head, icon, nameWrap);

      const inputId = `drawer-manual-input-${rule.billingRuleId}`;
      const errorId = `${inputId}-error`;
      const input = document.createElement("input");
      input.id = inputId;
      input.name = "value";
      input.type = "text";
      input.inputMode = "decimal";
      input.required = true;
      input.className = "drawer-input-box";
      input.value = rule.value ?? "";
      input.setAttribute("aria-describedby", errorId);
      const err = errorNode(errorId);
      const valueRow = fieldRow(
        `${s("manualInputValue")} *`,
        input,
        rule.unit,
        inputId
      );
      valueRow.appendChild(err);

      appendAll(section, head, valueRow);
      section.dataset.billingRuleId = rule.billingRuleId;
      form.appendChild(section);

      if (!firstInput) firstInput = input;
      if (focus === `rule-${rule.billingRuleId}`) firstInput = input;
    }

    const residentCard = renderResidentCard(data);
    bodyEl.replaceChildren(
      ...(residentCard ? [residentCard] : []),
      banner,
      form
    );
    currentForm = form;
    dirtySnapshot = formSnapshot(form);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-secondary";
    cancel.textContent = s("cancel");
    cancel.addEventListener("click", () => requestClose());

    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn-primary";
    save.textContent = s("saveReadings");
    save.addEventListener("click", (event) => {
      event.preventDefault();
      void submitReadings(data, form, save);
    });

    footerEl.replaceChildren(cancel, save);
    window.setTimeout(() => firstInput?.focus(), 0);
  }

  async function submitReadings(
    data: DrawerData,
    form: HTMLFormElement,
    saveButton: HTMLButtonElement
  ) {
    const sections = [...form.querySelectorAll<HTMLElement>("[data-meter-id]")];
    const ruleSections = [
      ...form.querySelectorAll<HTMLElement>("[data-billing-rule-id]"),
    ];
    saveButton.disabled = true;
    const originalLabel = saveButton.textContent;
    saveButton.textContent = s("saving");
    let hadError = false;
    for (const section of sections) {
      const meterId = section.dataset.meterId!;
      const input = section.querySelector<HTMLInputElement>(
        'input[name="currentValue"]'
      )!;
      const errorEl = section.querySelector<HTMLElement>(
        ".drawer-field-error"
      )!;
      errorEl.hidden = true;
      const meter = data.meters.find((m) => m.meterId === meterId)!;
      if (input.value === (meter.currentValue ?? "")) continue; // unchanged
      const fd = new FormData();
      fd.set("organizationId", config.organizationId);
      fd.set("periodId", config.periodId);
      fd.set("meterId", meterId);
      fd.set("currentValue", input.value);
      const { error } = await actions.readings.adminSubmit(fd);
      if (error) {
        hadError = true;
        const message = isInputError(error)
          ? (error.fields.currentValue?.join(" ") ?? error.message)
          : error.message;
        errorEl.textContent = s(message);
        errorEl.hidden = false;
      }
    }
    for (const section of ruleSections) {
      const billingRuleId = section.dataset.billingRuleId!;
      const input = section.querySelector<HTMLInputElement>(
        'input[name="value"]'
      )!;
      const errorEl = section.querySelector<HTMLElement>(
        ".drawer-field-error"
      )!;
      errorEl.hidden = true;
      const rule = data.manualRuleInputs.find(
        (r) => r.billingRuleId === billingRuleId
      )!;
      if (input.value === (rule.value ?? "")) continue; // unchanged
      const fd = new FormData();
      fd.set("organizationId", config.organizationId);
      fd.set("periodId", config.periodId);
      fd.set("dwellingId", data.dwelling.id);
      fd.set("billingRuleId", billingRuleId);
      fd.set("value", input.value);
      const { error } = await actions.readings.adminSubmitManualRuleInput(fd);
      if (error) {
        hadError = true;
        const message = isInputError(error)
          ? (error.fields.value?.join(" ") ?? error.message)
          : error.message;
        errorEl.textContent = s(message);
        errorEl.hidden = false;
      }
    }
    saveButton.disabled = false;
    saveButton.textContent = originalLabel;
    if (!hadError) {
      await refreshWorkbenchAndClose(s("readingSaved"));
    }
  }

  function renderBillingBody(data: DrawerData, focus?: string) {
    const dwelling = data.dwelling;
    const recipientIncomplete =
      !(dwelling.billingName || dwelling.occupantName) ||
      !dwelling.billingAddress;
    const billingEmailMissing = !dwelling.billingEmail;

    function blockerBadge(tone: string, text: string): HTMLSpanElement {
      const badge = document.createElement("span");
      badge.className = "status-badge";
      badge.dataset.tone = tone;
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.appendChild(iconSvg("alert-triangle"));
      appendAll(badge, icon, document.createTextNode(text));
      return badge;
    }

    const nodes: HTMLElement[] = [];
    if (recipientIncomplete || billingEmailMissing) {
      const banner = document.createElement("div");
      banner.className = "drawer-info-banner";
      banner.dataset.tone = "warning";
      const bannerIcon = document.createElement("span");
      bannerIcon.className = "drawer-info-icon";
      bannerIcon.setAttribute("aria-hidden", "true");
      bannerIcon.appendChild(iconSvg("alert-triangle"));
      const bannerText = document.createElement("div");
      const bannerTitle = document.createElement("p");
      bannerTitle.className = "drawer-info-title";
      bannerTitle.textContent = s("billingBlockersBanner");
      const blockers = document.createElement("div");
      blockers.className = "drawer-blockers";
      if (recipientIncomplete) {
        blockers.appendChild(
          blockerBadge("danger", s("recipientDetailsIncomplete"))
        );
      }
      if (billingEmailMissing) {
        blockers.appendChild(
          blockerBadge("warning", s("billingEmailMissingBadge"))
        );
      }
      appendAll(bannerText, bannerTitle, blockers);
      appendAll(banner, bannerIcon, bannerText);
      nodes.push(banner);
    }

    const residentCard = renderResidentCard(data, {
      eyebrow: s("residentInformationLabel"),
      action: {
        label: s("openFullDwelling"),
        href: `/admin/o/${config.organizationId}/dwellings/${dwelling.id}`,
      },
    });
    if (residentCard) nodes.push(residentCard);

    const form = document.createElement("form");
    form.dataset.drawerForm = "billing-details";
    form.noValidate = true;
    const hidden = (name: string, value: string) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };
    hidden("organizationId", config.organizationId);
    hidden("dwellingId", dwelling.id);

    const fields: Array<{
      key: keyof DrawerData["dwelling"];
      name: string;
      labelKey: string;
      required?: boolean;
      type?: string;
      placeholderKey?: string;
      multiline?: boolean;
      focusKey: string;
      heading?: string;
    }> = [
      {
        key: "occupantName",
        name: "occupantName",
        labelKey: "occupantName",
        required: true,
        focusKey: "occupant",
        heading: s("billingInformationHeading"),
      },
      {
        key: "billingName",
        name: "billingName",
        labelKey: "billingName",
        placeholderKey: "billingNamePlaceholder",
        focusKey: "billing-name",
      },
      {
        key: "billingEmail",
        name: "billingEmail",
        labelKey: "billingEmail",
        type: "email",
        required: true,
        focusKey: "billing-email",
      },
      {
        key: "billingAddress",
        name: "billingAddress",
        labelKey: "billingAddress",
        placeholderKey: "billingAddressPlaceholder",
        multiline: true,
        focusKey: "recipient",
      },
      {
        key: "notes",
        name: "notes",
        labelKey: "internalNoteLabel",
        placeholderKey: "internalNotePlaceholder",
        multiline: true,
        focusKey: "notes",
        heading: s("additionalInformationHeading"),
      },
    ];

    let firstInput: HTMLInputElement | HTMLTextAreaElement | null = null;
    const errorEl = errorNode("drawer-billing-error");
    for (const field of fields) {
      if (field.heading) {
        const heading = document.createElement("h3");
        heading.className = "drawer-section-heading";
        heading.textContent = field.heading;
        form.appendChild(heading);
      }
      const inputId = `drawer-${field.name}`;
      const control: HTMLInputElement | HTMLTextAreaElement = field.multiline
        ? document.createElement("textarea")
        : document.createElement("input");
      control.id = inputId;
      control.name = field.name;
      control.className = field.multiline
        ? "drawer-textarea-box"
        : "drawer-input-box";
      if (!field.multiline) {
        (control as HTMLInputElement).type = field.type ?? "text";
      }
      if (field.placeholderKey) control.placeholder = s(field.placeholderKey);
      control.value = dwelling[field.key] ?? "";
      const labelText = field.required
        ? `${s(field.labelKey)} *`
        : s(field.labelKey);
      form.appendChild(fieldWrap(labeled(labelText, inputId), control));
      if (!firstInput) firstInput = control;
      if (focus === field.focusKey) firstInput = control;
    }
    form.appendChild(errorEl);
    nodes.push(form);
    bodyEl.replaceChildren(...nodes);
    currentForm = form;
    dirtySnapshot = formSnapshot(form);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-secondary";
    cancel.textContent = s("cancel");
    cancel.addEventListener("click", () => requestClose());

    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn-primary";
    save.textContent = s("saveChanges");
    save.addEventListener("click", (event) => {
      event.preventDefault();
      void submitBillingDetails(form, save, errorEl);
    });

    footerEl.replaceChildren(cancel, save);
    window.setTimeout(() => firstInput?.focus(), 0);
  }

  async function submitBillingDetails(
    form: HTMLFormElement,
    saveButton: HTMLButtonElement,
    errorEl: HTMLElement
  ) {
    saveButton.disabled = true;
    const originalLabel = saveButton.textContent;
    saveButton.textContent = s("saving");
    errorEl.hidden = true;
    const { error } = await actions.dwellings.update(new FormData(form));
    saveButton.disabled = false;
    saveButton.textContent = originalLabel;
    if (error) {
      const message = isInputError(error)
        ? Object.values(error.fields).flat().join(" ") || error.message
        : error.message;
      errorEl.textContent = message;
      errorEl.hidden = false;
      return;
    }
    await refreshWorkbenchAndClose(s("changesSaved"));
  }

  async function refreshWorkbenchAndClose(message: string) {
    dirtySnapshot = null; // saved -- no further discard prompt on close
    try {
      const url = clearedUrl();
      const response = await fetch(url.pathname + url.search, {
        headers: { "X-Requested-With": "workbench-drawer" },
      });
      const html = await response.text();
      const fresh = new DOMParser().parseFromString(html, "text/html");
      for (const selector of config.refreshSelectors) {
        const current = document.querySelector(selector);
        const updated = fresh.querySelector(selector);
        if (current && updated) current.replaceWith(updated);
      }
      document.getElementById("workbench-announcer")?.replaceChildren(message);
    } finally {
      closeDrawer();
    }
  }

  function setStatusPill(status: string | null) {
    if (!status) {
      statusPillEl.hidden = true;
      return;
    }
    const info = config.caseStatuses[status];
    statusPillEl.hidden = false;
    statusPillEl.dataset.tone = info?.tone ?? "neutral";
    statusPillEl.replaceChildren();
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    if (info?.icon && info.icon in ICONS) {
      icon.appendChild(iconSvg(info.icon as IconName));
    }
    appendAll(
      statusPillEl,
      icon,
      document.createTextNode(info?.label ?? status)
    );
  }

  async function openDrawer(
    kind: DrawerKind,
    dwellingId: string,
    focus: string | undefined,
    trigger: HTMLElement | null
  ) {
    returnFocusTo = trigger;
    openParams = { kind, dwellingId, focus };
    eyebrowEl.textContent = `${s("dwellingEyebrow")}`;
    titleEl.textContent = "";
    setStatusPill(null);
    metaEl.textContent = s("loading");
    bodyEl.replaceChildren();
    footerEl.replaceChildren();
    if (!dialog.open) dialog.showModal();

    const { data, error } = await actions.workbench.getDrawerData({
      organizationId: config.organizationId,
      periodId: config.periodId,
      dwellingId,
    });
    if (error || !data) {
      metaEl.textContent = error?.message ?? s("genericError");
      return;
    }

    eyebrowEl.textContent = `${s("dwellingEyebrow")} ${data.dwelling.number}`;
    if (kind === "readings") {
      titleEl.textContent = s("meterReadingsTitle");
      setStatusPill(data.billingCase?.status ?? null);
      metaEl.textContent = config.periodName;
      renderReadingsBody(data, focus);
    } else {
      titleEl.textContent = s("billingDetailsTitle");
      setStatusPill(data.billingCase?.status ?? null);
      metaEl.textContent = data.billingCase?.invoiceNumber ?? config.periodName;
      renderBillingBody(data, focus);
    }
  }

  document.addEventListener("click", (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-open-drawer]"
    );
    if (!trigger) return;
    event.preventDefault();
    const kind = trigger.dataset.openDrawer as DrawerKind;
    const dwellingId = trigger.dataset.dwellingId!;
    const focus = trigger.dataset.focus;
    history.pushState(null, "", drawerUrl(kind, dwellingId, focus));
    void openDrawer(kind, dwellingId, focus, trigger);
  });

  closeButton.addEventListener("click", () => requestClose());
  dialog.addEventListener("cancel", (event) => {
    // Native Escape handling -- intercept so the dirty check runs first.
    event.preventDefault();
    requestClose();
  });

  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("drawer") as DrawerKind | null;
    const dwellingId = params.get("dwelling");
    if (kind && dwellingId) {
      void openDrawer(kind, dwellingId, params.get("focus") ?? undefined, null);
    } else if (dialog.open) {
      requestClose({ fromPopstate: true });
    }
  });

  const initialParams = new URLSearchParams(window.location.search);
  const initialKind = initialParams.get("drawer") as DrawerKind | null;
  const initialDwelling = initialParams.get("dwelling");
  if (initialKind && initialDwelling) {
    void openDrawer(
      initialKind,
      initialDwelling,
      initialParams.get("focus") ?? undefined,
      null
    );
  }
}
