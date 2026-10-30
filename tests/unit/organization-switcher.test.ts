import { afterEach, expect, it, vi } from "vitest";
import { bindOrganizationSwitcher } from "../../src/lib/ui/organization-switcher";

afterEach(() => vi.unstubAllGlobals());

it("closes on outside clicks, navigation and Escape, restoring keyboard focus only on Escape", () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const removeEventListener = vi.fn();
  vi.stubGlobal("document", {
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      listeners.set(name, listener),
    removeEventListener,
  });
  class FakeElement {
    constructor(private link = false) {}
    closest() {
      return this.link ? {} : null;
    }
  }
  vi.stubGlobal("Element", FakeElement);
  const inside = new FakeElement();
  const link = new FakeElement(true);
  const focus = vi.fn();
  const details = {
    open: true,
    contains: (target: unknown) => target === inside || target === link,
    querySelector: () => ({ focus }),
  };
  const cleanup = bindOrganizationSwitcher(
    details as unknown as HTMLDetailsElement
  );
  listeners.get("click")!({ target: inside });
  expect(details.open).toBe(true);
  listeners.get("click")!({ target: {} });
  expect(details.open).toBe(false);
  expect(focus).not.toHaveBeenCalled();
  details.open = true;
  listeners.get("click")!({ target: link });
  expect(details.open).toBe(false);
  details.open = true;
  listeners.get("keydown")!({ key: "Tab" });
  expect(details.open).toBe(true);
  const preventDefault = vi.fn();
  listeners.get("keydown")!({ key: "Escape", preventDefault });
  expect(details.open).toBe(false);
  expect(focus).toHaveBeenCalledOnce();
  listeners.get("keydown")!({ key: "Escape", preventDefault });
  expect(focus).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
  cleanup();
  expect(removeEventListener).toHaveBeenCalledWith(
    "click",
    listeners.get("click")
  );
  expect(removeEventListener).toHaveBeenCalledWith(
    "keydown",
    listeners.get("keydown")
  );
});
