import { describe, expect, it } from "vitest";
import { caseMatchesStatus } from "../../src/domain/periods/case-filter";

describe("dashboard send queue", () => {
  it("includes both draft and prepared invoices without sent or paid cases", () => {
    const statuses = [
      "MISSING_DATA",
      "READY",
      "DRAFT",
      "PREPARED",
      "SENT",
      "OVERDUE",
      "PAID",
    ] as const;
    expect(
      statuses.filter((status) => caseMatchesStatus(status, "UNSENT"))
    ).toEqual(["DRAFT", "PREPARED"]);
    expect(
      statuses.filter((status) => caseMatchesStatus(status, "DRAFT"))
    ).toEqual(["DRAFT"]);
    expect(statuses.filter((status) => caseMatchesStatus(status))).toHaveLength(
      statuses.length
    );
  });
});
