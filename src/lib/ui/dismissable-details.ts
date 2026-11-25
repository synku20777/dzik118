// Any <details data-dismiss> is a popover: it closes on an outside click or
// Escape (focus goes back to its summary). Delegated once on the document, so
// it survives fragment refreshes and page swaps.
let installed = false;

export function installDismissableDetails(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    // Picking an item in a dropdown closes it too. If focus would be left in
    // the hidden panel (the item did not move it), it goes back to the summary.
    const item =
      target instanceof Element
        ? target.closest(".dropdown-panel :is(a, button)")
        : null;
    for (const details of document.querySelectorAll<HTMLDetailsElement>(
      "details[data-dismiss][open]"
    )) {
      if (!target || !details.contains(target)) {
        details.open = false;
      } else if (item && details.contains(item)) {
        details.open = false;
        if (details.contains(document.activeElement)) {
          details.querySelector("summary")?.focus();
        }
      }
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
