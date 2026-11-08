import { describe, expect, it } from "vitest";
import type { PaymentTrail } from "../../src/domain/payments/trail";
import {
  buildPaymentSplit,
  buildTrailEvents,
} from "../../src/domain/payments/trail-view";

const at = (iso: string) => new Date(iso);

function trail(overrides: Partial<PaymentTrail> = {}): PaymentTrail {
  return {
    transaction: {
      id: "tx1",
      bookingDate: "2026-09-01",
      amount: "100.00",
      currency: "EUR",
      payerName: "J. Doe",
      reference: "REF",
      paymentMethod: "BANK",
      appliedDwellingId: null,
      bankImportId: "imp1",
      importFilename: "september.csv",
      importedAt: at("2026-09-02T08:00:00Z"),
      importerName: "Admin A",
      importerEmail: "a@example.com",
    },
    dwelling: null,
    matches: [
      {
        id: "m1",
        invoiceId: "inv1",
        invoiceNumber: "INV-1",
        periodId: "p1",
        dwellingId: "d1",
        amountDue: "80.00",
      },
    ] as PaymentTrail["matches"],
    allocations: [],
    reversals: [],
    entries: [],
    events: [],
    ...overrides,
  } as PaymentTrail;
}

describe("buildTrailEvents", () => {
  it("keeps the original suggestion when a rejected match is reused", () => {
    const events = buildTrailEvents(
      trail({
        matches: [
          { ...trail().matches[0], matchType: "MANUAL" },
        ] as PaymentTrail["matches"],
        events: [
          {
            action: "PAYMENT_MATCH_PROPOSED",
            afterData: { matchType: "AUTO" },
          },
          { action: "PAYMENT_MATCH_REJECTED" },
          {
            action: "PAYMENT_MATCH_PROPOSED",
            afterData: { matchType: "MANUAL" },
          },
          { action: "PAYMENT_MATCH_CONFIRMED" },
        ].map((event, i) => ({
          ...event,
          entityType: "payment_match",
          entityId: "m1",
          createdAt: at(`2026-09-0${i + 3}T08:00:00Z`),
          actorName: null,
          actorEmail: null,
        })) as PaymentTrail["events"],
      })
    );
    expect(events.map((event) => event.kind)).toEqual([
      "RECEIVED",
      "SUGGESTED",
      "REJECTED",
      "MATCHED",
      "APPLIED",
    ]);
  });
  it("starts with the statement import and orders events by time", () => {
    const events = buildTrailEvents(
      trail({
        events: [
          {
            id: "e2",
            action: "PAYMENT_MATCH_CONFIRMED",
            entityType: "payment_match",
            entityId: "m1",
            afterData: { allocatedAmount: "80.00" },
            createdAt: at("2026-09-03T09:00:00Z"),
            actorName: null,
            actorEmail: "b@example.com",
          },
          {
            id: "e1",
            action: "PAYMENT_MATCH_PROPOSED",
            entityType: "payment_match",
            entityId: "m1",
            afterData: {},
            createdAt: at("2026-09-02T08:00:01Z"),
            actorName: "Admin A",
            actorEmail: "a@example.com",
          },
        ] as PaymentTrail["events"],
      })
    );
    expect(events.map((e) => e.kind)).toEqual([
      "RECEIVED",
      "SUGGESTED",
      "APPLIED",
    ]);
    expect(events[0]).toMatchObject({
      source: "september.csv",
      actor: "Admin A",
    });
    expect(events[2]).toMatchObject({
      invoiceNumber: "INV-1",
      amount: "80.00",
      actor: "b@example.com", // falls back to the email when there is no name
    });
  });

  it("does not repeat 'received' for a payment an admin typed in, and keeps the reason", () => {
    const events = buildTrailEvents(
      trail({
        transaction: {
          ...trail().transaction,
          importFilename: "Manual entry",
        },
        events: [
          {
            id: "e1",
            action: "MANUAL_PAYMENT_RECORDED",
            entityType: "bank_transaction",
            entityId: "tx1",
            afterData: { reason: "Bank statement arrived late" },
            createdAt: at("2026-09-02T08:00:00Z"),
            actorName: "Admin A",
            actorEmail: "a@example.com",
          },
        ] as PaymentTrail["events"],
      })
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "TYPED_IN",
      reason: "Bank statement arrived late",
      invoiceNumber: "INV-1",
    });
  });

  it("records a reversal with who and why", () => {
    const events = buildTrailEvents(
      trail({
        events: [
          {
            id: "e1",
            action: "PAYMENT_REVERSED",
            entityType: "payment_match",
            entityId: "m1",
            afterData: { reason: "Paid twice" },
            createdAt: at("2026-09-05T10:00:00Z"),
            actorName: "Admin A",
            actorEmail: "a@example.com",
          },
        ] as PaymentTrail["events"],
      })
    );
    expect(events.at(-1)).toMatchObject({
      kind: "REVERSED",
      reason: "Paid twice",
    });
  });
});

describe("events that share a timestamp", () => {
  it("keeps the order the steps really happen in", () => {
    const same = at("2026-09-02T08:00:00Z");
    const event = (id: string, action: string, entityId = "tx1") => ({
      id,
      action,
      entityType: action.startsWith("PAYMENT_")
        ? "payment_match"
        : "bank_transaction",
      entityId: action.startsWith("PAYMENT_") ? "m1" : entityId,
      afterData: {},
      createdAt: same,
      actorName: "Admin A",
      actorEmail: "a@example.com",
    });
    // Written in one transaction, so the database may return them in any order.
    const events = buildTrailEvents(
      trail({
        // An admin typed the payment in, so the match is theirs, not a suggestion.
        matches: [
          {
            id: "m1",
            matchType: "MANUAL",
            invoiceId: "inv1",
            invoiceNumber: "INV-1",
            periodId: "p1",
            dwellingId: "d1",
            amountDue: "80.00",
          },
        ] as PaymentTrail["matches"],
        events: [
          event("e3", "PAYMENT_MATCH_CONFIRMED"),
          event("e2", "PAYMENT_MATCH_PROPOSED"),
          event("e1", "MANUAL_PAYMENT_RECORDED"),
        ] as PaymentTrail["events"],
      })
    );
    expect(events.map((e) => e.kind)).toEqual(["TYPED_IN", "APPLIED"]);
  });
});

describe("corrected rows and sources", () => {
  it("says what a correction changed, old and new", () => {
    const events = buildTrailEvents(
      trail({
        events: [
          {
            id: "e1",
            action: "BANK_TRANSACTION_EDITED",
            entityType: "bank_transaction",
            entityId: "tx1",
            beforeData: {
              amount: "10.00",
              bookingDate: "2026-09-01",
              payerName: "J. Doe",
              reference: "R1",
            },
            afterData: {
              amount: "100.00",
              bookingDate: "2026-09-01",
              payerName: "J. Doe",
              reference: "R2",
              reason: "Reader dropped a zero",
            },
            createdAt: at("2026-09-03T09:00:00Z"),
            actorName: "Admin A",
            actorEmail: "a@example.com",
          },
        ] as PaymentTrail["events"],
      })
    );
    const corrected = events.find((e) => e.kind === "CORRECTED")!;
    expect(corrected.reason).toBe("Reader dropped a zero");
    expect(corrected.changes).toEqual([
      { field: "amount", from: "10.00", to: "100.00" },
      { field: "reference", from: "R1", to: "R2" },
    ]);
  });

  it("links a statement row to its import, but not a typed-in one", () => {
    expect(buildTrailEvents(trail())[0]).toMatchObject({
      kind: "RECEIVED",
      importId: "imp1",
    });
    const typed = buildTrailEvents(
      trail({
        transaction: { ...trail().transaction, importFilename: "Manual entry" },
      })
    )[0];
    expect(typed.importId).toBeUndefined();
  });
});

describe("admin-chosen matches", () => {
  it("shows a match an admin picked as one step, not as a suggestion", () => {
    const events = buildTrailEvents(
      trail({
        matches: [
          {
            id: "m1",
            matchType: "MANUAL",
            invoiceId: "inv1",
            invoiceNumber: "INV-1",
            periodId: "p1",
            dwellingId: "d1",
            amountDue: "80.00",
          },
        ] as PaymentTrail["matches"],
        events: [
          {
            id: "e1",
            action: "PAYMENT_MATCH_PROPOSED",
            entityType: "payment_match",
            entityId: "m1",
            afterData: {},
            createdAt: at("2026-09-02T09:00:00Z"),
            actorName: "Admin A",
            actorEmail: "a@example.com",
          },
        ] as PaymentTrail["events"],
      })
    );
    expect(events.map((e) => e.kind)).toEqual(["RECEIVED", "MATCHED"]);
  });
});

describe("re-matching a typed-in payment", () => {
  it("shows the later match as its own step", () => {
    const match = (id: string, invoiceNumber: string) => ({
      id,
      matchType: "MANUAL",
      invoiceId: id,
      invoiceNumber,
      periodId: "p1",
      dwellingId: "d1",
      amountDue: "80.00",
    });
    const proposed = (id: string, entityId: string, iso: string) => ({
      id,
      action: "PAYMENT_MATCH_PROPOSED",
      entityType: "payment_match",
      entityId,
      afterData: {},
      createdAt: at(iso),
      actorName: "Admin A",
      actorEmail: "a@example.com",
    });
    const events = buildTrailEvents(
      trail({
        matches: [
          match("m1", "INV-1"),
          match("m2", "INV-2"),
        ] as PaymentTrail["matches"],
        events: [
          {
            id: "t",
            action: "MANUAL_PAYMENT_RECORDED",
            entityType: "bank_transaction",
            entityId: "tx1",
            afterData: {},
            createdAt: at("2026-09-02T08:00:00Z"),
            actorName: "Admin A",
            actorEmail: "a@example.com",
          },
          proposed("p1", "m1", "2026-09-02T08:00:00Z"),
          proposed("p2", "m2", "2026-09-05T08:00:00Z"),
        ] as PaymentTrail["events"],
      })
    );
    expect(events.map((e) => [e.kind, e.invoiceNumber])).toEqual([
      ["TYPED_IN", "INV-1"],
      ["MATCHED", "INV-2"],
    ]);
  });
});

describe("buildPaymentSplit", () => {
  const allocation = (invoiceId: string, amount: string) => ({
    id: `a-${invoiceId}`,
    amount,
    invoiceId,
    invoiceNumber: invoiceId.toUpperCase(),
    periodId: "p1",
  });
  const credit = (amount: string) => ({
    type: "PAYMENT",
    credit: amount,
    debit: "0.00",
  });
  const reversal = (amount: string) => ({
    type: "PAYMENT_REVERSAL",
    credit: "0.00",
    debit: amount,
  });

  it("splits an overpayment into the invoice part and account credit", () => {
    const split = buildPaymentSplit(
      trail({
        allocations: [
          allocation("inv1", "80.00"),
        ] as PaymentTrail["allocations"],
        entries: [credit("100.00")] as PaymentTrail["entries"],
      })
    );
    expect(split).toMatchObject({
      applied: "80.00",
      credit: "20.00",
      reversed: false,
      posted: true,
    });
  });

  it("puts a payment with no invoice entirely on the account", () => {
    expect(
      buildPaymentSplit(
        trail({
          matches: [],
          entries: [credit("100.00")] as PaymentTrail["entries"],
        })
      )
    ).toMatchObject({ applied: "0.00", credit: "100.00", invoices: [] });
  });

  it("remembers the credit part of a reversed overpayment", () => {
    const split = buildPaymentSplit(
      trail({
        allocations: [
          allocation("inv1", "80.00"),
        ] as PaymentTrail["allocations"],
        reversals: [{ invoiceId: "inv1" }] as PaymentTrail["reversals"],
        entries: [
          credit("100.00"),
          reversal("100.00"),
        ] as PaymentTrail["entries"],
      })
    );
    expect(split).toMatchObject({
      reversed: true,
      credit: "0.00",
      originalCredit: "20.00",
    });
  });

  it("measures the original credit against the last allocation, not the sum", () => {
    // 100.00 matched twice to 60.00 invoices, reversed both times.
    const split = buildPaymentSplit(
      trail({
        allocations: [
          allocation("inv1", "60.00"),
          allocation("inv2", "60.00"),
        ] as PaymentTrail["allocations"],
        reversals: [
          { invoiceId: "inv1" },
          { invoiceId: "inv2" },
        ] as PaymentTrail["reversals"],
        entries: [
          credit("100.00"),
          reversal("100.00"),
          credit("100.00"),
          reversal("100.00"),
        ] as PaymentTrail["entries"],
      })
    );
    expect(split).toMatchObject({ reversed: true, originalCredit: "40.00" });
  });

  it("does not let a corrected bank amount rewrite the original credit", () => {
    // 100.00 posted and 80.00 allocated, reversed; the row was then edited to 120.00.
    const split = buildPaymentSplit(
      trail({
        transaction: { ...trail().transaction, amount: "120.00" },
        allocations: [
          allocation("inv1", "80.00"),
        ] as PaymentTrail["allocations"],
        reversals: [{ invoiceId: "inv1" }] as PaymentTrail["reversals"],
        entries: [
          credit("100.00"),
          reversal("100.00"),
        ] as PaymentTrail["entries"],
      })
    );
    expect(split).toMatchObject({
      reversed: true,
      total: "100.00",
      originalCredit: "20.00",
    });
  });

  it("is not posted before it reaches the ledger", () => {
    expect(buildPaymentSplit(trail())).toMatchObject({
      posted: false,
      reversed: false,
      credit: "0.00",
    });
  });

  it("calls a payment reversed only when the ledger nets to zero", () => {
    const split = buildPaymentSplit(
      trail({
        allocations: [
          allocation("inv1", "100.00"),
        ] as PaymentTrail["allocations"],
        reversals: [{ invoiceId: "inv1" }] as PaymentTrail["reversals"],
        entries: [
          credit("100.00"),
          reversal("100.00"),
        ] as PaymentTrail["entries"],
      })
    );
    expect(split).toMatchObject({
      reversed: true,
      applied: "0.00",
      credit: "0.00",
    });
    expect(split.invoices[0]).toMatchObject({ reversed: true });
  });

  it("keeps a payment that was reversed and then applied to another invoice", () => {
    const split = buildPaymentSplit(
      trail({
        allocations: [
          allocation("inv1", "100.00"),
          allocation("inv2", "100.00"),
        ] as PaymentTrail["allocations"],
        reversals: [{ invoiceId: "inv1" }] as PaymentTrail["reversals"],
        entries: [
          credit("100.00"),
          reversal("100.00"),
          credit("100.00"),
        ] as PaymentTrail["entries"],
      })
    );
    expect(split).toMatchObject({
      reversed: false,
      applied: "100.00",
      credit: "0.00",
    });
    expect(split.invoices.map((i) => i.reversed)).toEqual([true, false]);
  });
});
