import { expect, it, vi } from "vitest";
import { bindChargePresets } from "../../src/lib/ui/setup-charges";

it("only submits selected charges, requires their prices, and preserves values when toggled", () => {
  const checkbox = { checked: false };
  const fields = { disabled: false };
  const price = { required: false, value: "12,50" };
  const button = { disabled: false };
  const preset = {
    querySelector: (selector: string) =>
      selector === 'input[type="checkbox"]'
        ? checkbox
        : selector === ".setup-preset-fields"
          ? fields
          : price,
  };
  let change = () => {};
  const form = {
    querySelectorAll: () => [preset, { querySelector: () => null }],
    querySelector: () => button,
    addEventListener: (_: string, fn: () => void) => {
      change = fn;
    },
    removeEventListener: vi.fn(),
  };
  const cleanup = bindChargePresets(form as unknown as HTMLFormElement);
  expect(fields.disabled).toBe(true);
  expect(price.required).toBe(false);
  expect(button.disabled).toBe(true);
  checkbox.checked = true;
  change();
  expect(fields.disabled).toBe(false);
  expect(price.required).toBe(true);
  expect(button.disabled).toBe(false);
  checkbox.checked = false;
  change();
  expect(fields.disabled).toBe(true);
  expect(price.value).toBe("12,50");
  cleanup();
  expect(form.removeEventListener).toHaveBeenCalledWith("change", change);
});
