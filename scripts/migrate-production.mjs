import { spawnSync } from "node:child_process";

const connectionString = process.env.PRODUCTION_DATABASE_URL;
if (!connectionString) {
  throw new Error("PRODUCTION_DATABASE_URL is required");
}

const target = new URL(connectionString);
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(
    target.hostname
  )
) {
  throw new Error(
    "PRODUCTION_DATABASE_URL must target a non-local PostgreSQL database"
  );
}

const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "db:migrate"],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: connectionString },
  }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
