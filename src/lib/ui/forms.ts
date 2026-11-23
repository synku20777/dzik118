// Delegation keeps these links working after Astro swaps route content.
document.addEventListener("click", (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>(
    "[data-open-details]"
  );
  if (!link) return;
  const details = document.getElementById(link.dataset.openDetails!);
  if (details instanceof HTMLDetailsElement) details.open = true;
});
// `data-confirm="message"` on a form or its submit button asks in a modal card
// before submitting: the first sentence is the title, the rest the text. The
// confirm button repeats the submitter's own label, and is a danger button when
// the submitter is one (or carries data-confirm-tone="danger"). Capture phase,
// so it runs before any other submit handler.
const DANGER =
  '.btn-danger, .menu-danger, .dropdown-item-danger, [data-confirm-tone="danger"]';
let confirmedForm: HTMLFormElement | null = null;

function confirmDialog(): HTMLDialogElement {
  const existing = document.getElementById("confirm-dialog");
  if (existing instanceof HTMLDialogElement) return existing;
  // ClientRouter swaps the whole <body>, which drops the old dialog.
  const dialog = document.createElement("dialog");
  dialog.id = "confirm-dialog";
  dialog.className = "modal-card";
  dialog.setAttribute("aria-labelledby", "confirm-dialog-title");
  dialog.innerHTML = `<div class="modal-card-body">
  <h2 id="confirm-dialog-title"></h2>
  <p id="confirm-dialog-text"></p>
</div>
<form method="dialog" class="modal-card-foot">
  <button value="confirm" data-confirm-ok></button>
  <button value="cancel" class="btn-ghost" autofocus data-confirm-cancel></button>
</form>`;
  // appendChild, not append(): see invoice-template-editor.ts.
  document.body.appendChild(dialog);
  return dialog;
}

function askToConfirm(
  message: string,
  submitter: HTMLElement | null,
  form: HTMLFormElement
): Promise<boolean> {
  const dialog = confirmDialog();
  const [, title = message, rest = ""] =
    /^(.+?[?.!])\s+(.+)$/s.exec(message) ?? [];
  dialog.querySelector("#confirm-dialog-title")!.textContent = title;
  const text = dialog.querySelector<HTMLElement>("#confirm-dialog-text")!;
  text.textContent = rest;
  text.hidden = !rest;
  if (rest) dialog.setAttribute("aria-describedby", text.id);
  else dialog.removeAttribute("aria-describedby");
  const ok = dialog.querySelector<HTMLButtonElement>("[data-confirm-ok]")!;
  const label =
    submitter instanceof HTMLInputElement
      ? submitter.value
      : submitter?.textContent?.trim();
  ok.textContent = label || document.body.dataset.confirmLabel || "Confirm";
  ok.className =
    submitter?.matches(DANGER) || form.matches(DANGER)
      ? "btn-danger"
      : "btn-primary";
  dialog.querySelector("[data-confirm-cancel]")!.textContent =
    document.body.dataset.cancelLabel || "Cancel";
  dialog.returnValue = "";
  // Reserved until its close event is handled: close() hides the dialog at
  // once but fires "close" a task later, and a question asked in between
  // would take that answer too.
  dialog.dataset.asking = "";
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => {
        delete dialog.dataset.asking;
        resolve(dialog.returnValue === "confirm");
      },
      { once: true }
    )
  );
}

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target as HTMLFormElement;
    const submitter = event.submitter as HTMLElement | null;
    const message = submitter?.dataset.confirm ?? form.dataset.confirm;
    if (!message || confirmedForm === form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // While a confirmation is pending, another submit is dropped, so one
    // answer can never submit two forms. The state lives on the dialog, so a
    // page swap that removes it mid-question cannot leave this stuck.
    const pending = document.getElementById("confirm-dialog");
    if (
      pending &&
      (pending.hasAttribute("open") || "asking" in pending.dataset)
    )
      return;
    void askToConfirm(message, submitter, form).then((ok) => {
      if (!ok || !form.isConnected) return;
      // requestSubmit dispatches synchronously, so the flag covers exactly
      // this one submit, even if validation stops it.
      confirmedForm = form;
      try {
        if (
          submitter instanceof HTMLButtonElement ||
          submitter instanceof HTMLInputElement
        ) {
          form.requestSubmit(submitter);
        } else {
          form.requestSubmit();
        }
      } finally {
        confirmedForm = null;
      }
    });
  },
  true
);
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (
    !(form instanceof HTMLFormElement) ||
    form.method.toLowerCase() !== "post" ||
    event.defaultPrevented
  )
    return;
  if (form.getAttribute("aria-busy") === "true") {
    event.preventDefault();
    return;
  }
  form.setAttribute("aria-busy", "true");
  const submitter = event.submitter;
  if (submitter instanceof HTMLButtonElement) {
    submitter.dataset.originalLabel = submitter.textContent ?? "";
    submitter.textContent = document.body.dataset.workingLabel ?? "Working…";
    queueMicrotask(() => (submitter.disabled = true));
  }
});
function resetBusyForms() {
  document.querySelectorAll('form[aria-busy="true"]').forEach((form) => {
    form.removeAttribute("aria-busy");
    // form.elements also holds a submitter outside the form (form="…").
    const submitter = [...(form as HTMLFormElement).elements].find(
      (el): el is HTMLButtonElement =>
        el instanceof HTMLButtonElement && "originalLabel" in el.dataset
    );
    if (submitter) {
      submitter.textContent = submitter.dataset.originalLabel ?? "";
      submitter.disabled = false;
      delete submitter.dataset.originalLabel;
    }
  });
}

window.addEventListener("pageshow", resetBusyForms);
document.addEventListener("astro:page-load", resetBusyForms);
