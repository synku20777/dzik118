import { describe, expect, it } from "vitest";
import {
  getRequestContext,
  hashIp,
  newRequestId,
  runWithRequestContext,
} from "../../src/lib/logging/request-context";

describe("request context", () => {
  it("is visible inside the run, also after awaits, and gone outside it", async () => {
    expect(getRequestContext()).toBeUndefined();
    await runWithRequestContext(
      { requestId: "req_a", ipHash: null },
      async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(getRequestContext()?.requestId).toBe("req_a");
      }
    );
    expect(getRequestContext()).toBeUndefined();
  });

  it("keeps two overlapping requests apart", async () => {
    const seen: string[] = [];
    await Promise.all(
      ["req_1", "req_2"].map((requestId, index) =>
        runWithRequestContext({ requestId, ipHash: null }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5 - index * 4));
          seen.push(`${requestId}:${getRequestContext()?.requestId}`);
        })
      )
    );
    expect(seen.sort()).toEqual(["req_1:req_1", "req_2:req_2"]);
  });

  it("makes request IDs that differ", () => {
    expect(newRequestId()).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(newRequestId()).not.toBe(newRequestId());
  });
});

describe("hashIp", () => {
  it("is stable, depends on the secret, and does not contain the IP", async () => {
    const a = await hashIp("203.0.113.9", "secret-one");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashIp("203.0.113.9", "secret-one")).toBe(a);
    expect(await hashIp("203.0.113.9", "secret-two")).not.toBe(a);
    expect(await hashIp("203.0.113.10", "secret-one")).not.toBe(a);
    expect(a).not.toContain("203");
  });

  it("returns null without an IP or without a secret", async () => {
    expect(await hashIp(null, "secret")).toBeNull();
    expect(await hashIp("203.0.113.9", undefined)).toBeNull();
    expect(await hashIp("203.0.113.9", "")).toBeNull();
  });
});
