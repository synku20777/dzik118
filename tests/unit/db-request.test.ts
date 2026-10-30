import { expect, it, vi } from "vitest";

const { createDb, end, spans } = vi.hoisted(() => ({
  createDb: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  spans: [] as string[],
}));

vi.mock("cloudflare:workers", () => ({
  env: { HYPERDRIVE: { connectionString: "test" } },
  tracing: {
    enterSpan: (name: string, fn: () => unknown) => {
      spans.push(name);
      return fn();
    },
  },
}));
vi.mock("../../src/db/client", () => ({ createDb }));

import { withRequestDb } from "../../src/lib/db-request";

it("tracing preserves results, errors, and connection cleanup", async () => {
  const db = { $client: { end } };
  createDb.mockResolvedValue(db);
  expect(
    await withRequestDb(async (received) => {
      expect(received).toBe(db);
      return 42;
    })
  ).toBe(42);

  const error = new Error("query failed");
  await expect(
    withRequestDb(async () => {
      throw error;
    })
  ).rejects.toBe(error);
  expect(end).toHaveBeenCalledTimes(2);
  expect(spans).toEqual([
    "db.connect",
    "db.work",
    "db.close",
    "db.connect",
    "db.work",
    "db.close",
  ]);

  createDb.mockRejectedValue(error);
  await expect(withRequestDb(async () => 42)).rejects.toBe(error);
  expect(end).toHaveBeenCalledTimes(2);
});
