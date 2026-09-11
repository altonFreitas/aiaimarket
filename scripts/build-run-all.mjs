#!/usr/bin/env node
/**
 * Concatenates every SQL file into supabase/run-all.sql, in the order
 * SCHEMA_ORDER declares (src/lib/schemaHealth.ts).
 *
 * WHY A CONCATENATION AND NOT A RUNNER. These files are pasted into the
 * Supabase SQL editor by hand -- that is how this project is deployed, and
 * the editor has no \i, no psql meta-commands and no notion of a file. A
 * "manifest" nobody can execute is a second document to keep in step with
 * the first. One pasteable file is the thing that actually gets used.
 *
 * Every file is safe to re-run, which is what makes this safe to paste at
 * any point in a shop's life rather than only on day one.
 *
 *   node scripts/build-run-all.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "supabase");
const OUT = path.join(DIR, "run-all.sql");

/** Read the order out of the TypeScript rather than keeping a second copy
 * of it here. A regex, because this script must run with no build step and
 * no dependencies. */
function readOrder() {
  const src = fs.readFileSync(path.join(ROOT, "src", "lib", "schemaHealth.ts"), "utf8");
  const block = /export const SCHEMA_ORDER: readonly string\[\] = \[([\s\S]*?)\n\];/.exec(src);
  if (!block) throw new Error("SCHEMA_ORDER not found in src/lib/schemaHealth.ts");
  return [...block[1].matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
}

const order = readOrder();
/* Files that are deliberately NOT migrations, read out of schemaHealth.ts
 * so there is one list rather than two that can disagree. ci-bootstrap.sql
 * is the reason this exists: it stands in for what Supabase provides
 * before a project's first migration, is applied only to the bare Postgres
 * the integration tests run against, and must never reach a real database. */
function readExempt() {
  const src = fs.readFileSync(path.join(ROOT, "src", "lib", "schemaHealth.ts"), "utf8");
  const block = /export const NOT_SCHEMA_FILES: readonly string\[\] = \[([\s\S]*?)\n\];/.exec(src);
  if (!block) throw new Error("NOT_SCHEMA_FILES not found in src/lib/schemaHealth.ts");
  return [...block[1].matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
}

const exempt = new Set([...readExempt(), "run-all.sql"]);
const onDisk = fs.readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !exempt.has(f));

const missing = onDisk.filter((f) => !order.includes(f));
if (missing.length) {
  console.error("Not in SCHEMA_ORDER: " + missing.join(", "));
  process.exit(1);
}

const parts = [
  "-- =========================================================================",
  "-- Loja AIAI -- every migration, in order. GENERATED, do not edit.",
  "--",
  "--   node scripts/build-run-all.js",
  "--",
  "-- Paste the whole thing into the Supabase SQL editor and press Run. Every",
  "-- file in here is safe to re-run, so this is also how you catch a database",
  "-- up after adding features -- not only how you create one.",
  "--",
  "-- The order is SCHEMA_ORDER in src/lib/schemaHealth.ts, which a test keeps",
  "-- honest against the folder and against every \"Run AFTER\" a file states.",
  "-- =========================================================================",
  "",
];

for (const file of order) {
  const body = fs.readFileSync(path.join(DIR, file), "utf8").trimEnd();
  parts.push(
    "",
    "-- ==== " + file + " " + "=".repeat(Math.max(0, 66 - file.length)),
    "",
    body,
    ""
  );
}

fs.writeFileSync(OUT, parts.join("\n") + "\n", "utf8");
console.log(`wrote supabase/run-all.sql — ${order.length} files, ` +
  `${fs.statSync(OUT).size.toLocaleString()} bytes`);
