export function bindOrganizationSwitcher(
  details: HTMLDetailsElement
): () => void {
  const click = (event: MouseEvent) => {
    if (
      !details.contains(event.target as Node) ||
      (event.target instanceof Element && event.target.closest("a"))
    ) {
      details.open = false;
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && details.open) {
      event.preventDefault();
      details.open = false;
      details.querySelector("summary")?.focus();
    }
  };
  document.addEventListener("click", click);
  document.addEventListener("keydown", keydown);
  return () => {
    document.removeEventListener("click", click);
    document.removeEventListener("keydown", keydown);
  };
}
