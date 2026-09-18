import { describe, expect, it } from "vitest";
import { meterListVisibility } from "../../src/lib/ui/meter-list";

describe("meter list visibility", () => {
  it("reconciles create, archive, and filter changes", () => {
    expect(meterListVisibility([], "active")).toEqual({
      rows: [],
      empty: true,
    });
    expect(meterListVisibility([false], "active")).toEqual({
      rows: [true],
      empty: false,
    });
    expect(meterListVisibility([false, false], "active")).toEqual({
      rows: [true, true],
      empty: false,
    });
    expect(meterListVisibility([false], "archived")).toEqual({
      rows: [false],
      empty: true,
    });
    expect(meterListVisibility([true], "active")).toEqual({
      rows: [false],
      empty: true,
    });
    expect(meterListVisibility([true], "archived")).toEqual({
      rows: [true],
      empty: false,
    });
  });
});
