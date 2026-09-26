import { describe, expect, it } from "vitest";
import { checkNewPassword } from "../../src/lib/auth/password";

describe("checkNewPassword", () => {
  it("accepts 8+ characters with no special characters or mixed case needed", () => {
    expect(checkNewPassword("abcdefgh", "abcdefgh")).toBeNull();
    expect(checkNewPassword("12345678", "12345678")).toBeNull();
  });
  it("rejects fewer than 8 characters", () => {
    expect(checkNewPassword("abcdefg", "abcdefg")).toBe("short");
  });
  it("rejects a mismatch", () => {
    expect(checkNewPassword("abcdefgh", "abcdefgH")).toBe("mismatch");
  });
  it("rejects more than bcrypt's 72 bytes", () => {
    const long = "a".repeat(73);
    expect(checkNewPassword(long, long)).toBe("long");
    expect(checkNewPassword("ā".repeat(37), "ā".repeat(37))).toBe("long");
  });
});
