import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCollectionLedgers } from "../../src/lib/ui/collection-ledger";

interface MockLedger {
  el: HTMLElement & {
    open: boolean;
    dataset: Record<string, string | undefined>;
    summaryDisplay: string;
    querySelector: (selector: string) => object | null;
  };
}

function createMockLedger(open = true, summaryDisplay = "none"): MockLedger {
  const dataset: Record<string, string | undefined> = {};
  const summary = {};
  const el = {
    id: "",
    open,
    dataset,
    summaryDisplay,
    querySelector: (selector: string) =>
      selector === ":scope > summary" ? summary : null,
  } as MockLedger["el"];
  return { el };
}

describe("collection ledger responsive disclosure", () => {
  let callbacks: Array<
    (
      entries: Array<{ target: unknown; contentRect: { width: number } }>
    ) => void
  > = [];
  let observed: unknown[] = [];
  let events: EventTarget;
  let ledgers: MockLedger[] = [];

  beforeEach(() => {
    callbacks = [];
    observed = [];
    events = new EventTarget();
    ledgers = [];

    class MockResizeObserver {
      constructor(
        cb: (
          entries: Array<{ target: unknown; contentRect: { width: number } }>
        ) => void
      ) {
        callbacks.push(cb);
      }
      observe(target: unknown) {
        observed.push(target);
      }
      disconnect() {
        observed = [];
      }
    }

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const summaryMap = new WeakMap<object, MockLedger["el"]>();
    vi.stubGlobal("getComputedStyle", (target: object) => {
      const owner = summaryMap.get(target);
      return {
        display: owner?.summaryDisplay ?? "none",
      } as CSSStyleDeclaration;
    });

    vi.stubGlobal("document", {
      querySelectorAll: () => ledgers.map((l) => l.el),
      addEventListener: events.addEventListener.bind(events),
    });

    (globalThis as Record<string, unknown>).__makeLedger = (
      open = true,
      summaryDisplay = "none"
    ) => {
      const m = createMockLedger(open, summaryDisplay);
      summaryMap.set(m.el.querySelector(":scope > summary")!, m.el);
      ledgers.push(m);
      return m.el;
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__makeLedger;
    vi.unstubAllGlobals();
  });

  const makeLedger = (open = true, summaryDisplay = "none") =>
    (
      globalThis as unknown as {
        __makeLedger: (
          open?: boolean,
          summaryDisplay?: string
        ) => MockLedger["el"];
      }
    ).__makeLedger(open, summaryDisplay);

  const fireResize = (target: MockLedger["el"], width = 360) => {
    for (const cb of callbacks) {
      cb([{ target, contentRect: { width } }]);
    }
  };

  it("collapses once on narrow layouts and stays open when the user opens it", () => {
    const ledger = makeLedger(true, "flex");
    const stop = initCollectionLedgers();

    expect(observed).toEqual([ledger]);
    fireResize(ledger, 360);
    expect(ledger.open).toBe(false);
    expect(ledger.dataset.collapsed).toBe("1");

    // Simulate the user clicking <summary> to expand it, causing another resize.
    ledger.open = true;
    fireResize(ledger, 360);
    expect(ledger.open).toBe(true);
    expect(ledger.dataset.collapsed).toBe("1");

    stop();
  });

  it("forces open on wide layouts and re-collapses on a subsequent narrow cycle", () => {
    const ledger = makeLedger(true, "flex");
    const stop = initCollectionLedgers();

    fireResize(ledger, 360);
    expect(ledger.open).toBe(false);

    ledger.summaryDisplay = "none";
    fireResize(ledger, 800);
    expect(ledger.open).toBe(true);
    expect("collapsed" in ledger.dataset).toBe(false);

    ledger.summaryDisplay = "flex";
    fireResize(ledger, 360);
    expect(ledger.open).toBe(false);
    expect(ledger.dataset.collapsed).toBe("1");

    stop();
  });

  it("skips zero-width resize entries and re-watches on workbench:refreshed", () => {
    const ledger1 = makeLedger(true, "flex");
    const stop = initCollectionLedgers();

    fireResize(ledger1, 0);
    expect(ledger1.open).toBe(true);
    expect("collapsed" in ledger1.dataset).toBe(false);

    const ledger2 = makeLedger(true, "flex");
    events.dispatchEvent(new Event("workbench:refreshed"));
    expect(observed).toEqual([ledger1, ledger2]);

    stop();
    expect(observed).toEqual([]);
    events.dispatchEvent(new Event("workbench:refreshed"));
    expect(observed).toEqual([]);
  });

  it("restores only initialized narrow ledgers with a matching ID after refresh", () => {
    const first = makeLedger(true, "flex");
    first.id = "first";
    const second = makeLedger(true, "flex");
    second.id = "second";
    const wide = makeLedger();
    wide.id = "wide";
    const anonymous = makeLedger(true, "flex");
    const stop = initCollectionLedgers();
    fireResize(first);
    fireResize(second);
    fireResize(wide, 800);
    fireResize(anonymous);
    first.open = true;
    anonymous.open = true;

    ledgers = [];
    const replacementSecond = makeLedger(true, "flex");
    replacementSecond.id = "second";
    const replacementFirst = makeLedger(true, "flex");
    replacementFirst.id = "first";
    const unrelated = makeLedger(true, "flex");
    unrelated.id = "new-period";
    const replacementWide = makeLedger(true, "flex");
    replacementWide.id = "wide";
    const replacementAnonymous = makeLedger(true, "flex");
    events.dispatchEvent(new Event("workbench:refreshed"));
    fireResize(replacementSecond);
    fireResize(replacementFirst);
    fireResize(unrelated);
    fireResize(replacementWide);
    fireResize(replacementAnonymous);

    expect(replacementFirst.open).toBe(true);
    expect(replacementSecond.open).toBe(false);
    expect(unrelated.open).toBe(false);
    expect(replacementWide.open).toBe(false);
    expect(replacementAnonymous.open).toBe(false);
    replacementFirst.summaryDisplay = "none";
    fireResize(replacementFirst, 800);
    replacementFirst.summaryDisplay = "flex";
    fireResize(replacementFirst);
    expect(replacementFirst.open).toBe(false);
    stop();
  });

  it("releases observers and refresh listeners when aborted", () => {
    const ledger = makeLedger(true, "flex");
    const controller = new AbortController();
    initCollectionLedgers(document, controller.signal);
    expect(observed).toEqual([ledger]);
    controller.abort();
    fireResize(ledger);
    events.dispatchEvent(new Event("workbench:refreshed"));

    expect(ledger.open).toBe(true);
    expect(observed).toEqual([]);
    initCollectionLedgers(document, controller.signal);
    expect(callbacks).toHaveLength(1);
  });
});
