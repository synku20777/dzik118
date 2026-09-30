import { describe, expect, it } from "vitest";
import { describeError } from "../../src/domain/errors";

describe("describeError", () => {
  it("strips SQL parameters and secrets from query errors", () => {
    const fakeError = new Error(
      "Failed query: insert ... \nparams: a@b.com,secret"
    );

    const described = describeError(fakeError);

    expect(described.message).not.toContain("a@b.com");
    expect(described.message).not.toContain("secret");
  });
});
