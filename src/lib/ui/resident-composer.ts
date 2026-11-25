export function bindResidentComposerShortcut(
  form: HTMLFormElement,
  field: HTMLTextAreaElement
): void {
  // Enter adds a line. A modifier is required to send a draft.
  field.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      !(event.ctrlKey || event.metaKey)
    )
      return;
    event.preventDefault();
    form.requestSubmit();
  });
}
