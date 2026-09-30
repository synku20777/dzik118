import { describe, expect, it } from "vitest";
import {
  AUTO_SEND_BATCH_LIMIT,
  latestSendDay,
  selectAutoSendBatch,
  type AutoSendCandidate,
} from "../../src/domain/automation/send-window";

const utc = (iso: string) => new Date(iso);
const candidate = (
  id: string,
  preparedAt: string | null,
  extra: Partial<AutoSendCandidate> = {}
): AutoSendCandidate => ({
  id,
  preparedAt: preparedAt ? utc(preparedAt) : null,
  billingEmail: "resident@example.com",
  invoiceByEmail: true,
  ...extra,
});
const base = {
  timezone: "Europe/Riga",
  sendDayDate: "2026-10-05",
  suppressed: new Set<string>(),
};

describe("selectAutoSendBatch", () => {
  it("takes invoices prepared by the end of the send day", () => {
    const result = selectAutoSendBatch(
      [
        candidate("early", "2026-09-28T10:00:00Z"),
        candidate("send-day", "2026-10-05T10:00:00Z"),
        candidate("legacy", null),
      ],
      base
    );
    expect(result.batch.sort()).toEqual(["early", "legacy", "send-day"]);
  });

  it("leaves an invoice prepared after the send day for next month", () => {
    const result = selectAutoSendBatch(
      [
        candidate("late", "2026-10-06T08:00:00Z"),
        candidate("ok", "2026-10-01T08:00:00Z"),
      ],
      base
    );
    expect(result.batch).toEqual(["ok"]);
  });

  it("judges the send day in the organization timezone", () => {
    // 2026-10-05T22:30Z is already 6 October 01:30 in Riga (UTC+3).
    const inRiga = selectAutoSendBatch(
      [candidate("night", "2026-10-05T22:30:00Z")],
      base
    );
    expect(inRiga.batch).toEqual([]);
    const inUtc = selectAutoSendBatch(
      [candidate("night", "2026-10-05T22:30:00Z")],
      { ...base, timezone: "UTC" }
    );
    expect(inUtc.batch).toEqual(["night"]);
  });

  it("skips suppressed addresses without counting them as waiting", () => {
    const result = selectAutoSendBatch(
      [
        candidate("a", "2026-10-01T08:00:00Z", {
          billingEmail: "Gone@Example.com",
        }),
        candidate("paper", "2026-10-01T08:00:00Z", {
          billingEmail: "gone@example.com",
          invoiceByEmail: false,
        }),
        candidate("b", "2026-10-01T09:00:00Z"),
      ],
      { ...base, suppressed: new Set(["gone@example.com"]) }
    );
    expect(result.batch).toEqual(["b"]);
    expect(result.suppressed).toBe(1);
    expect(result.unsendable).toBe(1);
    expect(result.waiting).toBe(0);
  });

  it("does not let invoices that cannot be emailed fill the batch", () => {
    // Older invoices that auto send can never email, then a newer good one.
    const stuck = Array.from({ length: 5 }, (_, i) =>
      candidate(`paper${i}`, `2026-09-0${i + 1}T08:00:00Z`, {
        invoiceByEmail: false,
      })
    );
    const noEmail = candidate("no-email", "2026-09-10T08:00:00Z", {
      billingEmail: null,
    });
    const good = candidate("good", "2026-10-01T08:00:00Z");
    const result = selectAutoSendBatch([...stuck, noEmail, good], {
      ...base,
      limit: 2,
    });
    expect(result.batch).toEqual(["good"]);
    expect(result.unsendable).toBe(6);
    expect(result.waiting).toBe(0);
  });

  it("caps the batch, oldest first, and reports the rest as waiting", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      candidate(`i${i}`, `2026-10-0${5 - i}T08:00:00Z`)
    );
    const result = selectAutoSendBatch(rows, { ...base, limit: 3 });
    expect(result.batch).toEqual(["i4", "i3", "i2"]);
    expect(result.waiting).toBe(2);
  });

  it("has a sensible default limit", () => {
    // (see also latestSendDay below)
    expect(AUTO_SEND_BATCH_LIMIT).toBeGreaterThan(0);
    const rows = Array.from({ length: AUTO_SEND_BATCH_LIMIT + 7 }, (_, i) =>
      candidate(`i${i}`, "2026-10-01T08:00:00Z")
    );
    const result = selectAutoSendBatch(rows, base);
    expect(result.batch).toHaveLength(AUTO_SEND_BATCH_LIMIT);
    expect(result.waiting).toBe(7);
  });
});

describe("latestSendDay", () => {
  it("is this month's send day from that day on", () => {
    expect(latestSendDay("2026-10-05", 5)).toBe("2026-10-05");
    expect(latestSendDay("2026-10-08", 5)).toBe("2026-10-05");
    expect(latestSendDay("2026-10-12", 5)).toBe("2026-10-05");
  });

  it("stops after the catch-up window", () => {
    expect(latestSendDay("2026-10-13", 5)).toBeNull();
    expect(latestSendDay("2026-10-20", 5)).toBeNull();
  });

  it("is null before the first send day of a new cycle", () => {
    expect(latestSendDay("2026-10-04", 5)).toBeNull();
    expect(latestSendDay("2026-10-01", 15)).toBeNull();
  });

  it("reaches across a month end", () => {
    expect(latestSendDay("2026-09-01", 28)).toBe("2026-08-28");
    expect(latestSendDay("2026-09-04", 28)).toBe("2026-08-28");
    expect(latestSendDay("2026-09-05", 28)).toBeNull();
  });

  it("reaches across a year end", () => {
    expect(latestSendDay("2027-01-02", 28)).toBe("2026-12-28");
    // 28 December to 2 January is five days.
    expect(latestSendDay("2027-01-02", 28, 5)).toBe("2026-12-28");
    expect(latestSendDay("2027-01-02", 28, 4)).toBeNull();
  });

  it("works in February", () => {
    expect(latestSendDay("2027-03-02", 28)).toBe("2027-02-28");
    expect(latestSendDay("2028-03-02", 28)).toBe("2028-02-28");
  });
});
