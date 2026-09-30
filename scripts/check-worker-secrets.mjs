// Fails a deploy when a runtime secret is missing from the Cloudflare Worker.
// Some of these have a safe-for-development default in astro.config.ts
// (INVOICE_TOKEN_SECRET, EMAIL_FROM, the AWS keys). A missing secret does not
// raise an error: the app silently uses the default. In production that means
// a public token pepper, the example.com sender, or mail sent to a local SMTP
// port that does not exist. This check stops the deploy before that happens.
//
// Checks names only. It cannot see values.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const REQUIRED_WORKER_SECRETS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "APP_BASE_URL",
  "INVOICE_TOKEN_SECRET",
  "INTERNAL_CRON_SECRET",
  "EMAIL_FROM",
  "AWS_SES_ACCESS_KEY_ID",
  "AWS_SES_SECRET_ACCESS_KEY",
];

export function missingSecrets(listed, required = REQUIRED_WORKER_SECRETS) {
  const have = new Set(listed);
  return required.filter((name) => !have.has(name));
}

// Wrangler prints code 10007 when the Worker has never been deployed. That is
// the only failure the first deploy may skip. Any other failure (bad token,
// network, unreadable output) must stop the deploy, because the check could
// not do its job.
export function workerDoesNotExist(output) {
  return /\b10007\b|does not exist on your account/i.test(output ?? "");
}

function listWorkerSecrets() {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", "secret", "list", "--format", "json"],
    { encoding: "utf8", shell: process.platform === "win32" }
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    return { names: null, firstDeploy: workerDoesNotExist(output), output };
  }
  try {
    const names = JSON.parse(result.stdout).map((entry) => entry.name);
    return { names, firstDeploy: false, output };
  } catch {
    return { names: null, firstDeploy: false, output };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { names, firstDeploy, output } = listWorkerSecrets();
  if (names === null && firstDeploy) {
    console.warn(
      "The Worker does not exist yet (first deploy). Skipping the secrets check."
    );
  } else if (names === null) {
    console.error(
      `Could not list the Worker secrets, so the check cannot run.\n${output.trim().slice(0, 500)}`
    );
    process.exitCode = 1;
  } else {
    const missing = missingSecrets(names);
    if (missing.length > 0) {
      console.error(
        `Missing Worker secrets: ${missing.join(", ")}.\nSet each one with: wrangler secret put <NAME>\nSee docs/deployment/DEPLOYMENT_RUNBOOK.md section 6.`
      );
      process.exitCode = 1;
    } else {
      console.log("All required Worker secrets are set.");
    }
  }
}
