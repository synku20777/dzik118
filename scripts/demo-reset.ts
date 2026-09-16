import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".dev.vars")) loadEnvFile(".dev.vars");

for (const name of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
  if (!process.env[name]) throw new Error(`${name} is required for demo:reset`);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (script: string, extraEnv: Record<string, string> = {}) =>
  execFileSync(npm, ["run", script], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });

console.log(
  `Resetting demo database at ${new URL(process.env.DATABASE_URL!).host}`
);
run("db:migrate:fresh", { CONFIRM_DB_FRESH: "yes" });
run("db:seed");
run("demo:auth");
run("storage:setup");

console.log(`
Demo ready.

Admin:   admin.a@example.com / ChangeMe123!
Resident: resident1@example.com (magic link via Mailpit/email)
Period:  September 2026
`);
