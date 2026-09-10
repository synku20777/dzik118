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
    },
  },
});
