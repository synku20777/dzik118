import { describe, expect, it } from "vitest";
import { caseMatchesStatus } from "../../src/domain/periods/case-filter";

describe("dashboard send queue", () => {
  it("decides the queue by send date, not by status", () => {
    const statuses = [
      "MISSING_DATA",
      "READY",
      "DRAFT",
      "PREPARED",
      "SENT",
      "OVERDUE",
      "PAID",
    ] as const;
    // A sent invoice set back to Prepared is not in the queue.
    expect(caseMatchesStatus("PREPARED", "UNSENT", false)).toBe(false);
    expect(caseMatchesStatus("DRAFT", "UNSENT", true)).toBe(true);
    expect(
      statuses.filter((status) => caseMatchesStatus(status, "DRAFT"))
    ).toEqual(["DRAFT"]);
    expect(statuses.filter((status) => caseMatchesStatus(status))).toHaveLength(
      statuses.length
    );
  });

  it("includes a paid invoice that was never sent", () => {
    expect(caseMatchesStatus("PAID", "UNSENT", true)).toBe(true);
    expect(caseMatchesStatus("PAID", "UNSENT", false)).toBe(false);
  });
});
