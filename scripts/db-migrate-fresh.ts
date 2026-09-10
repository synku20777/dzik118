// Phase B (Database) - Drops and recreates the public schema, then reapplies
// all migrations from scratch. Local/CI use only (spec Section 38 pre-release
// gate); never point this at a production DATABASE_URL.
import { execSync } from "node:child_process";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for db:migrate:fresh");
}

// This drops every table on whatever DATABASE_URL happens to be set. Require
// an explicit, separate opt-in so a stray/misconfigured env var pointing at
// a real database can't wipe it by accident.
if (process.env.CONFIRM_DB_FRESH !== "yes") {
  throw new Error(
    "db:migrate:fresh drops and recreates the entire schema at DATABASE_URL. " +
      "Set CONFIRM_DB_FRESH=yes to confirm you mean to do this to that specific database."
  );
}

const client = new Client({ connectionString });
await client.connect();
// Also drop the "drizzle" schema: that's where drizzle-kit's migration
// journal (__drizzle_migrations) lives. Without this, drizzle-kit thinks
// already-recorded migrations are still applied and skips re-running them
// against the freshly emptied public schema.
await client.query(
  "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
);
await client.end();

execSync("npx drizzle-kit migrate", { stdio: "inherit" });
