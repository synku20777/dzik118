import { describe, expect, it } from "vitest";
import {
  entityLabel,
  formatDate,
  formatMoney,
  formatPeriod,
  translate,
} from "../../src/lib/ui/i18n";
import { invoiceStatusBadge } from "../../src/lib/ui/invoice-status";

describe("localized presentation", () => {
  it("formats dates without shifting date-only invoice deadlines", () => {
    expect(formatDate("2026-09-30", "en", "America/Los_Angeles")).toBe(
      "Sep 30, 2026"
    );
    expect(
      formatDate(new Date("2026-10-01T01:00:00Z"), "en", "America/Los_Angeles")
    ).toBe("Sep 30, 2026");
    expect(formatDate(null, "lv")).toBe("—");
    expect(formatPeriod(2026, 9, "en")).toBe("September 2026");
  });
  it("localizes money, workflow labels and meter types", () => {
    expect(formatMoney("1234.50", "EUR", "en")).toBe("€1,234.50");
    expect(formatMoney("1234.50", "EUR", "lv")).toContain("1234,50");
    expect(translate("lv", "Missing data")).toBe("Trūkst datu");
    expect(entityLabel("COLD_WATER", "lv")).toBe("Aukstais ūdens");
    expect(entityLabel("custom label", "en")).toBe("custom label");
    expect(
      ["MISSING_DATA", "DRAFT", "PREPARED", "SENT", "PAID", "OVERDUE"].map(
        (status) => invoiceStatusBadge(status).label
      )
    ).toEqual(["Missing data", "Draft", "Prepared", "Sent", "Paid", "Overdue"]);
    expect(translate("lv", "Toggle theme")).toBe("Pārslēgt motīvu");
    expect(translate("lv", "Switch to light theme")).toBe(
      "Pārslēgt uz gaišo motīvu"
    );
    expect(translate("lv", "Switch to dark theme")).toBe(
      "Pārslēgt uz tumšo motīvu"
    );
  });
});
