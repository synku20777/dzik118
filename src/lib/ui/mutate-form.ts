// Shared "submit once, patch DOM from the authoritative server result, no
// full-page reload" pattern for small admin create/remove forms. Each caller
// owns its DOM patch; this owns the pending guard, Action call, optional
// optimistic handle, and global mutation lifecycle.
//
// Listening on the form's "submit" event (not a button click handler) is
// what guarantees there is exactly one code path for both a mouse click on
// the submit button and pressing Enter in a text field -- both fire the
// same native "submit" event, so there is nothing to accidentally wire
// twice, and a second submit while one is already in flight is ignored
// outright (the `pending` guard below), not merely slowed down.
import { isInputError, type ActionError } from "astro:actions";
import {
  completeMutation,
  confirmMutation,
  createMutationId,
  failMutation,
  markOutcomeUnknown,
  markReconciling,
  markVerifying,
  runMutationRecovery,
  startMutation,
  type RecoveryResult,
} from "./mutations";

export interface MutationDescriptor {
  entity: string;
  operation: string;
  pendingLabel: string;
  successLabel: string;
  errorLabel: string;
  reconciliationErrorLabel?: string;
  idempotentCreate?: boolean;
  messageKey?: string;
  successMessageKey?: string;
  committedMissingLabel?: string;
}

export interface MutateFormConfig<T, Optimistic = undefined> {
  form: HTMLFormElement;
  action: (input: FormData) => Promise<{ data?: T; error?: ActionError }>;
  savingLabel: string;
  onSuccess: (
    data: T,
    form: HTMLFormElement,
    optimistic: Optimistic | undefined
  ) => void | Promise<void>;
  fallbackErrorMessage: string;
  mutation?: (formData: FormData) => MutationDescriptor;
  optimistic?: (
    formData: FormData,
    mutationId: string
  ) => Optimistic | undefined;
  onError?: (
    error: ActionError,
    form: HTMLFormElement,
    optimistic: Optimistic | undefined
  ) => void;
  recover?: (clientMutationId: string) => Promise<RecoveryResult>;
  onVerifying?: (optimistic: Optimistic | undefined, unknown: boolean) => void;
  onCommittedMissing?: (
    form: HTMLFormElement,
    optimistic: Optimistic | undefined
  ) => void | Promise<void>;
}

export function bindMutationForm<T, Optimistic = undefined>(
  config: MutateFormConfig<T, Optimistic>
): void {
  const { form, action, savingLabel, onSuccess, fallbackErrorMessage } = config;
  const submitButton = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );
  const originalLabel = submitButton?.textContent ?? "";
  let pending = false;
  let errorEl: HTMLElement | null = null;
  let clientMutationId: string | undefined;
  let logicalMutationId: string | undefined;

  function releaseForm() {
    pending = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-disabled");
      submitButton.textContent = originalLabel;
    }
  }

  function clearError() {
    errorEl?.remove();
    errorEl = null;
  }

  function showError(message: string) {
    clearError();
    if (form.isConnected === false) return;
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

    const formData = new FormData(form);
    const descriptor = config.mutation?.(formData);
    const mutationId = descriptor
      ? (logicalMutationId ??= createMutationId(
          descriptor.entity,
          descriptor.operation
        ))
      : undefined;
    if (descriptor?.idempotentCreate) {
      clientMutationId ??= crypto.randomUUID();
      formData.set("clientMutationId", clientMutationId);
    }
    if (descriptor && mutationId) {
      performance.mark(`${mutationId}:requested`);
      startMutation({
        id: mutationId,
        entity: descriptor.entity,
        operation: descriptor.operation,
        label: descriptor.pendingLabel,
        retry: () => form.requestSubmit(),
        messageKey: descriptor.messageKey,
        successMessageKey: descriptor.successMessageKey,
        recovery:
          descriptor.idempotentCreate && clientMutationId
            ? {
                organizationId: String(formData.get("organizationId") ?? ""),
                clientMutationId,
                originPath:
                  typeof location === "undefined"
                    ? "/"
                    : `${location.pathname}${location.search}`,
              }
            : undefined,
      });
    }
    const optimistic = mutationId
      ? config.optimistic?.(formData, mutationId)
      : undefined;
    if (mutationId) performance.mark(`${mutationId}:optimistic`);

    let serverConfirmed = false;
    let recovering = false;
    if (mutationId) performance.mark(`${mutationId}:request-sent`);
    void action(formData)
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
          const safeMessage = message || fallbackErrorMessage;
          showError(safeMessage);
          config.onError?.(error, form, optimistic);
          if (mutationId && descriptor) {
            failMutation(mutationId, safeMessage, descriptor.errorLabel);
            performance.mark(`${mutationId}:failed`);
          }
          return;
        }
        if (mutationId) {
          serverConfirmed = true;
          confirmMutation(mutationId);
          performance.mark(`${mutationId}:confirmed`);
          markReconciling(mutationId);
        }
        return Promise.resolve(onSuccess(data as T, form, optimistic)).then(
          () => {
            if (!mutationId || !descriptor) return;
            performance.mark(`${mutationId}:reconciled`);
            completeMutation(mutationId, descriptor.successLabel);
            clientMutationId = undefined;
            logicalMutationId = undefined;
            performance.mark(`${mutationId}:success`);
            performance.measure(
              `${descriptor.entity}:${descriptor.operation}:optimistic-feedback`,
              `${mutationId}:requested`,
              `${mutationId}:optimistic`
            );
            performance.measure(
              `${descriptor.entity}:${descriptor.operation}:server`,
              `${mutationId}:request-sent`,
              `${mutationId}:confirmed`
            );
            performance.measure(
              `${descriptor.entity}:${descriptor.operation}:reconciliation`,
              `${mutationId}:confirmed`,
              `${mutationId}:reconciled`
            );
          }
        );
      })
      .catch(() => {
        if (
          !serverConfirmed &&
          mutationId &&
          descriptor?.idempotentCreate &&
          clientMutationId &&
          config.recover
        ) {
          const missingLabel =
            descriptor.committedMissingLabel ??
            "The original change was saved, but the item is no longer present.";
          recovering = true;
          markVerifying(mutationId, descriptor.pendingLabel);
          config.onVerifying?.(optimistic, false);

          const recover = () => config.recover!(clientMutationId!);
          runMutationRecovery(mutationId, recover, {
            committed: async (entity) => {
              confirmMutation(mutationId);
              markReconciling(mutationId);
              if (entity === null) {
                await config.onCommittedMissing?.(form, optimistic);
                completeMutation(mutationId, missingLabel);
              } else {
                await onSuccess(entity as T, form, optimistic);
                completeMutation(mutationId, descriptor.successLabel);
              }
              clientMutationId = undefined;
              logicalMutationId = undefined;
              releaseForm();
            },
            unknown: (checkAgain) => {
              config.onVerifying?.(optimistic, true);
              markOutcomeUnknown(mutationId, () => {
                markVerifying(mutationId, descriptor.pendingLabel);
                config.onVerifying?.(optimistic, false);
                checkAgain();
              });
            },
          });
          return;
        }
        const message = serverConfirmed
          ? (descriptor?.reconciliationErrorLabel ??
            "Saved, but the view could not be updated")
          : fallbackErrorMessage;
        showError(message);
        const error = { message } as ActionError;
        if (!serverConfirmed) config.onError?.(error, form, optimistic);
        if (mutationId && descriptor) {
          failMutation(
            mutationId,
            message,
            serverConfirmed ? message : descriptor.errorLabel
          );
        }
      })
      .finally(() => {
        if (!recovering) releaseForm();
      });
  });
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
