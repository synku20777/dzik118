import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*",
  out: "./drizzle/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
