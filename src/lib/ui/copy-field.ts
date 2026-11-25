/**
 * Progressive-enhancement copy buttons for resident transfer details and
 * design-system specimens. Writes `data-copy-value` to the clipboard,
 * announces outcomes to the nearest polite live region, and restores the
 * original label after 2s (debounced across rapid repeated clicks).
 */
export function initCopyButtons(
  root: ParentNode = document,
  options: { signal?: AbortSignal } = {}
): () => void {
  if (options.signal?.aborted) return () => {};
  const controller = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cleanup = () => {
    controller.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  if (options.signal) {
    options.signal.addEventListener("abort", cleanup, {
      once: true,
      signal: controller.signal,
    });
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-copy-value]"
  )) {
    const hiddenHost = button.closest<HTMLElement>(
      ".resident-payment-action[hidden]"
    );
    if (button.hidden || hiddenHost) {
      if (!navigator.clipboard?.writeText) continue;
      button.hidden = false;
      if (hiddenHost) hiddenHost.hidden = false;
    }
    const label = button.querySelector("span") ?? button;
    const copyLabel = label.textContent ?? "";
    let reset: ReturnType<typeof setTimeout> | undefined;
    const clearResetTimer = () => {
      if (reset !== undefined) {
        clearTimeout(reset);
        timers.delete(reset);
        reset = undefined;
      }
    };

    button.addEventListener(
      "click",
      async () => {
        const status =
          button
            .closest("[data-copy-scope]")
            ?.querySelector<HTMLElement>("[data-copy-status]") ??
          root.querySelector<HTMLElement>("[data-copy-status]");
        // Clear any identical status string before awaiting clipboard access so
        // repeat copies still trigger an ARIA live-region announcement.
        if (status) status.textContent = "";
        try {
          if (!navigator.clipboard?.writeText) {
            throw new Error("Clipboard unavailable");
          }
          await navigator.clipboard.writeText(button.dataset.copyValue!);
          if (controller.signal.aborted) return;
          if (status) status.textContent = status.dataset.copied ?? "Copied.";
          button.toggleAttribute("data-copied", true);
          label.textContent = button.dataset.copiedLabel ?? "Copied";
          clearResetTimer();
          reset = setTimeout(() => {
            timers.delete(reset!);
            reset = undefined;
            button.removeAttribute("data-copied");
            label.textContent = copyLabel;
          }, 2000);
          timers.add(reset);
        } catch {
          if (controller.signal.aborted) return;
          clearResetTimer();
          button.removeAttribute("data-copied");
          label.textContent = copyLabel;
          if (status) {
            status.textContent = status.dataset.copyFailed ?? "Could not copy.";
          }
        }
      },
      { signal: controller.signal }
    );
  }

  return cleanup;
}
