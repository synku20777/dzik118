import { describe, expect, it } from "vitest";
import { hmacSha256Hex, sha256Hex } from "../../src/lib/hash";

describe("hash", () => {
  it("sha256Hex is deterministic and content-sensitive", async () => {
    const a = await sha256Hex(new TextEncoder().encode("hello"));
    const b = await sha256Hex(new TextEncoder().encode("hello"));
    const c = await sha256Hex(new TextEncoder().encode("hello!"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it("hmacSha256Hex differs when the secret differs, for the same message", async () => {
    const a = await hmacSha256Hex("secret-a", "token123");
    const b = await hmacSha256Hex("secret-b", "token123");
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it("hmacSha256Hex is deterministic for the same secret and message", async () => {
    const a = await hmacSha256Hex("secret", "token123");
    const b = await hmacSha256Hex("secret", "token123");
    expect(a).toBe(b);
  });
});
