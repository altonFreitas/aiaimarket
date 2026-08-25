import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Written by Apply-aiaimarket-hardening.js — pre-patch copies of the
    // files it edits. Linting them just re-reports every issue twice.
    ".audit-backup/**",
    ".payments-backup/**",
    "Apply*.js",

  ]),
  {
    rules: {
      // `const { id: _id, ...rest } = row` is the idiomatic way to omit keys
      // when copying a database row (see duplicateProduct). The discarded
      // bindings are the point, not an oversight -- an underscore prefix is
      // the conventional way to say so.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
