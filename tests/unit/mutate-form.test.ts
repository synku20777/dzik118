// No jsdom in this project (vitest.config.ts's environment is "node", same
// as tests/unit/theme.test.ts) -- hand-rolled minimal DOM stand-ins for the
// handful of methods bindMutationForm actually calls, same convention
// theme.test.ts already established for testing DOM-touching client code.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindMutationForm, copyAstroScope } from "../../src/lib/ui/mutate-form";

vi.mock("astro:actions", () => ({
  isInputError: (error: unknown) =>
    typeof error === "object" && error !== null && "fields" in error,
}));

function makeButton() {
  return {
    disabled: false,
    textContent: "Save",
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
  };
}

function makeForm(button: ReturnType<typeof makeButton>) {
  let submitHandler: ((event: { preventDefault: () => void }) => void) | null =
    null;
  return {
    querySelector: vi.fn(() => button),
    addEventListener: vi.fn((event: string, handler: typeof submitHandler) => {
      if (event === "submit") submitHandler = handler;
    }),
    insertAdjacentElement: vi.fn(),
    // Test helper, not part of the real HTMLFormElement surface.
    triggerSubmit() {
      submitHandler?.({ preventDefault: vi.fn() });
    },
  };
}

describe("bindMutationForm", () => {
  let createdElements: Array<{ textContent: string; className: string }>;

  beforeEach(() => {
    createdElements = [];
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        const el = {
          textContent: "",
          className: "",
          setAttribute: vi.fn(),
          remove: vi.fn(),
        };
        createdElements.push(el);
        return el;
      }),
    });
    // The mock form below isn't a real HTMLFormElement, so the real
    // FormData constructor rejects it -- bindMutationForm only ever passes
    // this straight through to the given `action`, never inspects it.
    vi.stubGlobal(
      "FormData",
      class {
        constructor(public source: unknown) {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the action exactly once for a single submit", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const action = vi.fn().mockResolvedValue({ data: { id: "m1" } });
    const onSuccess = vi.fn();

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess,
      fallbackErrorMessage: "Something went wrong.",
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(action).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ id: "m1" }, form);
  });

  it("ignores a second submit while the first is still in flight (no duplicate mutation)", async () => {
    const button = makeButton();
    const form = makeForm(button);
    let resolveFirst!: (value: { data: { id: string } }) => void;
    const action = vi
      .fn<() => Promise<{ data: { id: string } }>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ data: { id: "m2" } });
    const onSuccess = vi.fn();

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess,
      fallbackErrorMessage: "Something went wrong.",
    });

    // Rapid double submit -- e.g. a double-click or Enter-then-click.
    form.triggerSubmit();
    form.triggerSubmit();
    form.triggerSubmit();

    expect(action).toHaveBeenCalledTimes(1);

    resolveFirst({ data: { id: "m1" } });
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    // Once settled, a genuinely new submit is allowed again -- and this
    // one resolves too, so no promise from this test is left dangling.
    form.triggerSubmit();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("disables the submit button immediately and re-enables it after success", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const action = vi.fn().mockResolvedValue({ data: {} });

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess: vi.fn(),
      fallbackErrorMessage: "Something went wrong.",
    });

    form.triggerSubmit();
    expect(button.disabled).toBe(true);
    expect(button.setAttribute).toHaveBeenCalledWith("aria-disabled", "true");
    expect(button.textContent).toBe("Saving…");

    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(button.removeAttribute).toHaveBeenCalledWith("aria-disabled");
    expect(button.textContent).toBe("Save");
  });

  it("does not call onSuccess on error, shows a message, and re-enables the form", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const action = vi
      .fn()
      .mockResolvedValue({ error: { message: "Something specific failed" } });
    const onSuccess = vi.fn();

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess,
      fallbackErrorMessage: "Something went wrong.",
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    expect(onSuccess).not.toHaveBeenCalled();
    expect(form.insertAdjacentElement).toHaveBeenCalled();
    const errorEl = createdElements[0];
    expect(errorEl.textContent).toBe("Something specific failed");
  });

  it("shows a field-level message, never the raw ActionInputError JSON, for a validation error", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const action = vi.fn().mockResolvedValue({
      error: {
        message: 'Failed to validate: [{"path":["unit"]}]',
        fields: { unit: ["Unit is required"] },
      },
    });

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess: vi.fn(),
      fallbackErrorMessage: "Something went wrong.",
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(createdElements.length).toBe(1));

    expect(createdElements[0].textContent).toBe("Unit is required");
    expect(createdElements[0].textContent).not.toContain("Failed to validate");
  });

  it("falls back to the generic message, never the raw message, when a validation error has no usable field message", async () => {
    const button = makeButton();
    const form = makeForm(button);
    // A path-less Zod issue (an object-level .refine() with no `path`)
    // leaves `fields` present but empty -- this must never fall through to
    // `error.message`, which for a real ActionInputError is the raw
    // "Failed to validate: [...]" JSON blob.
    const action = vi.fn().mockResolvedValue({
      error: {
        message: 'Failed to validate: [{"path":[]}]',
        fields: {},
      },
    });

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess: vi.fn(),
      fallbackErrorMessage: "Something went wrong.",
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(createdElements.length).toBe(1));

    expect(createdElements[0].textContent).toBe("Something went wrong.");
    expect(createdElements[0].textContent).not.toContain("Failed to validate");
  });

  it("allows a new submit after a failed one (form is not stuck disabled)", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const action = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "bad input" } })
      .mockResolvedValueOnce({ data: { id: "m1" } });
    const onSuccess = vi.fn();

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess,
      fallbackErrorMessage: "Something went wrong.",
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    form.triggerSubmit();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledTimes(2);
  });
});

describe("copyAstroScope", () => {
  function makeAttrEl(attrs: Record<string, string>) {
    return {
      attributes: Object.entries(attrs).map(([name, value]) => ({
        name,
        value,
      })),
    };
  }

  function makeTarget() {
    const attrs: Record<string, string> = {};
    return {
      setAttribute: vi.fn((name: string, value: string) => {
        attrs[name] = value;
      }),
      attrs,
    };
  }

  it("copies the anchor's data-astro-cid-* attribute onto every target", () => {
    const anchor = makeAttrEl({
      class: "panel",
      "data-astro-cid-ab12cd34": "",
    });
    const t1 = makeTarget();
    const t2 = makeTarget();

    copyAstroScope(anchor as never, t1 as never, t2 as never);

    expect(t1.setAttribute).toHaveBeenCalledWith("data-astro-cid-ab12cd34", "");
    expect(t2.setAttribute).toHaveBeenCalledWith("data-astro-cid-ab12cd34", "");
  });

  it("does nothing when the anchor has no scope attribute (e.g. in a test with no Astro build)", () => {
    const anchor = makeAttrEl({ class: "panel" });
    const target = makeTarget();

    expect(() =>
      copyAstroScope(anchor as never, target as never)
    ).not.toThrow();
    expect(target.setAttribute).not.toHaveBeenCalled();
  });
});
