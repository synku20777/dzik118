import { describe, expect, it } from "vitest";
import {
  addEntrance,
  addFloor,
  moveDwelling,
  neighbour,
  placeOf,
  removeColumn,
  removeEntrance,
  removeFloor,
  type Layout,
} from "../../src/lib/ui/building-layout";

const layout: Layout = [
  {
    name: "A",
    floors: 2,
    columns: 2,
    placements: [
      { dwellingId: "a", floor: 0, slot: 0 },
      { dwellingId: "b", floor: 0, slot: 1 },
    ],
  },
  { name: "B", floors: 1, columns: 1, placements: [] },
];

describe("building editor moves", () => {
  it("moves into an empty place", () => {
    const { layout: next, moved } = moveDwelling(layout, "a", {
      entrance: 1,
      floor: 0,
      slot: 0,
    });
    expect(placeOf(next, "a")).toEqual({ entrance: 1, floor: 0, slot: 0 });
    expect(moved).toEqual(["a"]);
    // The input is untouched (undo keeps it).
    expect(placeOf(layout, "a")).toEqual({ entrance: 0, floor: 0, slot: 0 });
  });

  it("swaps with a taken place", () => {
    const { layout: next, moved } = moveDwelling(layout, "a", {
      entrance: 0,
      floor: 0,
      slot: 1,
    });
    expect(placeOf(next, "a")?.slot).toBe(1);
    expect(placeOf(next, "b")?.slot).toBe(0);
    expect(moved).toEqual(["a", "b"]);
  });

  it("a dwelling from a tray pushes the occupant out", () => {
    const { layout: next } = moveDwelling(layout, "new", {
      entrance: 0,
      floor: 0,
      slot: 0,
    });
    expect(placeOf(next, "new")).toEqual({ entrance: 0, floor: 0, slot: 0 });
    expect(placeOf(next, "a")).toBeNull();
  });

  it("takes a dwelling out of the building", () => {
    expect(placeOf(moveDwelling(layout, "b", "tray").layout, "b")).toBeNull();
  });
});

describe("building editor shape", () => {
  it("finds arrow-key neighbours inside the entrance only", () => {
    const place = { entrance: 0, floor: 0, slot: 0 };
    expect(neighbour(layout, place, "ArrowUp")).toEqual({ ...place, floor: 1 });
    expect(neighbour(layout, place, "ArrowRight")).toEqual({
      ...place,
      slot: 1,
    });
    expect(neighbour(layout, place, "ArrowDown")).toBeNull();
    expect(neighbour(layout, place, "ArrowLeft")).toBeNull();
  });

  it("removes only empty floors, places and entrances", () => {
    expect(removeFloor(layout, 0)?.[0].floors).toBe(1);
    expect(removeColumn(layout, 0)).toBeNull();
    expect(removeEntrance(layout, 0)).toBeNull();
    expect(removeEntrance(layout, 1)).toHaveLength(1);
  });

  it("respects the limits", () => {
    expect(addFloor(layout, 0, 2)).toBeNull();
    expect(addFloor(layout, 0, 3)?.[0].floors).toBe(3);
    expect(addEntrance(layout, "C", 2)).toBeNull();
    expect(addEntrance(layout, "C", 3)?.[2]).toEqual({
      name: "C",
      floors: 1,
      columns: 2,
      placements: [],
    });
  });
});
