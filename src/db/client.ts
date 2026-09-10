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
