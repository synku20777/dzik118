import { afterEach, describe, expect, it, vi } from "vitest";
import { onPageLoad } from "../../src/lib/ui/page-lifecycle";

describe("admin page lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cleans the previous page binding before reinitializing", () => {
    const listeners = new Map<string, Array<() => void>>();
    vi.stubGlobal("document", {
      querySelector: () => ({}),
      addEventListener: (name: string, listener: () => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      },
    });
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);

    onPageLoad(setup);
    listeners.get("astro:page-load")![0]();
    listeners.get("astro:page-load")![0]();
    listeners.get("astro:before-swap")![0]();

    expect(setup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it.each(["loading", "complete"])(
    "initializes a %s document without ClientRouter",
    (readyState) => {
      const listeners = new Map<string, () => void>();
      vi.stubGlobal("document", {
        readyState,
        querySelector: () => null,
        addEventListener: (name: string, listener: () => void) =>
          listeners.set(name, listener),
      });
      const cleanup = vi.fn();
      const setup = vi.fn(() => cleanup);
      onPageLoad(setup);
      if (readyState === "loading") {
        expect(setup).not.toHaveBeenCalled();
        listeners.get("DOMContentLoaded")!();
      }
      expect(setup).toHaveBeenCalledTimes(1);
      listeners.get("astro:before-swap")!();
      expect(cleanup).toHaveBeenCalledTimes(1);
    }
  );
});
