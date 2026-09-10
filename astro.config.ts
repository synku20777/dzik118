import { defineConfig, envField } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  env: {
    schema: {
      // Server-only secrets (spec Section 6). astro:env reads these from
      // Worker bindings in production and .dev.vars/.env locally, uniformly
      // -- no need to thread locals.runtime.env through every file.
      SUPABASE_URL: envField.string({ context: "server", access: "secret" }),
      SUPABASE_PUBLISHABLE_KEY: envField.string({
        context: "server",
        access: "secret",
      }),
      // Client-exposed duplicates of the two values above: the publishable
      // key is designed to be public (spec Section 6 only forbids exposing
      // the *secret* key), and the admin password sign-in form needs a
      // browser-side Supabase client (spec Section 34) to call
      // signInWithPassword directly rather than us reimplementing it.
      PUBLIC_SUPABASE_URL: envField.string({
        context: "client",
        access: "public",
      }),
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({
        context: "client",
        access: "public",
      }),
      SUPABASE_SECRET_KEY: envField.string({
        context: "server",
        access: "secret",
      }),
      APP_BASE_URL: envField.string({ context: "server", access: "secret" }),
      // Spec Section 15.2: /admin/** must require AAL2 (MFA) at production
      // readiness. Phase C ships no MFA enrollment UI yet, so this defaults
      // to false (AAL1 permitted) and MUST be forbidden (forced true) before
      // production -- see docs/decisions/0002-admin-aal2-boundary.md.
      ADMIN_REQUIRE_AAL2: envField.boolean({
        context: "server",
        access: "public",
        default: false,
      }),
      // Phase G (Invoices/delivery, spec Section 3.6/6/23). Empty/unset in
      // local dev (.dev.vars never sets a real AWS key) selects the local
      // SMTP-to-Mailpit fallback instead of Amazon SES -- see
      // src/lib/email/index.ts. Defaults keep `npm run build`/CI working
      // without real secrets configured, matching the SUPABASE_* pattern.
      AWS_SES_ACCESS_KEY_ID: envField.string({
        context: "server",
        access: "secret",
        default: "",
      }),
      AWS_SES_SECRET_ACCESS_KEY: envField.string({
        context: "server",
        access: "secret",
        default: "",
      }),
      AWS_SES_REGION: envField.string({
        context: "server",
        access: "secret",
        default: "eu-central-1",
      }),
      EMAIL_FROM: envField.string({
        context: "server",
        access: "secret",
        default: "invoices@example.com",
      }),
      // Pepper for invoice access token hashes (spec Section 6/24): stored
      // hash is HMAC-SHA256(this secret, rawToken), not plain SHA-256, so a
      // leaked database alone can't be used to precompute/verify guesses
      // offline against a known token format.
      INVOICE_TOKEN_SECRET: envField.string({
        context: "server",
        access: "secret",
        default: "dev-only-insecure-default-change-in-production",
      }),
    },
  },
});
