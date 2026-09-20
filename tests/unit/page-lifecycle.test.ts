import { afterEach, describe, expect, it, vi } from "vitest";
import { onPageLoad } from "../../src/lib/ui/page-lifecycle";

describe("admin page lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cleans the previous page binding before reinitializing", () => {
    const listeners = new Map<string, Array<() => void>>();
    vi.stubGlobal("document", {
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
});
