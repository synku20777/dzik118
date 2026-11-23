import { describe, expect, it } from "vitest";
import {
  pickNextAction,
  type CaseStatusCounts,
} from "../../src/domain/periods/dashboard";

const counts = (over: Partial<CaseStatusCounts> = {}): CaseStatusCounts => ({
  MISSING_DATA: 0,
  READY: 0,
  DRAFT: 0,
  PREPARED: 0,
  SENT: 0,
  OVERDUE: 0,
  PAID: 0,
  ...over,
});

describe("dashboard next action", () => {
  it("never calls a month with no billing cases done", () => {
    expect(pickNextAction(counts(), 0, 0, false, true)).toEqual({
      key: "NO_CASES",
      count: 0,
    });
  });

  it("calls an older locked month closed, not done", () => {
    expect(
      pickNextAction(counts({ MISSING_DATA: 2 }), 0, 0, true, false).key
    ).toBe("LOCKED");
    expect(pickNextAction(counts({ PAID: 2 }), 0, 0, true, true).key).toBe(
      "CREATE_NEXT_PERIOD"
    );
  });

  it("sends from the unsent count, which includes a paid unsent invoice", () => {
    expect(pickNextAction(counts({ PAID: 2 }), 1, 0, false, true)).toEqual({
      key: "SEND_INVOICES",
      count: 1,
    });
    expect(pickNextAction(counts({ PAID: 2 }), 0, 0, false, true).key).toBe(
      "ALL_DONE"
    );
  });

  it("waits for payment on a sent unpaid invoice whatever its status", () => {
    // A sent invoice an admin set back to Prepared is still owed.
    expect(pickNextAction(counts({ PREPARED: 1 }), 0, 1, false, true)).toEqual({
      key: "REVIEW_PAYMENTS",
      count: 1,
    });
  });
});
