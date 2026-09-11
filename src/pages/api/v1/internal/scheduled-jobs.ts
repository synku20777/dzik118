// Phase L (Automation/audit) - POST /api/v1/internal/scheduled-jobs (spec
// Section 32). The Worker's `scheduled` export (dist/server/scheduled-
// entry.mjs, written post-build by scripts/postbuild-wire-scheduled.mjs)
// self-fetches this endpoint rather than importing the scheduler domain
// code directly, because that wrapper sits outside Astro's own bundling --
// project modules end up in build chunks with hashed, unpredictable
// filenames it can't reliably import. This is otherwise a normal,
// publicly-routable API endpoint, so it requires a shared secret; there is
// no admin session to authorize against.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  APP_BASE_URL,
  INTERNAL_CRON_SECRET,
  INVOICE_TOKEN_SECRET,
} from "astro:env/server";
import { createDb } from "../../../../db/client";
import { runScheduledJobs } from "../../../../domain/automation/scheduler";
import { renderPdf } from "../../../../lib/pdf/render";
import { getSupabaseAdmin } from "../../../../actions/_supabase_admin";
import { getEmailService } from "../../../../actions/_email";
import { sha256Hex } from "../../../../lib/hash";

// Comparing SHA-256 digests instead of the raw strings avoids leaking
// early-exit timing on the first differing byte/length of the actual
// secret -- a fixed-size hash comparison is a much smaller timing side
// channel than String !== on variable-length input.
async function secretsMatch(provided: string, expected: string) {
  const [a, b] = await Promise.all([
    sha256Hex(new TextEncoder().encode(provided)),
    sha256Hex(new TextEncoder().encode(expected)),
  ]);
  return a === b;
}

export const POST: APIRoute = async ({ request }) => {
  const provided = request.headers.get("x-internal-cron-secret");
  if (!provided || !(await secretsMatch(provided, INTERNAL_CRON_SECRET))) {
    return new Response("Forbidden", { status: 403 });
  }

  const db = await createDb(env.HYPERDRIVE.connectionString);
  try {
    const results = await runScheduledJobs(db, {
      renderPdf: (html) => renderPdf(env.BROWSER, html),
      supabaseAdmin: getSupabaseAdmin(),
      emailService: getEmailService(),
      tokenSecret: INVOICE_TOKEN_SECRET,
      appBaseUrl: APP_BASE_URL,
    });
    // A non-200 here is what makes a failure observable at all: the
    // scheduled wrapper (dist/server/scheduled-entry.mjs) checks
    // response.ok and throws if not, which is what makes Cloudflare's own
    // Cron Trigger execution log show this invocation as failed (spec
    // Section 32: "observable") instead of a silent per-organization error
    // that nothing outside a direct curl would ever see.
    const anyError = results.some((r) => r.error);
    return new Response(JSON.stringify(results), {
      status: anyError ? 500 : 200,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await db.$client.end();
  }
};
