import { describe, expect, it } from "vitest";
import {
  REQUIRED_WORKER_SECRETS,
  missingSecrets,
  workerDoesNotExist,
} from "../../scripts/check-worker-secrets.mjs";

describe("missingSecrets", () => {
  it("returns nothing when every required secret is set", () => {
    expect(missingSecrets([...REQUIRED_WORKER_SECRETS, "ALERT_EMAIL"])).toEqual(
      []
    );
  });

  it("lists the missing names, including ones with a development default", () => {
    const listed = REQUIRED_WORKER_SECRETS.filter(
      (name: string) => name !== "INVOICE_TOKEN_SECRET" && name !== "EMAIL_FROM"
    );
    expect(missingSecrets(listed)).toEqual([
      "INVOICE_TOKEN_SECRET",
      "EMAIL_FROM",
    ]);
  });

  it("requires the AWS keys, so mail never falls back to a local SMTP port", () => {
    expect(REQUIRED_WORKER_SECRETS).toContain("AWS_SES_ACCESS_KEY_ID");
    expect(REQUIRED_WORKER_SECRETS).toContain("AWS_SES_SECRET_ACCESS_KEY");
  });

  it("skips only a Worker that has never been deployed", () => {
    expect(
      workerDoesNotExist(
        "✘ [ERROR] This Worker does not exist on your account. [code: 10007]"
      )
    ).toBe(true);
    expect(
      workerDoesNotExist("A request to the Cloudflare API failed [code: 10007]")
    ).toBe(true);
    for (const other of [
      "Authentication error [code: 10000]",
      "fetch failed: getaddrinfo ENOTFOUND api.cloudflare.com",
      "Unexpected token < in JSON",
      "",
      undefined,
    ]) {
      expect(workerDoesNotExist(other)).toBe(false);
    }
  });

  it("does not require the optional secrets", () => {
    for (const optional of [
      "ALERT_EMAIL",
      "AUDIT_HASH_SECRET",
      "SES_EVENTS_SECRET",
      "SES_SNS_TOPIC_ARN",
    ]) {
      expect(REQUIRED_WORKER_SECRETS).not.toContain(optional);
    }
  });
});
