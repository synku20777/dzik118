// Phase B (Database) - Drizzle database client (spec Section 3.2).
// Local dev connects to Postgres directly via DATABASE_URL. Production
// traffic goes through Cloudflare Hyperdrive; pass its connectionString
// (env.HYPERDRIVE.connectionString) here instead -- Hyperdrive exposes a
// regular Postgres connection string, so the same node-postgres client works
// for both. Drizzle Kit migrations always use direct credentials (Section
// 39), never this factory.
//
// Uses a single Client, not a Pool: Cloudflare's Hyperdrive guidance is to
// open one request-scoped connection and let Hyperdrive own pooling on its
// side (https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/).
// Callers own the connection lifecycle: call db.$client.end() when done (in a
// Worker, via ctx.waitUntil(db.$client.end())).
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

export async function createDb(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();
  return drizzle(client);
}

export type Db = Awaited<ReturnType<typeof createDb>>;

// The handle passed into a db.transaction(async (tx) => ...) callback has
// no $client (you can't end the connection mid-transaction) and so isn't
// structurally assignable to Db. Domain functions that get called with
// either the top-level db or a tx (nearly all of them, since audit writes
// must land in the same transaction as the mutation they describe, spec
// Section 31) should take DbOrTx instead of Db.
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

// Runs queries one after the other, in place of Promise.all. The single
// connection runs one query at a time, and pg 9 removes the internal queue
// that Promise.all on one client relied on. Pass query builders (they start
// when awaited), not promises that are already running.
export async function inOrder<T extends readonly PromiseLike<unknown>[]>(
  queries: readonly [...T]
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query);
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
}
