import eslintPluginAstro from "eslint-plugin-astro";
import tseslint from "typescript-eslint";
import js from "@eslint/js";

export default [
  {
    ignores: [
      "dist/",
      ".astro/",
      "node_modules/",
      ".github/",
      "drizzle/migrations/",
      "docs/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
