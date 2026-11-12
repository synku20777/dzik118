import { describe, expect, it } from "vitest";
import { skipReasonText, skipReasonsText } from "../../src/lib/ui/skip-reason";

describe("skip reasons", () => {
  it("puts the status label into a reason that carries a status code", () => {
    expect(skipReasonText("Already PAID", "lv")).toBe(
      "Statuss jau ir „Apmaksāts”"
    );
    expect(skipReasonText("Already PAID", "en")).toBe("Already Paid");
    expect(skipReasonText("Cannot send an invoice in DRAFT status", "ru")).toBe(
      "Нельзя отправить счёт при статусе «Черновик»"
    );
  });
  it("translates fixed reasons and leaves unknown ones as they are", () => {
    for (const reason of [
      "Already sent",
      "Delivery failed",
      "An unexpected error occurred.",
      "Cannot generate an invoice for a case in {status} status",
    ]) {
      expect(skipReasonText(reason, "lv")).not.toBe(reason);
      expect(skipReasonText(reason, "ru")).not.toBe(reason);
    }
    expect(skipReasonText("Some new domain message", "lv")).toBe(
      "Some new domain message"
    );
  });
  it("lists each distinct reason once", () => {
    expect(
      skipReasonsText(
        [
          { reason: "Already PAID" },
          { reason: "Already PAID" },
          { reason: "Already sent" },
        ],
        "en"
      )
    ).toBe("Already Paid; Already sent");
  });
});
