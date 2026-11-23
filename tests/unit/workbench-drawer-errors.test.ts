import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDrawerFieldError,
  setDrawerFieldError,
} from "../../src/lib/ui/drawer-field-errors";

const root = resolve(import.meta.dirname, "../..");

interface FakeEvent {
  type: string;
  target: unknown;
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  preventDefault: () => void;
}

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  private _text = "";

  appendChild<T extends FakeNode>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  replaceChildren(...nodes: Array<FakeNode | string>): void {
    this.childNodes = [];
    for (const node of nodes) {
      if (typeof node === "string") {
        const txt = new FakeText(node);
        txt.parentNode = this;
        this.childNodes.push(txt);
      } else {
        this.appendChild(node);
      }
    }
  }

  get textContent(): string {
    if (this.childNodes.length === 0) return this._text;
    return this.childNodes.map((c) => c.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = [];
    this._text = value;
  }
}

class FakeText extends FakeNode {
  constructor(text: string) {
    super();
    this.textContent = text;
  }
}

class FakeElement extends FakeNode {
  tagName: string;
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  listeners = new Map<string, Array<(event: unknown) => void>>();
  hidden = false;
  disabled = false;
  value = "";
  type = "";
  name = "";
  htmlFor = "";
  inputMode = "";
  required = false;
  placeholder = "";
  noValidate = false;
  open = false;
  innerHTML = "";
  focusCount = 0;

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toLowerCase();
  }

  get id(): string {
    return this.attrs.get("id") ?? "";
  }

  set id(value: string) {
    this.attrs.set("id", value);
  }

  get className(): string {
    return this.attrs.get("class") ?? "";
  }

  set className(value: string) {
    this.attrs.set("class", value);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  addEventListener(name: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }

  dispatch(name: string, extra: Record<string, unknown> = {}): void {
    for (const fn of this.listeners.get(name) ?? []) {
      fn({
        type: name,
        target: this,
        preventDefault: () => {},
        ...extra,
      });
    }
  }

  focus(): void {
    this.focusCount++;
  }

  matchesSelector(selector: string): boolean {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    const bracket = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/);
    if (bracket) {
      const [, attr, expected] = bracket;
      if (attr.startsWith("data-")) {
        const camel = attr
          .slice(5)
          .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
        return this.dataset[camel] === expected;
      }
      return this.getAttribute(attr) === expected;
    }
    const attrOnly = selector.match(/^\[([^=\]]+)\]$/);
    if (attrOnly) {
      const attr = attrOnly[1];
      if (attr.startsWith("data-")) {
        const camel = attr
          .slice(5)
          .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
        return camel in this.dataset;
      }
      return this.hasAttribute(attr);
    }
    const tagAttr = selector.match(/^([a-z]+)\[name="([^"]+)"\]$/i);
    if (tagAttr) {
      return (
        this.tagName === tagAttr[1].toLowerCase() && this.name === tagAttr[2]
      );
    }
    return this.tagName === selector.toLowerCase();
  }

  querySelector<T extends FakeElement = FakeElement>(
    selector: string
  ): T | null {
    return (this.querySelectorAll(selector)[0] as T | undefined) ?? null;
  }

  querySelectorAll<T extends FakeElement = FakeElement>(selector: string): T[] {
    const out: T[] = [];
    const visit = (node: FakeNode) => {
      for (const child of node.childNodes) {
        if (child instanceof FakeElement) {
          if (child.matchesSelector(selector)) out.push(child as T);
          visit(child);
        }
      }
    };
    visit(this);
    return out;
  }

  closest(selector: string): FakeElement | null {
    if (this.matchesSelector(selector)) return this;
    let cur: FakeNode | null = this.parentNode;
    while (cur instanceof FakeElement) {
      if (cur.matchesSelector(selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
}

class FakeFormData {
  private map = new Map<string, string>();

  constructor(form?: FakeElement) {
    if (!form) return;
    for (const el of form.querySelectorAll("input")) {
      if (el.name) this.map.set(el.name, el.value);
    }
    for (const el of form.querySelectorAll("textarea")) {
      if (el.name) this.map.set(el.name, el.value);
    }
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  entries(): Array<[string, string]> {
    return [...this.map.entries()];
  }
}

function createDrawerHarness() {
  const docListeners = new Map<string, Array<(event: unknown) => void>>();
  const dialog = new FakeElement("dialog");
  dialog.id = "admin-context-drawer";
  dialog.dataset.config = JSON.stringify({
    organizationId: "org-1",
    periodId: "period-1",
    periodStatus: "OPEN",
    periodName: "January 2026",
    workbenchPath: "/admin/o/org-1/periods/period-1",
    refreshSelectors: [".case-queue"],
    strings: {
      dwellingEyebrow: "DWELLING",
      meterReadingsTitle: "Meter readings",
      billingDetailsTitle: "Billing details",
      cancel: "Cancel",
      saveReadings: "Save readings",
      saveChanges: "Save changes",
      saving: "Saving…",
      loading: "Loading…",
      previousReading: "Previous reading",
      currentReading: "Current reading",
      calculatedConsumption: "Calculated consumption",
      readingsBannerTitle: "Enter readings",
      readingsBannerText: "Calculated automatically",
      manualInputValue: "Value",
      manualInputQuantityHelp: "Enter qty",
      manualInputAmountHelp: "Enter amount",
      occupantName: "Occupant name",
      billingName: "Billing name",
      billingEmail: "Billing email",
      billingAddress: "Billing address",
      internalNoteLabel: "Internal note",
      billingBlockersBanner: "Complete details",
      recipientDetailsIncomplete: "Recipient incomplete",
      billingEmailMissingBadge: "Billing email missing",
      billingInformationHeading: "Billing information",
      additionalInformationHeading: "Additional information",
      genericError: "Something went wrong. Please try again.",
    },
    meterTypeLabels: { COLD_WATER: "Cold water" },
    caseStatuses: {
      OPEN: { label: "Open", tone: "neutral", icon: "circle" },
    },
  });

  const makeSlot = (id: string, attr?: [string, string]) => {
    const el = new FakeElement("div");
    el.id = id;
    if (attr) el.dataset[attr[0]] = attr[1];
    dialog.appendChild(el);
    return el;
  };
  makeSlot("context-drawer-eyebrow");
  makeSlot("context-drawer-title");
  makeSlot("context-drawer-status-pill");
  makeSlot("context-drawer-meta");
  const bodyEl = makeSlot("context-drawer-body");
  const footerEl = makeSlot("context-drawer-footer");
  const closeBtn = new FakeElement("button");
  closeBtn.dataset.closeDrawer = "";
  dialog.appendChild(closeBtn);
  (dialog as unknown as { showModal: () => void }).showModal = () => {
    dialog.open = true;
  };
  (dialog as unknown as { close: () => void }).close = () => {
    dialog.open = false;
  };

  vi.stubGlobal("document", {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => new FakeText(text),
    querySelector: (sel: string) =>
      sel === "#admin-context-drawer" ? dialog : dialog.querySelector(sel),
    querySelectorAll: () => [],
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      const list = docListeners.get(name) ?? [];
      list.push(fn);
      docListeners.set(name, list);
    },
    getElementById: (id: string) => dialog.querySelector(`#${id}`),
    contains: () => true,
    dispatchEvent: () => true,
  });
  vi.stubGlobal("window", {
    location: {
      href: "http://localhost/admin/o/org-1/periods/period-1",
      search: "",
    },
    addEventListener: vi.fn(),
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    confirm: () => true,
  });
  vi.stubGlobal("history", { pushState: vi.fn() });
  vi.stubGlobal("FormData", FakeFormData);
  class Anchor extends FakeElement {
    constructor() {
      super("a");
    }
  }
  vi.stubGlobal("HTMLAnchorElement", Anchor);

  return {
    dialog,
    bodyEl,
    footerEl,
    open(kind: "readings" | "billing-details") {
      const trigger = new FakeElement("button");
      trigger.dataset.openDrawer = kind;
      trigger.dataset.dwellingId = "dw-1";
      for (const fn of docListeners.get("click") ?? []) {
        const ev: FakeEvent = {
          type: "click",
          target: trigger,
          preventDefault: () => {},
        };
        fn(ev);
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("drawer-field-errors helper", () => {
  it("sets and clears aria-invalid and aria-describedby without clobbering existing hint tokens", () => {
    const attrs = new Map<string, string>([["aria-describedby", "hint-1"]]);
    const control = {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      removeAttribute: (k: string) => attrs.delete(k),
    } as unknown as HTMLElement;
    const errorEl = {
      id: "drawer-billingEmail-error",
      textContent: "",
      hidden: true,
    } as unknown as HTMLElement;

    setDrawerFieldError(control, errorEl, "Invalid email");
    setDrawerFieldError(control, errorEl, "Invalid email");
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toBe("Invalid email");
    expect(attrs.get("aria-invalid")).toBe("true");
    expect(attrs.get("aria-describedby")).toBe(
      "hint-1 drawer-billingEmail-error"
    );

    clearDrawerFieldError(control, errorEl);
    expect(errorEl.hidden).toBe(true);
    expect(errorEl.textContent).toBe("");
    expect(attrs.has("aria-invalid")).toBe(false);
    expect(attrs.get("aria-describedby")).toBe("hint-1");

    attrs.delete("aria-describedby");
    setDrawerFieldError(control, errorEl, "Required");
    expect(attrs.get("aria-describedby")).toBe("drawer-billingEmail-error");
    clearDrawerFieldError(control, errorEl);
    expect(attrs.has("aria-describedby")).toBe(false);
  });
});

describe("workbench drawer ARIA validation & design-system fidelity", () => {
  it("sets aria-invalid and aria-describedby only on readings/manual errors and clears on edit", async () => {
    const onPageLoad = vi.fn();
    type MockActionResult = {
      data?: unknown;
      error?: {
        type: string;
        message: string;
        fields: Record<string, string[]>;
      };
    };
    const adminSubmit = vi.fn<() => Promise<MockActionResult>>(async () => ({
      error: {
        type: "input",
        message: "Validation error",
        fields: { currentValue: ["Enter a valid meter reading"] },
      },
    }));
    const adminSubmitManualRuleInput = vi.fn<() => Promise<MockActionResult>>(
      async () => ({
        error: {
          type: "input",
          message: "Validation error",
          fields: { value: ["Enter a valid value"] },
        },
      })
    );
    const getDrawerData = vi.fn(async () => ({
      data: {
        dwelling: {
          id: "dw-1",
          number: "1",
          occupantName: "Anna",
          billingName: "Anna",
          billingEmail: "anna@example.com",
          billingAddress: "Street 1",
          notes: "",
        },
        organization: { addressLine1: "Brivibas 10" },
        billingCase: { status: "OPEN", invoiceId: null, invoiceNumber: null },
        meters: [
          {
            meterId: "m-1",
            type: "COLD_WATER",
            label: null,
            serialNumber: "CW-1",
            unit: "m3",
            currentValue: null,
            previousValue: "10.000",
            consumption: null,
            source: null,
          },
        ],
        manualRuleInputs: [
          {
            billingRuleId: "r-1",
            ruleName: "Cleaning",
            unit: "EUR",
            calculationType: "MANUAL_AMOUNT",
            value: null,
          },
        ],
      },
    }));

    vi.doMock("../../src/lib/ui/page-lifecycle", () => ({ onPageLoad }));
    vi.doMock("astro:actions", () => ({
      actions: {
        workbench: { getDrawerData },
        readings: { adminSubmit, adminSubmitManualRuleInput },
        dwellings: { update: vi.fn() },
      },
      isInputError: (err: unknown) =>
        Boolean(err && typeof err === "object" && "fields" in err),
    }));

    const harness = createDrawerHarness();
    await import("../../src/lib/ui/workbench-drawer");
    onPageLoad.mock.calls[0][0]();

    harness.open("readings");
    await new Promise((r) => setTimeout(r, 0));

    const meterInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-reading-m-1"
    )!;
    const ruleInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-manual-input-r-1"
    )!;
    expect(meterInput.hasAttribute("aria-describedby")).toBe(false);
    expect(meterInput.hasAttribute("aria-invalid")).toBe(false);
    expect(ruleInput.hasAttribute("aria-describedby")).toBe(false);

    const banner = harness.bodyEl.querySelector(".drawer-info-banner")!;
    expect(banner.className.split(/\s+/)).toContain("notice");
    expect(
      harness.bodyEl.querySelectorAll(".field-label").length
    ).toBeGreaterThan(0);

    meterInput.value = "abc";
    ruleInput.value = "xyz";
    const meterFocusBeforeSave = meterInput.focusCount;
    const ruleFocusBeforeSave = ruleInput.focusCount;
    const saveBtn = harness.footerEl.querySelector(".btn-primary")!;
    saveBtn.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(meterInput.getAttribute("aria-invalid")).toBe("true");
    expect(meterInput.getAttribute("aria-describedby")).toBe(
      "drawer-reading-m-1-error"
    );
    expect(
      harness.bodyEl.querySelector("#drawer-reading-m-1-error")?.textContent
    ).toBe("Enter a valid meter reading");
    expect(meterInput.focusCount).toBe(meterFocusBeforeSave + 1);
    expect(ruleInput.focusCount).toBe(ruleFocusBeforeSave);

    expect(ruleInput.getAttribute("aria-invalid")).toBe("true");
    expect(ruleInput.getAttribute("aria-describedby")).toBe(
      "drawer-manual-input-r-1-error"
    );

    meterInput.value = "12.5";
    meterInput.dispatch("input");
    expect(meterInput.hasAttribute("aria-invalid")).toBe(false);
    expect(meterInput.hasAttribute("aria-describedby")).toBe(false);
    expect(
      harness.bodyEl.querySelector("#drawer-reading-m-1-error")?.hidden
    ).toBe(true);

    ruleInput.value = "5.00";
    ruleInput.dispatch("input");
    expect(ruleInput.hasAttribute("aria-invalid")).toBe(false);
    expect(ruleInput.hasAttribute("aria-describedby")).toBe(false);

    // If only the manual-rule field fails, focus moves specifically to ruleInput.
    adminSubmit.mockImplementationOnce(async () => ({ data: { ok: true } }));
    adminSubmitManualRuleInput.mockImplementationOnce(async () => ({
      error: {
        type: "input",
        message: "Validation error",
        fields: { value: ["Enter a valid value"] },
      },
    }));
    const meterFocusBeforeRuleOnly = meterInput.focusCount;
    const ruleFocusBeforeRuleOnly = ruleInput.focusCount;
    saveBtn.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    expect(meterInput.focusCount).toBe(meterFocusBeforeRuleOnly);
    expect(ruleInput.focusCount).toBe(ruleFocusBeforeRuleOnly + 1);
  });

  it("shows period-wide reading failures in a form alert without marking controls invalid", async () => {
    const onPageLoad = vi.fn();
    const lockedError = { error: { message: "This billing period is locked" } };
    const adminSubmit = vi.fn(async () => lockedError);
    const adminSubmitManualRuleInput = vi.fn(async () => lockedError);
    const getDrawerData = vi.fn(async () => ({
      data: {
        dwelling: {
          id: "dw-1",
          number: "1",
          occupantName: "Anna",
          billingName: "Anna",
          billingEmail: "anna@example.com",
          billingAddress: "Street 1",
          notes: "",
        },
        organization: { addressLine1: "Brivibas 10" },
        billingCase: { status: "LOCKED", invoiceId: null, invoiceNumber: null },
        meters: [
          {
            meterId: "m-1",
            type: "COLD_WATER",
            label: null,
            serialNumber: "CW-1",
            unit: "m3",
            currentValue: null,
            previousValue: "10.000",
            consumption: null,
            source: null,
          },
        ],
        manualRuleInputs: [
          {
            billingRuleId: "r-1",
            ruleName: "Cleaning",
            unit: "EUR",
            calculationType: "MANUAL_AMOUNT",
            value: null,
          },
        ],
      },
    }));

    vi.doMock("../../src/lib/ui/page-lifecycle", () => ({ onPageLoad }));
    vi.doMock("astro:actions", () => ({
      actions: {
        workbench: { getDrawerData },
        readings: { adminSubmit, adminSubmitManualRuleInput },
        dwellings: { update: vi.fn() },
      },
      isInputError: (err: unknown) =>
        Boolean(err && typeof err === "object" && "fields" in err),
    }));

    const harness = createDrawerHarness();
    await import("../../src/lib/ui/workbench-drawer");
    onPageLoad.mock.calls[0][0]();

    harness.open("readings");
    await new Promise((r) => setTimeout(r, 0));

    const meterInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-reading-m-1"
    )!;
    const ruleInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-manual-input-r-1"
    )!;
    const formError = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-readings-error"
    )!;
    meterInput.value = "15";
    ruleInput.value = "25";

    const meterFocusBefore = meterInput.focusCount;
    const ruleFocusBefore = ruleInput.focusCount;
    harness.footerEl.querySelector(".btn-primary")!.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(meterInput.hasAttribute("aria-invalid")).toBe(false);
    expect(meterInput.hasAttribute("aria-describedby")).toBe(false);
    expect(ruleInput.hasAttribute("aria-invalid")).toBe(false);
    expect(ruleInput.hasAttribute("aria-describedby")).toBe(false);
    expect(meterInput.focusCount).toBe(meterFocusBefore);
    expect(ruleInput.focusCount).toBe(ruleFocusBefore);
    expect(formError.hidden).toBe(false);
    expect(formError.textContent).toBe("This billing period is locked");
  });

  it("does not restore field errors or steal focus when user edits while save is in flight", async () => {
    const onPageLoad = vi.fn();
    let resolveMeter!: (val: unknown) => void;
    let resolveRule!: (val: unknown) => void;
    const adminSubmit = vi.fn(
      () => new Promise((resolve) => (resolveMeter = resolve))
    );
    const adminSubmitManualRuleInput = vi.fn(
      () => new Promise((resolve) => (resolveRule = resolve))
    );
    const getDrawerData = vi.fn(async () => ({
      data: {
        dwelling: {
          id: "dw-1",
          number: "1",
          occupantName: "Anna",
          billingName: "Anna",
          billingEmail: "anna@example.com",
          billingAddress: "Street 1",
          notes: "",
        },
        organization: { addressLine1: "Brivibas 10" },
        billingCase: { status: "OPEN", invoiceId: null, invoiceNumber: null },
        meters: [
          {
            meterId: "m-1",
            type: "COLD_WATER",
            label: null,
            serialNumber: "CW-1",
            unit: "m3",
            currentValue: null,
            previousValue: "10.000",
            consumption: null,
            source: null,
          },
        ],
        manualRuleInputs: [
          {
            billingRuleId: "r-1",
            ruleName: "Cleaning",
            unit: "EUR",
            calculationType: "MANUAL_AMOUNT",
            value: null,
          },
        ],
      },
    }));

    vi.doMock("../../src/lib/ui/page-lifecycle", () => ({ onPageLoad }));
    vi.doMock("astro:actions", () => ({
      actions: {
        workbench: { getDrawerData },
        readings: { adminSubmit, adminSubmitManualRuleInput },
        dwellings: { update: vi.fn() },
      },
      isInputError: (err: unknown) =>
        Boolean(err && typeof err === "object" && "fields" in err),
    }));

    const harness = createDrawerHarness();
    await import("../../src/lib/ui/workbench-drawer");
    onPageLoad.mock.calls[0][0]();

    harness.open("readings");
    await new Promise((r) => setTimeout(r, 0));

    const meterInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-reading-m-1"
    )!;
    const ruleInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-manual-input-r-1"
    )!;
    meterInput.value = "bad-1";
    ruleInput.value = "bad-rule";

    const meterFocusBefore = meterInput.focusCount;
    const ruleFocusBefore = ruleInput.focusCount;
    harness.footerEl.querySelector(".btn-primary")!.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));

    // User edits the meter value while the request is in flight.
    meterInput.value = "14.5";
    meterInput.dispatch("input");

    resolveMeter({
      error: {
        type: "input",
        message: "Validation error",
        fields: { currentValue: ["Enter a valid meter reading"] },
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    resolveRule({
      error: {
        type: "input",
        message: "Validation error",
        fields: { value: ["Enter a valid value"] },
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(meterInput.hasAttribute("aria-invalid")).toBe(false);
    expect(meterInput.hasAttribute("aria-describedby")).toBe(false);
    expect(meterInput.focusCount).toBe(meterFocusBefore);
    expect(ruleInput.getAttribute("aria-invalid")).toBe("true");
    // The admin is editing the meter reading: focus must not jump to the rule.
    expect(ruleInput.focusCount).toBe(ruleFocusBefore);
  });

  it("finishes the whole readings batch and refreshes the queue when the drawer closes mid-save", async () => {
    const onPageLoad = vi.fn();
    let resolveMeter!: (val: unknown) => void;
    const adminSubmit = vi.fn(
      () => new Promise((resolve) => (resolveMeter = resolve))
    );
    const adminSubmitManualRuleInput = vi.fn(async () => ({ data: {} }));
    const getDrawerData = vi.fn(async () => ({
      data: {
        dwelling: {
          id: "dw-1",
          number: "1",
          occupantName: "Anna",
          billingName: "Anna",
          billingEmail: "anna@example.com",
          billingAddress: "Street 1",
          notes: "",
        },
        organization: { addressLine1: "Brivibas 10" },
        billingCase: { status: "OPEN", invoiceId: null, invoiceNumber: null },
        meters: [
          {
            meterId: "m-1",
            type: "COLD_WATER",
            label: null,
            serialNumber: "CW-1",
            unit: "m3",
            currentValue: null,
            previousValue: "10.000",
            consumption: null,
            source: null,
          },
        ],
        manualRuleInputs: [
          {
            billingRuleId: "r-1",
            ruleName: "Cleaning",
            unit: "EUR",
            calculationType: "MANUAL_AMOUNT",
            value: null,
          },
        ],
      },
    }));
    const fetchMock = vi.fn(async () => ({ text: async () => "" }));

    vi.doMock("../../src/lib/ui/page-lifecycle", () => ({ onPageLoad }));
    vi.doMock("astro:actions", () => ({
      actions: {
        workbench: { getDrawerData },
        readings: { adminSubmit, adminSubmitManualRuleInput },
        dwellings: { update: vi.fn() },
      },
      isInputError: () => false,
    }));

    const harness = createDrawerHarness();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString() {
          return { querySelector: () => null };
        }
      }
    );
    await import("../../src/lib/ui/workbench-drawer");
    onPageLoad.mock.calls[0][0]();

    harness.open("readings");
    await new Promise((r) => setTimeout(r, 0));
    harness.bodyEl.querySelector<FakeElement>("#drawer-reading-m-1")!.value =
      "12";
    harness.bodyEl.querySelector<FakeElement>(
      "#drawer-manual-input-r-1"
    )!.value = "5";

    harness.footerEl.querySelector(".btn-primary")!.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    harness.dialog
      .querySelector<FakeElement>("[data-close-drawer]")!
      .dispatch("click");
    expect(harness.dialog.open).toBe(false);

    resolveMeter({ data: {} });
    await new Promise((r) => setTimeout(r, 0));

    expect(adminSubmitManualRuleInput).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  async function setupDrawer(actionsMock: Record<string, unknown>) {
    const onPageLoad = vi.fn();
    const getDrawerData = vi.fn(async () => ({
      data: {
        dwelling: {
          id: "dw-1",
          number: "1",
          occupantName: "Anna",
          billingName: "Anna",
          billingEmail: "anna@example.com",
          billingAddress: "Street 1",
          notes: "",
        },
        organization: { addressLine1: "Brivibas 10" },
        billingCase: { status: "OPEN", invoiceId: null, invoiceNumber: null },
        meters: [
          {
            meterId: "m-1",
            type: "COLD_WATER",
            label: null,
            serialNumber: "CW-1",
            unit: "m3",
            currentValue: null,
            previousValue: "10.000",
            consumption: null,
            source: null,
          },
        ],
        manualRuleInputs: [
          {
            billingRuleId: "r-1",
            ruleName: "Cleaning",
            unit: "EUR",
            calculationType: "MANUAL_AMOUNT",
            value: null,
          },
        ],
      },
    }));
    vi.doMock("../../src/lib/ui/page-lifecycle", () => ({ onPageLoad }));
    vi.doMock("astro:actions", () => ({
      actions: { workbench: { getDrawerData }, ...actionsMock },
      isInputError: (err: unknown) =>
        Boolean(err && typeof err === "object" && "fields" in err),
    }));
    const harness = createDrawerHarness();
    const fetchMock = vi.fn(async () => ({ text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString() {
          return { querySelector: () => null };
        }
      }
    );
    await import("../../src/lib/ui/workbench-drawer");
    onPageLoad.mock.calls[0][0]();
    return { harness, fetchMock };
  }

  it("sends the values from the moment Save was pressed and keeps focus when a later field is edited mid-save", async () => {
    let resolveMeter!: (val: unknown) => void;
    const adminSubmit = vi.fn(
      () => new Promise((resolve) => (resolveMeter = resolve))
    );
    const adminSubmitManualRuleInput = vi.fn(async (_fd: FakeFormData) => ({
      data: {},
    }));
    const { harness } = await setupDrawer({
      readings: { adminSubmit, adminSubmitManualRuleInput },
      dwellings: { update: vi.fn() },
    });
    harness.open("readings");
    await new Promise((r) => setTimeout(r, 0));
    const meterInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-reading-m-1"
    )!;
    const ruleInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-manual-input-r-1"
    )!;
    meterInput.value = "bad";
    ruleInput.value = "5";
    const meterFocusBefore = meterInput.focusCount;

    harness.footerEl.querySelector(".btn-primary")!.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    ruleInput.value = "6"; // edited while the meter request is pending
    resolveMeter({
      error: {
        type: "input",
        message: "Validation error",
        fields: { currentValue: ["Enter a valid meter reading"] },
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(adminSubmitManualRuleInput.mock.calls[0][0].get("value")).toBe("5");
    expect(meterInput.getAttribute("aria-invalid")).toBe("true");
    expect(meterInput.focusCount).toBe(meterFocusBefore);
  });

  it("refreshes the queue when a billing-details save succeeds after the drawer closed", async () => {
    let resolveUpdate!: (val: unknown) => void;
    const update = vi.fn(
      () => new Promise((resolve) => (resolveUpdate = resolve))
    );
    const { harness, fetchMock } = await setupDrawer({
      readings: { adminSubmit: vi.fn(), adminSubmitManualRuleInput: vi.fn() },
      dwellings: { update },
    });
    harness.open("billing-details");
    await new Promise((r) => setTimeout(r, 0));
    harness.bodyEl.querySelector<FakeElement>("#drawer-billingEmail")!.value =
      "new@example.com";

    harness.footerEl.querySelector(".btn-primary")!.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    harness.dialog
      .querySelector<FakeElement>("[data-close-drawer]")!
      .dispatch("click");
    resolveUpdate({ data: {} });
    await new Promise((r) => setTimeout(r, 0));

    expect(update).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps billing input errors per field with focus and ignores stale response after input edit", async () => {
    const onPageLoad = vi.fn();
    let resolveUpdate: ((val: unknown) => void) | null = null;
    let mode: "field" | "general" | "delayed" = "field";
    const update = vi.fn(() => {
      if (mode === "delayed") {
        return new Promise((resolve) => {
          resolveUpdate = resolve;
        });
      }
      return Promise.resolve(
        mode === "field"
          ? {
              error: {
                type: "input",
                message: "Validation error",
                fields: { billingEmail: ["Invalid email address"] },
              },
            }
          : { error: { message: "Dwelling archived" } }
      );
    });
    const getDrawerData = vi.fn(async () => ({
      data: {
        dwelling: {
          id: "dw-1",
          number: "1",
          occupantName: "Anna",
          billingName: "Anna",
          billingEmail: null,
          billingAddress: null,
          notes: null,
        },
        organization: { addressLine1: "Brivibas 10" },
        billingCase: { status: "OPEN", invoiceId: null, invoiceNumber: null },
        meters: [],
        manualRuleInputs: [],
      },
    }));

    vi.doMock("../../src/lib/ui/page-lifecycle", () => ({ onPageLoad }));
    vi.doMock("astro:actions", () => ({
      actions: {
        workbench: { getDrawerData },
        readings: {
          adminSubmit: vi.fn(),
          adminSubmitManualRuleInput: vi.fn(),
        },
        dwellings: { update },
      },
      isInputError: (err: unknown) =>
        Boolean(err && typeof err === "object" && "fields" in err),
    }));

    const harness = createDrawerHarness();
    await import("../../src/lib/ui/workbench-drawer");
    onPageLoad.mock.calls[0][0]();

    harness.open("billing-details");
    await new Promise((r) => setTimeout(r, 0));

    const warningBanner = harness.bodyEl.querySelector(".drawer-info-banner")!;
    expect(warningBanner.className).toContain("notice-warning");

    const emailInput = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-billingEmail"
    )!;
    const formError = harness.bodyEl.querySelector<FakeElement>(
      "#drawer-billing-error"
    )!;
    expect(formError.className).toContain("notice-danger");
    expect(formError.hidden).toBe(true);

    const saveBtn = harness.footerEl.querySelector(".btn-primary")!;
    saveBtn.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(emailInput.getAttribute("aria-invalid")).toBe("true");
    expect(emailInput.getAttribute("aria-describedby")).toBe(
      "drawer-billingEmail-error"
    );
    expect(
      harness.bodyEl.querySelector("#drawer-billingEmail-error")?.textContent
    ).toBe("Invalid email address");
    expect(emailInput.focusCount).toBe(1);
    expect(formError.hidden).toBe(true);

    emailInput.dispatch("input");
    expect(emailInput.hasAttribute("aria-invalid")).toBe(false);
    expect(emailInput.hasAttribute("aria-describedby")).toBe(false);

    // Delayed rejection after user edits email does not re-mark or refocus.
    mode = "delayed";
    emailInput.value = "bad";
    const emailFocusBeforeDelayed = emailInput.focusCount;
    saveBtn.dispatch("click");
    emailInput.value = "good@example.com";
    emailInput.dispatch("input");
    resolveUpdate!({
      error: {
        type: "input",
        message: "Validation error",
        fields: { billingEmail: ["Invalid email address"] },
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(emailInput.hasAttribute("aria-invalid")).toBe(false);
    expect(emailInput.hasAttribute("aria-describedby")).toBe(false);
    expect(emailInput.focusCount).toBe(emailFocusBeforeDelayed);
    expect(formError.hidden).toBe(true);

    mode = "general";
    saveBtn.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    expect(formError.hidden).toBe(false);
    expect(formError.textContent).toBe("Dwelling archived");
  });

  it("aligns AdminContextDrawer CSS with --radius-input and shared label/error/notice classes", () => {
    const drawerAstro = readFileSync(
      resolve(root, "src/components/ui/AdminContextDrawer.astro"),
      "utf8"
    );
    expect(drawerAstro).not.toContain("--radius-control");
    expect(drawerAstro).not.toContain(".drawer-field-label");
    expect(drawerAstro).not.toContain(".drawer-field-error");
    expect(drawerAstro).toContain("var(--radius-input)");
  });
});
