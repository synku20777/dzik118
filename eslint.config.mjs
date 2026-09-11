import eslintPluginAstro from "eslint-plugin-astro";
import tseslint from "typescript-eslint";
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/",
      ".astro/",
      "node_modules/",
      ".github/",
      "drizzle/migrations/",
      "docs/",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    // Plain .mjs scripts (unlike .ts files, where typescript-eslint's
    // recommended config disables no-undef entirely) get no ambient globals
    // from js.configs.recommended -- console/process read as undefined.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
