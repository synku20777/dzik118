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
        values = new Map<string, unknown>();
        constructor(public source: unknown) {}
        set(name: string, value: unknown) {
          this.values.set(name, value);
        }
        get(name: string) {
          return this.values.get(name) ?? null;
        }
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
    expect(onSuccess).toHaveBeenCalledWith({ id: "m1" }, form, undefined);
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

  it("passes one optimistic handle through rollback when the Action fails", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const optimisticHandle = { id: "client:meter:1" };
    const optimistic = vi.fn(() => optimisticHandle);
    const onError = vi.fn();

    bindMutationForm({
      form: form as never,
      action: vi.fn().mockResolvedValue({
        error: { message: "Meter already exists" },
      }),
      savingLabel: "Saving…",
      fallbackErrorMessage: "Something went wrong.",
      mutation: () => ({
        entity: "meter",
        operation: "create",
        pendingLabel: "Adding meter…",
        successLabel: "Meter added",
        errorLabel: "Could not add meter",
      }),
      optimistic,
      onError,
      onSuccess: vi.fn(),
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    expect(optimistic).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      { message: "Meter already exists" },
      form,
      optimisticHandle
    );
  });

  it("reuses the server idempotency key and logical mutation ID after an unknown failure", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const mutationIds: string[] = [];
    const keys: unknown[] = [];
    const action = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network lost"))
      .mockImplementationOnce(
        async (formData: { get(name: string): unknown }) => {
          keys.push(formData.get("clientMutationId"));
          return { data: { id: "m1" } };
        }
      );

    bindMutationForm({
      form: form as never,
      action: (formData) => {
        keys.push(formData.get("clientMutationId"));
        return action(formData);
      },
      savingLabel: "Saving…",
      fallbackErrorMessage: "Could not save",
      mutation: () => ({
        entity: "meter",
        operation: "create",
        pendingLabel: "Adding meter…",
        successLabel: "Meter added",
        errorLabel: "Could not add meter",
        idempotentCreate: true,
      }),
      optimistic: (_formData, mutationId) => {
        mutationIds.push(mutationId);
        return undefined;
      },
      onSuccess: vi.fn(),
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    form.triggerSubmit();
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(2));

    expect(keys[0]).toBeTruthy();
    expect(keys[2]).toBe(keys[0]);
    expect(mutationIds[1]).toBe(mutationIds[0]);
  });

  it("keeps the optimistic entity while an unknown outcome is verified", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const optimisticHandle = { id: "client:meter:pending" };
    const onError = vi.fn();
    const onVerifying = vi.fn();
    const onSuccess = vi.fn();
    const recover = vi.fn().mockResolvedValue({
      state: "committed",
      entity: { id: "meter-1" },
    });

    bindMutationForm<{ id: string }, typeof optimisticHandle>({
      form: form as never,
      action: vi.fn().mockRejectedValue(new TypeError("response lost")),
      savingLabel: "Saving…",
      fallbackErrorMessage: "Could not save",
      mutation: () => ({
        entity: "meter",
        operation: "create",
        idempotentCreate: true,
        messageKey: "Adding meter…",
        successMessageKey: "Meter added",
        pendingLabel: "Adding meter…",
        successLabel: "Meter added",
        errorLabel: "Could not add meter",
      }),
      optimistic: () => optimisticHandle,
      recover,
      onVerifying,
      onError,
      onSuccess,
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    expect(onVerifying).toHaveBeenCalledWith(optimisticHandle, false);
    expect(onError).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith(
      { id: "meter-1" },
      form,
      optimisticHandle
    );
  });

  it("calls onSettled exactly once after success and after the submit button is re-enabled", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const action = vi.fn().mockResolvedValue({ data: { id: "m1" } });
    let buttonDisabledAtSettled: boolean | undefined;
    const onSettled = vi.fn(() => {
      buttonDisabledAtSettled = button.disabled;
    });

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess: vi.fn(),
      fallbackErrorMessage: "Something went wrong.",
      onSettled,
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));

    expect(buttonDisabledAtSettled).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("calls onSettled exactly once after error and after the submit button is re-enabled", async () => {
    const button = makeButton();
    const form = makeForm(button);
    const action = vi
      .fn()
      .mockResolvedValue({ error: { message: "Something failed" } });
    let buttonDisabledAtSettled: boolean | undefined;
    const onSettled = vi.fn(() => {
      buttonDisabledAtSettled = button.disabled;
    });

    bindMutationForm({
      form: form as never,
      action,
      savingLabel: "Saving…",
      onSuccess: vi.fn(),
      fallbackErrorMessage: "Something went wrong.",
      onSettled,
    });

    form.triggerSubmit();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));

    expect(buttonDisabledAtSettled).toBe(false);
    expect(button.disabled).toBe(false);
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
