// Any <details data-dismiss> is a popover: it closes on an outside click or
// Escape (focus goes back to its summary). Delegated once on the document, so
// it survives fragment refreshes and page swaps.
let installed = false;

export function installDismissableDetails(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    for (const details of document.querySelectorAll<HTMLDetailsElement>(
      "details[data-dismiss][open]"
    )) {
      if (!target || !details.contains(target)) details.open = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    // A dialog or drawer that already took this Escape keeps it.
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const open = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "details[data-dismiss][open]"
      ),
    ];
    // The innermost one holding focus; with focus elsewhere, close them all
    // but leave focus alone.
    const focused = open
      .filter((details) => details.contains(document.activeElement))
      .at(-1);
    if (focused) {
      focused.open = false;
      focused.querySelector("summary")?.focus();
      return;
    }
    for (const details of open) details.open = false;
  });
}
