// secretsMatch is the only check in front of the cron and SES endpoints.
import { describe, expect, it } from "vitest";
import { secretsMatch } from "../../src/lib/http/secrets";

describe("secretsMatch", () => {
  it("accepts only the exact secret", async () => {
    expect(await secretsMatch("s3cret", "s3cret")).toBe(true);
    expect(await secretsMatch("s3cret ", "s3cret")).toBe(false);
    expect(await secretsMatch("S3CRET", "s3cret")).toBe(false);
    expect(await secretsMatch("s3cre", "s3cret")).toBe(false);
  });

  it("refuses an empty value on either side", async () => {
    // An unset server secret must not match an empty header.
    expect(await secretsMatch("", "")).toBe(false);
    expect(await secretsMatch("x", "")).toBe(false);
    expect(await secretsMatch("", "x")).toBe(false);
  });
});
