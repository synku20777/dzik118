// Per-request DB connection for pages and actions (spec Section 3.2:
// production traffic goes through Hyperdrive). Lives outside src/db/client.ts
// on purpose: that file is also imported by scripts/seed.ts and
// db-migrate-fresh.ts, which run as plain Node scripts where the
// cloudflare:workers virtual module this file needs doesn't exist.
import { env, tracing } from "cloudflare:workers";
import { createDb, type Db } from "../db/client";

export async function withRequestDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await tracing.enterSpan("db.connect", () =>
    createDb(env.HYPERDRIVE.connectionString)
  );
  try {
    return await tracing.enterSpan("db.work", () => fn(db));
  } finally {
    await tracing.enterSpan("db.close", () => db.$client.end());
  }
}
