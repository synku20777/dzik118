// Copies each column header into its cells as data-label so `.stack-table`
// (global.css) can show a row as a labelled card on narrow screens.
export function labelStackTables(root: ParentNode = document): void {
  for (const table of root.querySelectorAll<HTMLTableElement>(
    ".stack-table table"
  )) {
    const labels = [...table.querySelectorAll("thead th")].map((th) => {
      const clone = th.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[aria-hidden]").forEach((el) => el.remove());
      return clone.textContent?.trim() ?? "";
    });
    for (const row of table.querySelectorAll("tbody tr")) {
      [...row.children].forEach((cell, i) => {
        if (cell instanceof HTMLElement && !cell.hasAttribute("colspan")) {
          cell.dataset.label = labels[i] ?? "";
        }
      });
    }
  }
}
