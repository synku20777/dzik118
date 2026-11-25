import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCopyButtons } from "../../src/lib/ui/copy-field";

interface MockButton {
  hidden: boolean;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  labelSpan: { textContent: string };
  querySelector: (selector: string) => { textContent: string } | null;
  closest: (selector: string) => unknown;
  toggleAttribute: (name: string, force?: boolean) => boolean;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, fn: () => Promise<void> | void) => void;
  click: () => Promise<void>;
}

function createCopyButton(
  value: string,
  options: { hidden?: boolean; copiedLabel?: string } = {}
): MockButton {
  let clickHandler: (() => Promise<void> | void) | undefined;
  const labelSpan = { textContent: "Copy" };
  const attributes: Record<string, string> = {};
  const button: MockButton = {
    hidden: options.hidden ?? false,
    dataset: {
      copyValue: value,
      copiedLabel: options.copiedLabel ?? "Copied",
    },
    attributes,
    labelSpan,
    querySelector: (sel: string) => (sel === "span" ? labelSpan : null),
    closest: () => null,
    toggleAttribute: (name: string, force?: boolean) => {
      const next = force ?? !(name in attributes);
      if (next) attributes[name] = "";
      else delete attributes[name];
      return next;
    },
    removeAttribute: (name: string) => {
      delete attributes[name];
    },
    addEventListener: (type: string, fn: () => Promise<void> | void) => {
      if (type === "click") clickHandler = fn;
    },
    click: async () => {
      await clickHandler?.();
    },
  };
  return button;
}

describe("initCopyButtons", () => {
  let statusEl: { textContent: string; dataset: Record<string, string> };
  let buttons: MockButton[];
  let root: ParentNode;

  beforeEach(() => {
    vi.useFakeTimers();
    statusEl = {
      textContent: "",
      dataset: {
        copied: "Copied. Paste it into your bank's payment form.",
        copyFailed:
          "Could not copy. Select the details and copy them yourself.",
      },
    };
    buttons = [];
    root = {
      querySelectorAll: () => buttons,
      querySelector: () => statusEl,
    } as unknown as ParentNode;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("copies value, sets live status, and debounces label restoration across rapid clicks", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const btn = createCopyButton("LV80UNLA0050012345678", { hidden: true });
    buttons.push(btn);

    const stop = initCopyButtons(root);
    expect(btn.hidden).toBe(false);

    await btn.click();
    expect(writeText).toHaveBeenCalledWith("LV80UNLA0050012345678");
    expect(statusEl.textContent).toBe(statusEl.dataset.copied);
    expect("data-copied" in btn.attributes).toBe(true);
    expect(btn.labelSpan.textContent).toBe("Copied");

    vi.advanceTimersByTime(1500);
    await btn.click();
    vi.advanceTimersByTime(1000);
    expect("data-copied" in btn.attributes).toBe(true);
    expect(btn.labelSpan.textContent).toBe("Copied");

    vi.advanceTimersByTime(1000);
    expect("data-copied" in btn.attributes).toBe(false);
    expect(btn.labelSpan.textContent).toBe("Copy");

    stop();
  });

  it("announces failure when clipboard writeText rejects", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("Denied");
        }),
      },
    });
    const btn = createCopyButton("30.00");
    buttons.push(btn);

    const stop = initCopyButtons(root);
    await btn.click();
    expect(statusEl.textContent).toBe(statusEl.dataset.copyFailed);
    expect("data-copied" in btn.attributes).toBe(false);
    expect(btn.labelSpan.textContent).toBe("Copy");
    stop();
  });

  it("keeps hidden buttons and .resident-payment-action wrappers hidden without clipboard API", () => {
    vi.stubGlobal("navigator", {});
    const wrapper = {
      hidden: true,
      querySelector: () => statusEl,
    };
    const btn = createCopyButton("30.00", { hidden: true });
    btn.closest = (sel: string) =>
      sel.includes("resident-payment-action") ? wrapper : null;
    buttons.push(btn);

    const stop = initCopyButtons(root);
    expect(btn.hidden).toBe(true);
    expect(wrapper.hidden).toBe(true);
    stop();
  });

  it("unhides .resident-payment-action wrapper when clipboard API is present", () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => {}) },
    });
    const wrapper = { hidden: true };
    const btn = createCopyButton("30.00");
    btn.closest = (sel: string) =>
      sel.includes("resident-payment-action") ? wrapper : null;
    buttons.push(btn);

    const stop = initCopyButtons(root);
    expect(wrapper.hidden).toBe(false);
    expect(btn.hidden).toBe(false);
    stop();
  });

  it("clears data-copied, label, and pending timer when a follow-up copy fails", async () => {
    let shouldFail = false;
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          if (shouldFail) throw new Error("Denied");
        }),
      },
    });
    const btn = createCopyButton("LV80");
    buttons.push(btn);

    const stop = initCopyButtons(root);
    await btn.click();
    expect("data-copied" in btn.attributes).toBe(true);
    expect(btn.labelSpan.textContent).toBe("Copied");

    shouldFail = true;
    await btn.click();
    expect("data-copied" in btn.attributes).toBe(false);
    expect(btn.labelSpan.textContent).toBe("Copy");
    expect(statusEl.textContent).toBe(statusEl.dataset.copyFailed);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("resets live-region status before repeat copies and clears timers on AbortSignal", async () => {
    const history: string[] = [];
    let current = "";
    const trackedStatus = {
      dataset: statusEl.dataset,
      get textContent() {
        return current;
      },
      set textContent(v: string) {
        current = v;
        history.push(v);
      },
    };
    statusEl = trackedStatus;

    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => {}) },
    });
    const btn = createCopyButton("LV80");
    buttons.push(btn);
    const ac = new AbortController();

    initCopyButtons(root, { signal: ac.signal });
    await btn.click();
    await btn.click();
    expect(history).toEqual([
      "",
      statusEl.dataset.copied,
      "",
      statusEl.dataset.copied,
    ]);
    expect(vi.getTimerCount()).toBe(1);

    ac.abort();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores resolved or rejected clipboard writes after AbortSignal teardown", async () => {
    let resolveWrite!: () => void;
    let rejectWrite!: (err: Error) => void;
    let call = 0;
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(
          () =>
            new Promise<void>((resolve, reject) => {
              call += 1;
              if (call === 1) resolveWrite = resolve;
              else rejectWrite = reject;
            })
        ),
      },
    });

    const btnA = createCopyButton("LV80-A");
    buttons.push(btnA);
    const acA = new AbortController();
    initCopyButtons(root, { signal: acA.signal });
    const pendingA = btnA.click();
    expect(statusEl.textContent).toBe("");
    acA.abort();
    resolveWrite();
    await pendingA;
    expect(statusEl.textContent).toBe("");
    expect("data-copied" in btnA.attributes).toBe(false);
    expect(btnA.labelSpan.textContent).toBe("Copy");
    expect(vi.getTimerCount()).toBe(0);

    buttons = [];
    const btnB = createCopyButton("LV80-B");
    buttons.push(btnB);
    const acB = new AbortController();
    initCopyButtons(root, { signal: acB.signal });
    const pendingB = btnB.click();
    acB.abort();
    rejectWrite(new Error("Denied"));
    await pendingB;
    expect(statusEl.textContent).toBe("");
    expect("data-copied" in btnB.attributes).toBe(false);
    expect(btnB.labelSpan.textContent).toBe("Copy");
    expect(vi.getTimerCount()).toBe(0);
  });
});
