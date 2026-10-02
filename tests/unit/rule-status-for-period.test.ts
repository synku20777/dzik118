import { describe, expect, it } from "vitest";
import { ruleStatusForPeriod } from "../../src/domain/billing/rules";

const july = { startsOn: "2026-07-01", endsOn: "2026-07-31" };
const rule = {
  enabled: true,
  archivedAt: null,
  effectiveFrom: "2026-01-01",
  effectiveUntil: null,
};

describe("ruleStatusForPeriod", () => {
  it("applies when the effective dates overlap the period, edges included", () => {
    expect(ruleStatusForPeriod(rule, july)).toBe("APPLIES");
    expect(
      ruleStatusForPeriod({ ...rule, effectiveFrom: "2026-07-31" }, july)
    ).toBe("APPLIES");
    expect(
      ruleStatusForPeriod({ ...rule, effectiveUntil: "2026-07-01" }, july)
    ).toBe("APPLIES");
  });

  it("names the date mismatch", () => {
    expect(
      ruleStatusForPeriod({ ...rule, effectiveFrom: "2026-08-01" }, july)
    ).toBe("STARTS_AFTER_PERIOD");
    expect(
      ruleStatusForPeriod({ ...rule, effectiveUntil: "2026-06-30" }, july)
    ).toBe("ENDED_BEFORE_PERIOD");
  });

  it("reports archived before disabled, and both before dates", () => {
    const late = { ...rule, effectiveFrom: "2026-08-01", enabled: false };
    expect(ruleStatusForPeriod(late, july)).toBe("DISABLED");
    expect(ruleStatusForPeriod({ ...late, archivedAt: new Date() }, july)).toBe(
      "ARCHIVED"
    );
  });
});
