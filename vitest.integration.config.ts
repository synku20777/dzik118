import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts (unit tests, no external dependencies) --
// these tests need a real Postgres reachable via DATABASE_URL. Spec Section
// 38 runs this only "before release", not on every commit.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
  },
});
