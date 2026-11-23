// A retry from the mutation status must run the same confirmation the first
// submit did. src/lib/ui/forms.ts reads data-confirm from the event's
// submitter, so the retry has to hand the submitter back to requestSubmit.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindMutationForm } from "../../src/lib/ui/mutate-form";

vi.mock("astro:actions", () => ({ isInputError: () => false }));

const startMutation = vi.fn();
vi.mock("../../src/lib/ui/mutations", () => ({
  completeMutation: vi.fn(),
  confirmMutation: vi.fn(),
  createMutationId: () => "m1",
  failMutation: vi.fn(),
  failReconciliation: vi.fn(),
  markOutcomeUnknown: vi.fn(),
  markReconciling: vi.fn(),
  markVerifying: vi.fn(),
  runMutationRecovery: vi.fn(),
  startMutation: (options: unknown) => startMutation(options),
}));

function setup(submitter: unknown, extra: { retryable?: boolean } = {}) {
  let submitHandler: ((event: unknown) => void) | null = null;
  const form = {
    querySelector: vi.fn(() => ({
      disabled: false,
      textContent: "Save",
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    })),
    addEventListener: vi.fn((name: string, handler: typeof submitHandler) => {
      if (name === "submit") submitHandler = handler;
    }),
    requestSubmit: vi.fn(),
    insertAdjacentElement: vi.fn(),
  };
  bindMutationForm({
    form: form as never,
    action: vi.fn().mockResolvedValue({ error: { message: "no" } }),
    savingLabel: "Saving…",
    fallbackErrorMessage: "Failed",
    mutation: () => ({
      entity: "meter",
      operation: "archive",
      pendingLabel: "Archiving…",
      successLabel: "Archived",
      errorLabel: "Could not archive",
      ...extra,
    }),
    onSuccess: vi.fn(),
  });
  submitHandler!({ preventDefault: vi.fn(), submitter });
  const retry = startMutation.mock.calls.at(-1)![0].retry as () => void;
  return { form, retry };
}

describe("bindMutationForm retry", () => {
  beforeEach(() => {
    startMutation.mockClear();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ setAttribute: vi.fn(), remove: vi.fn() })),
    });
    vi.stubGlobal("FormData", class {});
    vi.stubGlobal("performance", { mark: vi.fn(), measure: vi.fn() });
  });

  it("resubmits with the original submitter so its data-confirm runs again", () => {
    const submitter = { isConnected: true, form: null as unknown };
    const { form, retry } = setup(submitter);
    submitter.form = form;
    retry();
    expect(form.requestSubmit).toHaveBeenCalledWith(submitter);
  });

  it("falls back to a plain requestSubmit (the form's own data-confirm) when the submitter is gone", () => {
    const { form, retry } = setup({ isConnected: false, form: null });
    retry();
    expect(form.requestSubmit).toHaveBeenCalledWith();
  });

  it("is a plain requestSubmit for a submit without a submitter", () => {
    const { form, retry } = setup(null);
    retry();
    expect(form.requestSubmit).toHaveBeenCalledWith();
  });

  it("offers no retry for a change the server cannot recognise as a repeat", () => {
    const { retry } = setup(null, { retryable: false });
    expect(retry).toBeUndefined();
  });
});
