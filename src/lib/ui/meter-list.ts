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
