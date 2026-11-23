import { describe, expect, it } from "vitest";
import { ledgerDescriptionText } from "../../src/lib/ui/ledger-description";

describe("ledger descriptions", () => {
  it("words every stored shape in Latvian and keeps the reference", () => {
    const cases: [string, string][] = [
      [
        "Current charges INV-202609-00003",
        "Kārtējā perioda maksa INV-202609-00003",
      ],
      ["Late fee INV-1", "Nokavējuma maksa INV-1"],
      ["Manual adjustment INV-1", "Manuāla korekcija INV-1"],
      ["Manual charge adjustment", "Manuāla debeta korekcija"],
      ["Manual credit adjustment", "Manuāla kredīta korekcija"],
      ["Bank payment E2E-17", "Bankas maksājums E2E-17"],
      ["Cash payment R-5", "Skaidras naudas maksājums R-5"],
      ["Opening balance (migrated)", "Sākuma atlikums (pārnests)"],
    ];
    for (const [stored, shown] of cases)
      expect(ledgerDescriptionText(stored, "lv")).toBe(shown);
  });

  it("translates the payment inside a reversal, in either case", () => {
    expect(ledgerDescriptionText("Reversal of bank payment E2E-1", "lv")).toBe(
      "Atcelts: Bankas maksājums E2E-1"
    );
    expect(ledgerDescriptionText("Reversal of Cash payment R-5", "ru")).toBe(
      "Отменено: Оплата наличными R-5"
    );
  });

  it("covers Russian and leaves English readable", () => {
    expect(ledgerDescriptionText("Current charges INV-1", "ru")).toBe(
      "Текущие начисления INV-1"
    );
    expect(ledgerDescriptionText("Bank payment Payment for INV-1", "en")).toBe(
      "Bank payment Payment for INV-1"
    );
  });

  it("shows text it does not recognise unchanged", () => {
    expect(ledgerDescriptionText("Apsaimniekošanas maksa", "lv")).toBe(
      "Apsaimniekošanas maksa"
    );
  });
});
