import { afterEach, expect, it, vi } from "vitest";

const { onPageLoad, getDrawerData } = vi.hoisted(() => ({
  onPageLoad: vi.fn(),
  getDrawerData: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../src/lib/ui/page-lifecycle", () => ({ onPageLoad }));
vi.mock("astro:actions", () => ({
  actions: { workbench: { getDrawerData } },
  isInputError: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

it("opens drawer links in place while preserving native modified-click navigation", async () => {
  const listeners = new Map<string, (event: MouseEvent) => void>();
  const node = { addEventListener: vi.fn(), replaceChildren: vi.fn() };
  const dialog = {
    ...node,
    dataset: {
      config: JSON.stringify({
        organizationId: "org",
        periodId: "selected-period",
        strings: {},
      }),
    },
    querySelector: () => node,
    showModal: vi.fn(),
  };
  vi.stubGlobal("document", {
    querySelector: () => dialog,
    addEventListener: (name: string, listener: (event: MouseEvent) => void) =>
      listeners.set(name, listener),
  });
  vi.stubGlobal("window", {
    location: {
      href: "http://localhost/dashboard?periodId=selected-period&lang=lv",
      search: "?periodId=selected-period&lang=lv",
    },
    addEventListener: vi.fn(),
  });
  const pushState = vi.fn();
  vi.stubGlobal("history", { pushState });
  class Anchor {
    dataset = { openDrawer: "readings", dwellingId: "dwelling" };
  }
  vi.stubGlobal("HTMLAnchorElement", Anchor);
  // Import inside the test: a top-level import registers onPageLoad before
  // the test starts, and vitest 5 clears mock calls between registration and run.
  await import("../../src/lib/ui/workbench-drawer");
  const cleanup = onPageLoad.mock.calls[0][0]();
  const click = listeners.get("click")!;
  const trigger = new Anchor();
  const event = {
    target: { closest: () => trigger },
    button: 0,
    preventDefault: vi.fn(),
  };

  for (const modifiers of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    click({ ...event, ...modifiers } as unknown as MouseEvent);
  }
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(dialog.showModal).not.toHaveBeenCalled();
  expect(pushState).not.toHaveBeenCalled();

  click(event as unknown as MouseEvent);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(dialog.showModal).toHaveBeenCalledOnce();
  expect(getDrawerData).toHaveBeenCalledWith({
    organizationId: "org",
    periodId: "selected-period",
    dwellingId: "dwelling",
  });
  const url = pushState.mock.calls[0][2] as URL;
  expect(url.searchParams.get("periodId")).toBe("selected-period");
  expect(url.searchParams.get("lang")).toBe("lv");
  expect(url.searchParams.get("drawer")).toBe("readings");
  expect(url.searchParams.get("dwelling")).toBe("dwelling");

  click({
    ...event,
    target: { closest: () => ({ dataset: trigger.dataset }) },
  } as unknown as MouseEvent);
  expect(getDrawerData).toHaveBeenCalledTimes(2);
  cleanup();
});
