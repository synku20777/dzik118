import { describe, expect, it } from "vitest";
import { parseSesMessage } from "../../src/lib/email/ses-events";

const permanentBounce = {
  eventType: "Bounce",
  bounce: {
    bounceType: "Permanent",
    bounceSubType: "General",
    bouncedRecipients: [
      { emailAddress: "Gone@Example.com" },
      { emailAddress: "gone@example.com" },
      { emailAddress: "other@example.com" },
    ],
  },
};

describe("parseSesMessage", () => {
  it("reads a permanent bounce from event publishing", () => {
    expect(parseSesMessage(permanentBounce)).toEqual({
      reason: "BOUNCE",
      emails: ["gone@example.com", "other@example.com"],
      detail: "Permanent bounce: General",
    });
  });

  it("reads the identity notification shape and a JSON string", () => {
    const message = JSON.stringify({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "a@example.com" }],
      },
    });
    expect(parseSesMessage(message)?.emails).toEqual(["a@example.com"]);
  });

  it("reads a complaint", () => {
    expect(
      parseSesMessage({
        eventType: "Complaint",
        complaint: {
          complaintFeedbackType: "abuse",
          complainedRecipients: [{ emailAddress: "c@example.com" }],
        },
      })
    ).toEqual({
      reason: "COMPLAINT",
      emails: ["c@example.com"],
      detail: "Complaint: abuse",
    });
  });

  it("ignores transient bounces, deliveries, and unknown events", () => {
    expect(
      parseSesMessage({
        eventType: "Bounce",
        bounce: {
          bounceType: "Transient",
          bouncedRecipients: [{ emailAddress: "a@example.com" }],
        },
      })
    ).toBeNull();
    expect(parseSesMessage({ eventType: "Delivery" })).toBeNull();
    expect(parseSesMessage({ eventType: "Open" })).toBeNull();
  });

  it("ignores bad input and invalid addresses", () => {
    expect(parseSesMessage("not json")).toBeNull();
    expect(parseSesMessage(null)).toBeNull();
    expect(parseSesMessage(42)).toBeNull();
    expect(
      parseSesMessage({
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "not an email" }, {}],
        },
      })
    ).toBeNull();
  });
});
