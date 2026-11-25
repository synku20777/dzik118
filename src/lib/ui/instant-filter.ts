// Submit selects and checkboxes immediately, and wait for typing to settle.
export function bindInstantFilter(form: HTMLFormElement): () => void {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let timer: number | undefined;
  function submit() {
    window.clearTimeout(timer);
    form.requestSubmit();
  }
  form.addEventListener(
    "input",
    (event) => {
      if (
        !(event.target instanceof HTMLInputElement) ||
        event.target.type !== "search"
      )
        return;
      window.clearTimeout(timer);
      timer = window.setTimeout(submit, 300);
    },
    options
  );
  form.addEventListener(
    "change",
    (event) => {
      if (
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLInputElement &&
          event.target.type === "checkbox")
      )
        submit();
    },
    options
  );
  form.addEventListener("submit", () => window.clearTimeout(timer), options);
  return () => {
    controller.abort();
    window.clearTimeout(timer);
  };
}
