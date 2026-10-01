import { describe, expect, it } from "vitest";
import {
  buildSchedulerAlert,
  isSchedulerFailure,
} from "../../src/lib/email/alert";

describe("buildSchedulerAlert", () => {
  it("formats counts and failure lines when 2 of 5 organizations fail", () => {
    const results = [
      { organizationId: "org-1", error: "Connection timeout" },
      { organizationId: "org-2" },
      { organizationId: "org-3", error: "Invalid currency code" },
      { organizationId: "org-4" },
      { organizationId: "org-5" },
    ];

    const alert = buildSchedulerAlert(results);

    expect(alert.subject).toBe("Namkopa: scheduled job failed");
    expect(alert.text).toContain("2 of 5 organizations failed.");
    expect(alert.text).toContain("Organization org-1: Connection timeout");
    expect(alert.text).toContain("Organization org-3: Invalid currency code");
    expect(alert.text).not.toContain("Organization org-2");
    expect(alert.text).toContain(
      "Open the Cloudflare Workers logs for details."
    );
  });

  it("truncates long organization error messages to 200 characters", () => {
    const longError = "x".repeat(250);
    const results = [{ organizationId: "org-long", error: longError }];

    const alert = buildSchedulerAlert(results);

    expect(alert.text).toContain(`Organization org-long: ${"x".repeat(200)}`);
    expect(alert.text).not.toContain("x".repeat(201));
  });

  it("limits failure lines to 10 and includes 'and N more' when more than 10 fail", () => {
    const results = Array.from({ length: 13 }, (_, i) => ({
      organizationId: `org-${i + 1}`,
      error: `Error ${i + 1}`,
    }));

    const alert = buildSchedulerAlert(results);

    expect(alert.text).toContain("13 of 13 organizations failed.");
    for (let i = 1; i <= 10; i++) {
      expect(alert.text).toContain(`Organization org-${i}: Error ${i}`);
    }
    expect(alert.text).not.toContain("Organization org-11:");
    expect(alert.text).not.toContain("Organization org-12:");
    expect(alert.text).not.toContain("Organization org-13:");
    expect(alert.text).toContain("and 3 more");
    expect(alert.text).toContain(
      "Open the Cloudflare Workers logs for details."
    );
  });

  it("handles thrown Error and non-Error cases correctly", () => {
    const errorAlert = buildSchedulerAlert(
      null,
      new Error("Database connection lost")
    );
    expect(errorAlert.subject).toBe("Namkopa: scheduled job failed");
    expect(errorAlert.text).toContain(
      "The job stopped with an error: Database connection lost"
    );
    expect(errorAlert.text).toContain(
      "Open the Cloudflare Workers logs for details."
    );

    const nonErrorAlert = buildSchedulerAlert(null, "some string rejection");
    expect(nonErrorAlert.subject).toBe("Namkopa: scheduled job failed");
    expect(nonErrorAlert.text).toContain(
      "The job stopped with an error: unknown error"
    );
    expect(nonErrorAlert.text).toContain(
      "Open the Cloudflare Workers logs for details."
    );
  });

  it("ensures the alert text contains no stack trace ('at ' lines) when given an Error with a stack", () => {
    const errWithStack = new Error("Catastrophic scheduler failure");
    expect(errWithStack.stack).toBeDefined();
    expect(errWithStack.stack).toContain("at ");

    const alert = buildSchedulerAlert(null, errWithStack);

    expect(alert.text).toContain(
      "The job stopped with an error: Catastrophic scheduler failure"
    );
    expect(alert.text).not.toContain("at ");
  });

  it("hides email addresses and long numbers in error text", () => {
    const alert = buildSchedulerAlert([
      {
        organizationId: "org-pii",
        error:
          "insert failed for jane.doe@example.com iban LV80BANK0000435195001",
      },
    ]);
    expect(alert.text).not.toContain("jane.doe@example.com");
    expect(alert.text).not.toContain("0000435195001");
    expect(alert.text).toContain("[email]");
  });

  it("reports organizations with undelivered invoices even without an error", () => {
    const results = [
      { organizationId: "org-a", failedSends: 2 },
      { organizationId: "org-b", failedSends: 0 },
    ];
    expect(isSchedulerFailure(results)).toBe(true);
    expect(isSchedulerFailure([{ organizationId: "org-b" }])).toBe(false);
    const alert = buildSchedulerAlert(results);
    expect(alert.text).toContain("1 of 2 organizations failed.");
    expect(alert.text).toContain(
      "Organization org-a: 2 invoice(s) were not delivered"
    );
  });
});
