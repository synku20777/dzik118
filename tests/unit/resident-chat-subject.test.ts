import { describe, expect, it } from "vitest";
import { subjectFromBody } from "../../src/domain/messaging/conversations";

describe("subjectFromBody", () => {
  it("uses the first line that has text", () => {
    expect(subjectFromBody("\n  Water   leak \nin the kitchen")).toBe(
      "Water leak"
    );
  });

  it("cuts a long line to 60 characters with an ellipsis", () => {
    const subject = subjectFromBody("a".repeat(59) + " bcd");
    expect(subject).toBe("a".repeat(59) + "…");
    expect(subject).toHaveLength(60);
  });

  it("keeps a line of exactly 60 characters", () => {
    expect(subjectFromBody("b".repeat(60))).toBe("b".repeat(60));
  });
});
