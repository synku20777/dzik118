export type MeterFilter = "active" | "archived";

export function meterListVisibility(
  archivedRows: readonly boolean[],
  filter: MeterFilter
) {
  const rows = archivedRows.map((archived) =>
    filter === "archived" ? archived : !archived
  );
  return { rows, empty: !rows.some(Boolean) };
}

export function bindMeterList(
  root: HTMLElement,
  signal: AbortSignal,
  onRows?: (rows: HTMLLIElement[]) => void
): () => void {
  const region = root.querySelector<HTMLElement>("#meters-list-region");
  const list = region?.querySelector<HTMLUListElement>(".item-list");
  const empty = region?.querySelector<HTMLElement>("#meters-empty-state");
  const buttons = root.querySelectorAll<HTMLButtonElement>(
    "[data-meter-filter]"
  );
  let filter: MeterFilter = "active";

  function reconcile() {
    if (!region || !list || !empty) return;
    const rows = [...list.querySelectorAll<HTMLLIElement>(".meter-row")];
    onRows?.(rows);
    const visibility = meterListVisibility(
      rows.map((row) => row.dataset.archived === "true"),
      filter
    );
    rows.forEach((row, index) => (row.hidden = !visibility.rows[index]));
    list.hidden = visibility.empty;
    empty.hidden = !visibility.empty;
    const title = empty.querySelector<HTMLElement>(".text-h3");
    if (title)
      title.textContent =
        filter === "archived"
          ? (region.dataset.emptyArchived ?? "No archived meters.")
          : (region.dataset.emptyActive ?? "No active meters.");
    for (const button of buttons)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.meterFilter === filter)
      );
  }
  for (const button of buttons)
    button.addEventListener(
      "click",
      () => {
        const next = button.dataset.meterFilter;
        if (next === "active" || next === "archived") {
          filter = next;
          reconcile();
        }
      },
      { signal }
    );
  return reconcile;
}
