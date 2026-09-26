// Delegation keeps these links working after Astro swaps route content.
document.addEventListener("click", (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>(
    "[data-open-details]"
  );
  if (!link) return;
  const details = document.getElementById(link.dataset.openDetails!);
  if (details instanceof HTMLDetailsElement) details.open = true;
});
// `data-confirm="message"` on a form or its submit button asks before
// submitting. Capture phase, so it runs before any other submit handler.
document.addEventListener(
  "submit",
  (event) => {
    const message =
      (event.submitter as HTMLElement | null)?.dataset.confirm ??
      (event.target as HTMLElement).dataset.confirm;
    if (message && !window.confirm(message)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
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
    const submitter = form.querySelector<HTMLButtonElement>(
      "button[data-original-label]"
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
