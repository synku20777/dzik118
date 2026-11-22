// Pure edits on the building view's layout (the React editor's state). Every
// function returns a new layout and never changes its input, so undo is a
// stack of earlier layouts and the saved shape is the state itself.
import type { EntranceInput } from "../../domain/organizations/building";

export type Layout = EntranceInput[];
export type Place = { entrance: number; floor: number; slot: number };
// A place in the building, or out of it (the tray of the dwelling's type).
export type Target = Place | "tray";

export function placeOf(layout: Layout, dwellingId: string): Place | null {
  for (const [entrance, item] of layout.entries()) {
    const found = item.placements.find((p) => p.dwellingId === dwellingId);
    if (found) return { entrance, floor: found.floor, slot: found.slot };
  }
  return null;
}

export function occupant(layout: Layout, place: Place): string | null {
  return (
    layout[place.entrance]?.placements.find(
      (p) => p.floor === place.floor && p.slot === place.slot
    )?.dwellingId ?? null
  );
}

const without = (layout: Layout, ids: string[]): Layout =>
  layout.map((item) => ({
    ...item,
    placements: item.placements.filter((p) => !ids.includes(p.dwellingId)),
  }));

const put = (layout: Layout, dwellingId: string, place: Place): Layout =>
  layout.map((item, index) =>
    index === place.entrance
      ? {
          ...item,
          placements: [
            ...item.placements,
            { dwellingId, floor: place.floor, slot: place.slot },
          ],
        }
      : item
  );

// Move a dwelling to a place or out of the building. A taken place swaps: its
// dwelling goes where the moved one came from (or out, if it came from a
// tray). Returns the dwellings that moved, for the confirmation tint.
export function moveDwelling(
  layout: Layout,
  dwellingId: string,
  target: Target
): { layout: Layout; moved: string[] } {
  const from = placeOf(layout, dwellingId);
  if (target === "tray") {
    return from
      ? { layout: without(layout, [dwellingId]), moved: [dwellingId] }
      : { layout, moved: [] };
  }
  const other = occupant(layout, target);
  if (other === dwellingId) return { layout, moved: [] };
  let next = without(layout, other ? [dwellingId, other] : [dwellingId]);
  next = put(next, dwellingId, target);
  if (other && from) next = put(next, other, from);
  return { layout: next, moved: other ? [dwellingId, other] : [dwellingId] };
}

// The next place in the grid for an arrow key, within the same entrance.
// Floors are numbered from the ground up, so ArrowUp is floor + 1.
export function neighbour(
  layout: Layout,
  place: Place,
  key: string
): Place | null {
  const item = layout[place.entrance];
  const step: Record<string, [number, number]> = {
    ArrowUp: [1, 0],
    ArrowDown: [-1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  if (!item || !step[key]) return null;
  const floor = place.floor + step[key][0];
  const slot = place.slot + step[key][1];
  if (floor < 0 || floor >= item.floors || slot < 0 || slot >= item.columns)
    return null;
  return { entrance: place.entrance, floor, slot };
}

const update = (
  layout: Layout,
  index: number,
  change: Partial<EntranceInput>
) => layout.map((item, i) => (i === index ? { ...item, ...change } : item));

export function addFloor(layout: Layout, index: number, max: number) {
  const item = layout[index];
  return item.floors >= max
    ? null
    : update(layout, index, { floors: item.floors + 1 });
}

// The top floor goes only when it is empty.
export function removeFloor(layout: Layout, index: number) {
  const item = layout[index];
  const top = item.floors - 1;
  if (item.floors <= 1 || item.placements.some((p) => p.floor === top))
    return null;
  return update(layout, index, { floors: item.floors - 1 });
}

export function addColumn(layout: Layout, index: number, max: number) {
  const item = layout[index];
  return item.columns >= max
    ? null
    : update(layout, index, { columns: item.columns + 1 });
}

// The last place on every floor goes only when all of them are empty.
export function removeColumn(layout: Layout, index: number) {
  const item = layout[index];
  const last = item.columns - 1;
  if (item.columns <= 1 || item.placements.some((p) => p.slot === last))
    return null;
  return update(layout, index, { columns: item.columns - 1 });
}

export function renameEntrance(layout: Layout, index: number, name: string) {
  return update(layout, index, { name });
}

// A new entrance copies the first one's width, one floor high, empty.
export function addEntrance(layout: Layout, name: string, max: number) {
  if (layout.length >= max) return null;
  return [
    ...layout,
    { name, floors: 1, columns: layout[0]?.columns ?? 4, placements: [] },
  ];
}

// Only an empty entrance can go, and never the last one.
export function removeEntrance(layout: Layout, index: number) {
  if (layout.length <= 1 || layout[index].placements.length > 0) return null;
  return layout.filter((_, i) => i !== index);
}
