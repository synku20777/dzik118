import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `npm run preview` (astro preview) daemonizes itself under the Cloudflare
    // adapter and its wrapper process exits immediately, which Playwright's
    // webServer supervisor mistakes for a crash. `wrangler dev` runs in the
    // foreground instead, so Playwright can supervise it directly.
    command: "npm run build && npx wrangler dev --port 4321",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
