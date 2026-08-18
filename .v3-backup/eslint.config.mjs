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
]);

export default eslintConfig;
