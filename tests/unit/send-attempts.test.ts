import { describe, expect, it } from "vitest";
import {
  classifyAttemptStaleness,
  STALE_CLAIM_MS,
  STALE_DISPATCH_MS,
} from "../../src/domain/billing/send-attempts";

describe("send attempts staleness classification", () => {
  const baseTime = 1_000_000;

  it("classifies fresh CLAIMED attempt as not stale", () => {
    const claimedAt = new Date(baseTime);
    const result = classifyAttemptStaleness(
      "CLAIMED",
      claimedAt,
      null,
      baseTime + 10_000
    );
    expect(result.isStale).toBe(false);
  });

  it("classifies CLAIMED attempt older than STALE_CLAIM_MS as FAILED (ABANDONED_BEFORE_DISPATCH)", () => {
    const claimedAt = new Date(baseTime);
    const result = classifyAttemptStaleness(
      "CLAIMED",
      claimedAt,
      null,
      baseTime + STALE_CLAIM_MS
    );
    expect(result.isStale).toBe(true);
    if (result.isStale) {
      expect(result.targetStatus).toBe("FAILED");
      expect(result.errorCode).toBe("ABANDONED_BEFORE_DISPATCH");
    }
  });

  it("classifies fresh DISPATCHING attempt as not stale", () => {
    const claimedAt = new Date(baseTime - 10_000);
    const dispatchStartedAt = new Date(baseTime);
    const result = classifyAttemptStaleness(
      "DISPATCHING",
      claimedAt,
      dispatchStartedAt,
      baseTime + 30_000
    );
    expect(result.isStale).toBe(false);
  });

  it("classifies DISPATCHING attempt older than STALE_DISPATCH_MS as UNKNOWN (STALE_DISPATCH_NO_CONFIRMATION)", () => {
    const claimedAt = new Date(baseTime - 10_000);
    const dispatchStartedAt = new Date(baseTime);
    const result = classifyAttemptStaleness(
      "DISPATCHING",
      claimedAt,
      dispatchStartedAt,
      baseTime + STALE_DISPATCH_MS
    );
    expect(result.isStale).toBe(true);
    if (result.isStale) {
      expect(result.targetStatus).toBe("UNKNOWN");
      expect(result.errorCode).toBe("STALE_DISPATCH_NO_CONFIRMATION");
    }
  });

  it("falls back to claimedAt when dispatchStartedAt is null for DISPATCHING", () => {
    const claimedAt = new Date(baseTime);
    const result = classifyAttemptStaleness(
      "DISPATCHING",
      claimedAt,
      null,
      baseTime + STALE_DISPATCH_MS + 1
    );
    expect(result.isStale).toBe(true);
    if (result.isStale) {
      expect(result.targetStatus).toBe("UNKNOWN");
      expect(result.errorCode).toBe("STALE_DISPATCH_NO_CONFIRMATION");
    }
  });

  it("never classifies terminal states (SENT, FAILED, UNKNOWN) as stale", () => {
    const ancient = new Date(baseTime - 100 * STALE_DISPATCH_MS);
    expect(
      classifyAttemptStaleness("SENT", ancient, ancient, baseTime).isStale
    ).toBe(false);
    expect(
      classifyAttemptStaleness("FAILED", ancient, ancient, baseTime).isStale
    ).toBe(false);
    expect(
      classifyAttemptStaleness("UNKNOWN", ancient, ancient, baseTime).isStale
    ).toBe(false);
  });
});
