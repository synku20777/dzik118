import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ Client: class {} }));

import { inOrder } from "../../src/db/client";

// A stand-in for a Drizzle query builder: it starts when it is awaited.
function query<T>(log: string[], name: string, value: T): PromiseLike<T> {
  return {
    then(resolve, reject) {
      log.push(`${name} start`);
      return new Promise<T>((done) => setTimeout(() => done(value), 5))
        .then((result) => {
          log.push(`${name} end`);
          return result;
        })
        .then(resolve, reject);
    },
  };
}

describe("inOrder", () => {
  it("starts each query only after the one before it has finished", async () => {
    const log: string[] = [];
    const [a, b] = await inOrder([query(log, "a", 1), query(log, "b", "two")]);
    expect([a, b]).toEqual([1, "two"]);
    expect(log).toEqual(["a start", "a end", "b start", "b end"]);
  });
});
