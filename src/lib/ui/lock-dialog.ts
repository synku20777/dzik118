const returnTargets = new WeakMap<HTMLDialogElement, HTMLElement>();

// Delegated so newly rendered triggers work after an Astro navigation or a
// Current Month queue refresh.
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (
    event.target instanceof HTMLDialogElement &&
    event.target.matches(".lock-dialog[open]")
  ) {
    // Only a click on the backdrop closes it. The dialog's own padding, and a
    // press that started on a button and ended on the body, also target the
    // <dialog>, but land inside its box.
    const box = event.target.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) event.target.close();
    return;
  }
  const opener = event.target.closest<HTMLElement>("[data-open-lock-dialog]");
  if (!opener) return;
  const dialog = document.getElementById(opener.dataset.openLockDialog ?? "");
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !dialog.classList.contains("lock-dialog") ||
    dialog.open
  )
    return;

  const menu = opener.closest("details");
  const returnTarget = menu?.querySelector("summary") ?? opener;
  if (menu) menu.open = false;
  dialog.returnValue = "";
  returnTargets.set(dialog, returnTarget);
  dialog.showModal();
});

document.addEventListener(
  "close",
  (event) => {
    const dialog = event.target;
    // The close event can arrive after the same dialog has reopened.
    if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
    const returnTarget = returnTargets.get(dialog);
    returnTargets.delete(dialog);
    if (returnTarget?.getClientRects().length) returnTarget.focus();
  },
  true
);
