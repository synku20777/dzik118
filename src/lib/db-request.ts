// Per-request DB connection for pages and actions (spec Section 3.2:
// production traffic goes through Hyperdrive). Lives outside src/db/client.ts
// on purpose: that file is also imported by scripts/seed.ts and
// db-migrate-fresh.ts, which run as plain Node scripts where the
// cloudflare:workers virtual module this file needs doesn't exist.
import { env } from "cloudflare:workers";
import { createDb, type Db } from "../db/client";

export async function withRequestDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await createDb(env.HYPERDRIVE.connectionString);
  try {
    return await fn(db);
  } finally {
    await db.$client.end();
  }
}
