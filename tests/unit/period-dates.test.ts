import { describe, expect, it } from "vitest";
import { createPeriod } from "../../src/domain/periods/periods";

// Date validation runs before any DB access, so no database is needed.
const base = {
  year: 2026,
  month: 9,
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  invoiceIssueDate: "2026-10-01",
  invoiceDueDate: "2026-10-15",
};
const create = (patch: Record<string, unknown>) =>
  createPeriod(null as never, "org", { ...base, ...patch }, "user");

describe("createPeriod date validation", () => {
  it("rejects a start date after the end date", async () => {
    await expect(create({ startsOn: "2026-10-05" })).rejects.toThrow(
      /start date/
    );
  });
  it("rejects a due date before the issue date", async () => {
    await expect(create({ invoiceDueDate: "2026-09-20" })).rejects.toThrow(
      /due date/
    );
  });
  it("rejects a reading deadline after the issue date", async () => {
    await expect(create({ readingDeadline: "2026-10-02" })).rejects.toThrow(
      /reading deadline/
    );
  });
  it("accepts a deadline on or before the issue date (fails later, on the missing DB)", async () => {
    await expect(create({ readingDeadline: "2026-10-01" })).rejects.not.toThrow(
      /must not be/
    );
  });
});
