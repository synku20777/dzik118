import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeMutation,
  confirmMutation,
  failMutation,
  markReconciling,
  markVerifying,
  mutationCounts,
  resetMutationsForTest,
  retryMutation,
  runMutationRecovery,
  startMutation,
  subscribeMutations,
  type MutationStatus,
} from "../../src/lib/ui/mutations";

describe("UI mutation lifecycle", () => {
  afterEach(() => {
    resetMutationsForTest();
    vi.useRealTimers();
  });

  it("does not report success until confirmation and reconciliation finish", () => {
    vi.useFakeTimers();
    const statuses: MutationStatus[] = [];
    const unsubscribe = subscribeMutations((items) => {
      if (items[0]) statuses.push(items[0].status);
    });

    startMutation({
      id: "mutation:meter:create:1",
      entity: "meter",
      operation: "create",
      label: "Adding meter…",
    });
    confirmMutation("mutation:meter:create:1");
    markReconciling("mutation:meter:create:1");
    completeMutation("mutation:meter:create:1", "Meter added");

    expect(statuses).toEqual([
      "pending",
      "confirmed",
      "reconciling",
      "success",
    ]);
    unsubscribe();
  });

  it("reports trustworthy saving and attention counts", () => {
    let latest = mutationCounts([]);
    const unsubscribe = subscribeMutations((items) => {
      latest = mutationCounts(items);
    });
    expect(latest).toEqual({ active: 0, errors: 0 });

    startMutation({
      id: "mutation:meter:create:1",
      entity: "meter",
      operation: "create",
      label: "Adding meter…",
    });
    startMutation({
      id: "mutation:dwelling:create:2",
      entity: "dwelling",
      operation: "create",
      label: "Creating dwelling…",
    });
    expect(latest).toEqual({ active: 2, errors: 0 });

    failMutation("mutation:meter:create:1", "No connection");
    expect(latest).toEqual({ active: 1, errors: 1 });
    unsubscribe();
  });

  it("dismisses the failed entry before retrying the same user intent", () => {
    const retry = vi.fn();
    let latest = mutationCounts([]);
    const unsubscribe = subscribeMutations((items) => {
      latest = mutationCounts(items);
    });
    startMutation({
      id: "mutation:meter:create:retry",
      entity: "meter",
      operation: "create",
      label: "Adding meter…",
      retry,
    });
    failMutation("mutation:meter:create:retry", "Network error");

    retryMutation("mutation:meter:create:retry");

    expect(retry).toHaveBeenCalledOnce();
    expect(latest).toEqual({ active: 0, errors: 0 });
    unsubscribe();
  });

  it("keeps in-flight state when Astro loads the store through another page chunk", async () => {
    startMutation({
      id: "mutation:resident-access:create:swap",
      entity: "resident-access",
      operation: "create",
      label: "Adding resident…",
    });
    vi.resetModules();
    const reloaded = await import("../../src/lib/ui/mutations");
    let active = 0;
    const unsubscribe = reloaded.subscribeMutations((items) => {
      active = reloaded.mutationCounts(items).active;
    });

    expect(active).toBe(1);
    unsubscribe();
  });

  it("persists recovery identifiers without persisting business labels", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    startMutation({
      id: "mutation:meter:create:private",
      entity: "meter",
      operation: "create",
      label: "Cold water ABC123",
      messageKey: "Adding meter…",
      successMessageKey: "Meter added",
      recovery: {
        organizationId: "00000000-0000-4000-8000-000000000001",
        clientMutationId: "00000000-0000-4000-8000-000000000002",
        originPath: "/admin/o/example/dwellings/example",
      },
    });
    markVerifying("mutation:meter:create:private");

    const stored = [...values.values()].join("");
    expect(stored).toContain("Adding meter…");
    expect(stored).not.toContain("Cold water ABC123");
    vi.unstubAllGlobals();
  });

  it("runs only one recovery worker for a mutation ID", async () => {
    const lookup = vi.fn().mockResolvedValue({
      state: "committed",
      entity: { id: "meter-1" },
    });
    const committed = vi.fn();
    const callbacks = { committed, unknown: vi.fn() };

    runMutationRecovery("mutation:meter:create:one", lookup, callbacks);
    runMutationRecovery("mutation:meter:create:one", lookup, callbacks);

    await vi.waitFor(() => expect(committed).toHaveBeenCalledOnce());
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("bounds unknown-outcome checks and only checks again without retrying create", async () => {
    vi.useFakeTimers();
    const lookup = vi.fn().mockResolvedValue({ state: "missing" });
    let checkAgain: (() => void) | undefined;
    const unknown = vi.fn((next: () => void) => {
      checkAgain = next;
    });

    runMutationRecovery("mutation:meter:create:unknown", lookup, {
      committed: vi.fn(),
      unknown,
    });
    await vi.runAllTimersAsync();

    expect(lookup).toHaveBeenCalledTimes(6);
    expect(unknown).toHaveBeenCalledOnce();
    expect(checkAgain).toBeTypeOf("function");

    checkAgain!();
    await vi.runAllTimersAsync();
    expect(lookup).toHaveBeenCalledTimes(12);
  });
});
