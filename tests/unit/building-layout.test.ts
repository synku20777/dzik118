import { describe, expect, it } from "vitest";
import {
  autoLayout,
  validateBuildingLayout,
  type EntranceInput,
} from "../../src/domain/organizations/building";
import { ValidationError } from "../../src/domain/errors";

const entrance = (over: Partial<EntranceInput> = {}): EntranceInput => ({
  name: "A",
  floors: 2,
  columns: 2,
  placements: [],
  ...over,
});
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("building auto layout", () => {
  it("fills floors from the ground up in number order, 4 per floor", () => {
    const layout = autoLayout(
      ["10", "2", "1", "9", "3"].map((number, i) => ({ id: id(i), number })),
      "A"
    );
    expect(layout.floors).toBe(2);
    expect(layout.columns).toBe(4);
    const at = (floor: number, slot: number) =>
      layout.placements.find((p) => p.floor === floor && p.slot === slot)
        ?.dwellingId;
    // 1, 2, 3, 9 on the ground floor; 10 above.
    expect([at(0, 0), at(0, 1), at(0, 2), at(0, 3), at(1, 0)]).toEqual([
      id(2),
      id(1),
      id(4),
      id(3),
      id(0),
    ]);
  });

  it("keeps one floor for an empty building", () => {
    expect(autoLayout([], "A").floors).toBe(1);
  });

  it("widens the floors instead of passing the floor limit", () => {
    const many = Array.from({ length: 241 }, (_, i) => ({
      id: id(i),
      number: String(i + 1),
    }));
    const layout = autoLayout(many, "A");
    expect(layout.columns).toBe(5);
    expect(layout.floors).toBeLessThanOrEqual(60);
    expect(() => validateBuildingLayout([layout])).not.toThrow();
  });

  it("leaves what does not fit the largest grid unplaced, still valid", () => {
    const many = Array.from({ length: 1441 }, (_, i) => ({
      id: id(i),
      number: String(i + 1),
    }));
    const layout = autoLayout(many, "A");
    expect(layout.placements).toHaveLength(24 * 60);
    expect(() => validateBuildingLayout([layout])).not.toThrow();
  });
});

describe("building layout validation", () => {
  it("accepts a valid layout", () => {
    expect(() =>
      validateBuildingLayout([
        entrance({ placements: [{ dwellingId: id(1), floor: 1, slot: 1 }] }),
      ])
    ).not.toThrow();
  });

  it.each([
    ["no entrance", []],
    ["a blank name", [entrance({ name: "  " })]],
    ["zero floors", [entrance({ floors: 0 })]],
    ["too many columns", [entrance({ columns: 25 })]],
    [
      "a place outside the entrance",
      [entrance({ placements: [{ dwellingId: id(1), floor: 2, slot: 0 }] })],
    ],
    [
      "two dwellings in one place",
      [
        entrance({
          placements: [
            { dwellingId: id(1), floor: 0, slot: 0 },
            { dwellingId: id(2), floor: 0, slot: 0 },
          ],
        }),
      ],
    ],
    [
      "one dwelling placed twice",
      [
        entrance({ placements: [{ dwellingId: id(1), floor: 0, slot: 0 }] }),
        entrance({ placements: [{ dwellingId: id(1), floor: 0, slot: 1 }] }),
      ],
    ],
  ] as [string, EntranceInput[]][])("refuses %s", (_name, layout) => {
    expect(() => validateBuildingLayout(layout)).toThrow(ValidationError);
  });
});
