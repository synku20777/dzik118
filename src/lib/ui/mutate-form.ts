// Shared "submit once, patch DOM from the authoritative server result, no
// full-page reload" pattern for small admin create/remove forms (meters,
// resident access, ...). Deliberately thin -- not a generic form
// framework. Each caller still owns its own success/error DOM patching;
// this only owns the pending-state guard and the single Action call.
//
// Listening on the form's "submit" event (not a button click handler) is
// what guarantees there is exactly one code path for both a mouse click on
// the submit button and pressing Enter in a text field -- both fire the
// same native "submit" event, so there is nothing to accidentally wire
// twice, and a second submit while one is already in flight is ignored
// outright (the `pending` guard below), not merely slowed down.
import { isInputError, type ActionError } from "astro:actions";

export interface MutateFormConfig<T> {
  form: HTMLFormElement;
  action: (input: FormData) => Promise<{ data?: T; error?: ActionError }>;
  savingLabel: string;
  onSuccess: (data: T, form: HTMLFormElement) => void;
  fallbackErrorMessage: string;
}

export function bindMutationForm<T>(config: MutateFormConfig<T>): void {
  const { form, action, savingLabel, onSuccess, fallbackErrorMessage } = config;
  const submitButton = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );
  const originalLabel = submitButton?.textContent ?? "";
  let pending = false;
  let errorEl: HTMLElement | null = null;

  function clearError() {
    errorEl?.remove();
    errorEl = null;
  }

  function showError(message: string) {
    clearError();
    const el = document.createElement("p");
    el.className = "notice notice-danger form-inline-error";
    el.setAttribute("role", "alert");
    el.textContent = message;
    form.insertAdjacentElement("beforebegin", el);
    errorEl = el;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    clearError();
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute("aria-disabled", "true");
      submitButton.textContent = savingLabel;
    }

    void action(new FormData(form))
      .then(({ data, error }) => {
        if (error) {
          // Never the raw ActionInputError JSON: a field-level message is
          // always a clean Zod validation sentence, never the top-level
          // "Failed to validate: [...]" blob. A path-less Zod issue (rare,
          // but possible from an object-level .refine()) leaves `.fields`
          // present but empty -- fall back to the generic message in that
          // case too, never to `error.message` (which IS that raw blob for
          // an input error). Only a genuine non-input ActionError (thrown
          // by the domain layer, already a safe human sentence -- see
          // src/actions/_errors.ts) uses `.message` directly.
          const message = isInputError(error)
            ? (Object.values(error.fields)[0]?.[0] ?? fallbackErrorMessage)
            : error.message;
          showError(message || fallbackErrorMessage);
          return;
        }
        onSuccess(data as T, form);
      })
      .catch(() => showError(fallbackErrorMessage))
      .finally(() => {
        pending = false;
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute("aria-disabled");
          submitButton.textContent = originalLabel;
        }
      });
  });
}

// Small transient success acknowledgement ("Meter added") -- not a global
// toast stack, just one auto-dismissing inline notice per call site.
export function showMutationSuccess(anchor: Element, message: string): void {
  const el = document.createElement("p");
  el.className = "notice mutation-success";
  el.setAttribute("role", "status");
  el.textContent = message;
  anchor.insertAdjacentElement("afterend", el);
  window.setTimeout(() => el.remove(), 4000);
}

// Astro's scoped <style> blocks compile every selector to also require a
// `data-astro-cid-*` attribute, and stamp that same attribute onto every
// element the page's own template renders -- a class name alone is not
// enough for an element created client-side via document.createElement to
// pick up that page's scoped CSS. `anchor` must be an element Astro itself
// rendered from this same file (any element in the template works, since
// the attribute is identical across the whole file); every element built
// to look like a fresh copy of that markup needs the same attribute
// applied via this helper.
export function copyAstroScope(anchor: Element, ...targets: Element[]): void {
  const scopeAttr = Array.from(anchor.attributes).find((attr) =>
    attr.name.startsWith("data-astro-cid-")
  );
  if (!scopeAttr) return;
  for (const target of targets) {
    target.setAttribute(scopeAttr.name, scopeAttr.value);
  }
}
