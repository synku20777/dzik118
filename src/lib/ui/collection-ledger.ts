/**
 * Keeps `.collection-ledger` breakdown disclosures open in two-column desktop
 * layouts (where `:scope > summary` is hidden) and starts them collapsed once
 * the card narrows to a single column (`< 32rem` container width).
 */
export function initCollectionLedgers(
  root: ParentNode = document,
  signal?: AbortSignal
): () => void {
  if (signal?.aborted || typeof ResizeObserver === "undefined") {
    return () => {};
  }

  const controller = new AbortController();
  let ledgers: HTMLDetailsElement[] = [];
  const observer = new ResizeObserver((entries) => {
    if (controller.signal.aborted) return;
    for (const entry of entries) {
      const details = entry.target as HTMLDetailsElement;
      if (entry.contentRect.width === 0 || !ledgers.includes(details)) continue;
      const summary = details.querySelector(":scope > summary");
      const collapsible =
        !!summary && getComputedStyle(summary).display !== "none";
      if (!collapsible) {
        details.open = true; // two columns: never hide the breakdown
        delete details.dataset.collapsed;
      } else if (!("collapsed" in details.dataset)) {
        details.open = false;
        details.dataset.collapsed = "1";
      }
    }
  });

  const watch = () => {
    // Refresh replaces the DOM before dispatching the event. The prior nodes
    // still hold the user's choice. Wide layouts always start a new cycle.
    const expanded = new Map<string, boolean>();
    for (const ledger of ledgers) {
      if (ledger.id && "collapsed" in ledger.dataset) {
        expanded.set(ledger.id, ledger.open);
      }
    }
    observer.disconnect();
    ledgers = Array.from(
      root.querySelectorAll<HTMLDetailsElement>("details.collection-ledger")
    );
    for (const ledger of ledgers) {
      const wasOpen = expanded.get(ledger.id);
      if (wasOpen !== undefined) {
        ledger.open = wasOpen;
        ledger.dataset.collapsed = "1";
      }
      observer.observe(ledger);
    }
  };

  const cleanup = () => {
    controller.abort();
    observer.disconnect();
    ledgers = [];
  };
  signal?.addEventListener("abort", cleanup, {
    once: true,
    signal: controller.signal,
  });
  watch();
  // The readings drawer swaps in fresh, open markup after a save.
  document.addEventListener("workbench:refreshed", watch, {
    signal: controller.signal,
  });
  return cleanup;
}
