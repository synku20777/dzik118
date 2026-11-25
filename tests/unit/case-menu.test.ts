import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPopoverInvoker,
  initCaseMenus,
  positionCaseMenu,
} from "../../src/lib/ui/case-menu";

interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

function makeRect(
  top: number,
  left: number,
  width: number,
  height: number
): Rect {
  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

class MockElement {
  id = "";
  isConnected = true;
  parentElement: MockElement | null = null;
  classSet = new Set<string>();
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  offsetWidth = 0;
  offsetHeight = 0;
  rect: Rect = makeRect(0, 0, 0, 0);
  popoverOpen = false;
  hiddenCalls = 0;
  computedStyle: { overflowX: string; overflowY: string } = {
    overflowX: "visible",
    overflowY: "visible",
  };
  children: MockElement[] = [];

  classList = {
    contains: (cls: string) => this.classSet.has(cls),
    add: (cls: string) => {
      this.classSet.add(cls);
    },
  };

  getBoundingClientRect() {
    return this.rect;
  }

  hidePopover() {
    this.popoverOpen = false;
    this.hiddenCalls += 1;
  }

  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }

  contains(other: unknown): boolean {
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }

  closest(selector: string): MockElement | null {
    if (selector === "[popovertarget]" && this.attrs.has("popovertarget")) {
      return this;
    }
    if (selector === ".case-menu" && this.classSet.has("case-menu")) {
      return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }

  matches(selector: string): boolean {
    if (selector === ":popover-open") return this.popoverOpen;
    if (selector === ".case-menu:popover-open")
      return this.classSet.has("case-menu") && this.popoverOpen;
    return false;
  }

  querySelector<T>(selector: string): T | null {
    return (this.querySelectorAll<T>(selector)[0] ?? null) as T | null;
  }

  querySelectorAll<T>(selector: string): T[] {
    const out: MockElement[] = [];
    const visit = (el: MockElement) => {
      for (const child of el.children) {
        if (selector === ".case-menu:popover-open") {
          if (child.matches(selector)) out.push(child);
        } else if (selector.startsWith('[popovertarget="')) {
          const match = /popovertarget="([^"]+)"/.exec(selector);
          const id = match?.[1]?.replace(/\\/g, "");
          if (
            id &&
            child.attrs.get("popovertarget") === id &&
            child.attrs.get("popovertargetaction") !== "hide"
          ) {
            out.push(child);
          }
        }
        visit(child);
      }
    };
    visit(this);
    return out as unknown as T[];
  }
}

class MockHTMLElement extends MockElement {}

describe("case-menu positioning and lifecycle", () => {
  let docListeners: Map<string, Set<(e: unknown) => void>>;
  let winListeners: Map<string, Set<(e: unknown) => void>>;
  let body: MockHTMLElement;
  let elementsById: Map<string, MockHTMLElement>;

  beforeEach(() => {
    docListeners = new Map();
    winListeners = new Map();
    body = new MockHTMLElement();
    elementsById = new Map();

    vi.stubGlobal("Element", MockElement);
    vi.stubGlobal("HTMLElement", MockHTMLElement);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);
    vi.stubGlobal("getComputedStyle", (el: MockElement) => el.computedStyle);
    vi.stubGlobal("document", {
      documentElement: body,
      body,
      getElementById: (id: string) => elementsById.get(id) ?? null,
      querySelector: (s: string) => body.querySelector(s),
      querySelectorAll: (s: string) => body.querySelectorAll(s),
      addEventListener: (
        type: string,
        fn: (e: unknown) => void,
        opts?: { signal?: AbortSignal }
      ) => {
        if (opts?.signal?.aborted) return;
        let set = docListeners.get(type);
        if (!set) {
          set = new Set();
          docListeners.set(type, set);
        }
        set.add(fn);
        opts?.signal?.addEventListener("abort", () => set?.delete(fn), {
          once: true,
        });
      },
    });
    vi.stubGlobal("window", {
      addEventListener: (
        type: string,
        fn: (e: unknown) => void,
        opts?: { signal?: AbortSignal }
      ) => {
        if (opts?.signal?.aborted) return;
        let set = winListeners.get(type);
        if (!set) {
          set = new Set();
          winListeners.set(type, set);
        }
        set.add(fn);
        opts?.signal?.addEventListener("abort", () => set?.delete(fn), {
          once: true,
        });
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setupMenuPair(parent = body) {
    const trigger = new MockHTMLElement();
    trigger.attrs.set("popovertarget", "menu-1");
    trigger.rect = makeRect(64, 464, 36, 36);
    trigger.parentElement = parent;
    parent.children.push(trigger);

    const menu = new MockHTMLElement();
    menu.id = "menu-1";
    menu.classList.add("case-menu");
    menu.offsetWidth = 200;
    menu.offsetHeight = 120;
    // Simulate scaled frame-0 panel-in transform bounding box (4% smaller).
    menu.rect = makeRect(0, 0, 192, 115);
    menu.parentElement = parent;
    parent.children.push(menu);
    elementsById.set(menu.id, menu);
    return { trigger, menu };
  }

  function dispatch(type: string, event: Record<string, unknown>) {
    for (const fn of docListeners.get(type) ?? []) {
      fn(event);
    }
  }

  it("uses unscaled offsetWidth/offsetHeight instead of transformed getBoundingClientRect", () => {
    const { trigger, menu } = setupMenuPair();
    positionCaseMenu(
      menu as unknown as HTMLElement,
      trigger as unknown as HTMLElement
    );
    // anchor.right = 500; offsetWidth = 200 -> left = 300px (not 500 - 192 = 308px).
    expect(menu.style.left).toBe("300px");
    expect(menu.style.top).toBe("106px");
    expect(menu.dataset.placement).toBe("bottom");
  });

  it("flips upward with data-placement='top' when bottom overflows viewport", () => {
    const { trigger, menu } = setupMenuPair();
    trigger.rect = makeRect(684, 464, 36, 36); // bottom = 720, below + 120 > 760
    positionCaseMenu(
      menu as unknown as HTMLElement,
      trigger as unknown as HTMLElement
    );
    expect(menu.dataset.placement).toBe("top");
    // top = 684 - 120 - 6 = 558px
    expect(menu.style.top).toBe("558px");
  });

  it("prefers the remembered invoker and falls back only to external opening triggers", () => {
    const { trigger, menu } = setupMenuPair();
    const close = new MockHTMLElement();
    close.attrs.set("popovertarget", menu.id);
    close.attrs.set("popovertargetaction", "hide");
    const internal = new MockHTMLElement();
    internal.attrs.set("popovertarget", menu.id);
    menu.children.push(internal);
    const opener = new MockHTMLElement();
    opener.attrs.set("popovertarget", menu.id);
    body.children.push(close, opener);

    const stop = initCaseMenus();
    dispatch("click", { target: opener });
    menu.popoverOpen = true;
    dispatch("click", { target: trigger });
    expect(getPopoverInvoker(menu as unknown as HTMLElement)).toBe(opener);

    opener.isConnected = false;
    body.children.pop();
    expect(getPopoverInvoker(menu as unknown as HTMLElement)).toBe(trigger);
    body.children.shift();
    expect(getPopoverInvoker(menu as unknown as HTMLElement)).toBeNull();
    stop();
  });

  it("dismisses menu when trigger is clipped by a scrollable ancestor", () => {
    const scroller = new MockHTMLElement();
    scroller.computedStyle = { overflowX: "auto", overflowY: "visible" };
    scroller.rect = makeRect(0, 100, 500, 500);
    scroller.parentElement = body;
    body.children.push(scroller);

    const { trigger, menu } = setupMenuPair(scroller);
    // Inside viewport (left=10 >= 0), but scrolled left of scroller (right=46 <= 100).
    trigger.rect = makeRect(80, 10, 36, 36);

    positionCaseMenu(
      menu as unknown as HTMLElement,
      trigger as unknown as HTMLElement
    );
    expect(menu.hiddenCalls).toBe(1);
  });

  it("hides during beforetoggle open and reveals after toggle positioning", () => {
    const { trigger, menu } = setupMenuPair();
    const stop = initCaseMenus();

    dispatch("beforetoggle", {
      target: menu,
      newState: "open",
      source: trigger,
    });
    expect(menu.style.visibility).toBe("hidden");

    menu.popoverOpen = true;
    dispatch("toggle", { target: menu, newState: "open", source: trigger });
    expect(menu.style.visibility).toBe("");
    expect(menu.style.left).toBe("300px");
    expect(menu.dataset.placement).toBe("bottom");

    stop();
  });

  it("scopes handling to options.root and tears down listeners on AbortSignal", () => {
    const rootA = new MockHTMLElement();
    rootA.parentElement = body;
    body.children.push(rootA);
    const rootB = new MockHTMLElement();
    rootB.parentElement = body;
    body.children.push(rootB);

    const { trigger, menu } = setupMenuPair(rootB);
    const ac = new AbortController();
    initCaseMenus({ root: rootA as unknown as ParentNode, signal: ac.signal });

    // Outside rootA -> ignored.
    dispatch("beforetoggle", {
      target: menu,
      newState: "open",
      source: trigger,
    });
    expect(menu.style.visibility ?? "").toBe("");

    // Now test inside rootA and verify signal cleanup.
    const pairA = setupMenuPair(rootA);
    dispatch("beforetoggle", {
      target: pairA.menu,
      newState: "open",
      source: pairA.trigger,
    });
    expect(pairA.menu.style.visibility).toBe("hidden");

    ac.abort();
    pairA.menu.style.visibility = "";
    dispatch("beforetoggle", {
      target: pairA.menu,
      newState: "open",
      source: pairA.trigger,
    });
    expect(pairA.menu.style.visibility).toBe("");
  });

  it("clears pending beforetoggle visibility overrides if aborted before toggle", () => {
    const { trigger, menu } = setupMenuPair();
    const ac = new AbortController();
    initCaseMenus({ signal: ac.signal });

    dispatch("beforetoggle", {
      target: menu,
      newState: "open",
      source: trigger,
    });
    expect(menu.style.visibility).toBe("hidden");

    ac.abort();
    expect(menu.style.visibility).toBe("");
  });
});
