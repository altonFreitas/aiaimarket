import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_ORDER, SCHEMA_FEATURES, NOT_SCHEMA_FILES, INVENTORY_FILE } from "@/lib/schemaHealth";

/* The order these files have to be run in, checked rather than described.
 *
 * WHAT THIS REPLACES. The ordering constraints lived in prose inside the
 * files -- stock-ledger.sql says "Run AFTER supabase/stock-receipt.sql" --
 * and nothing checked that any list anybody actually followed respected
 * them. It did not: SCHEMA_FEATURES, the only other ordered list of these
 * files, has returns.sql tenth and the stock-ledger it depends on
 * twenty-fifth. An operator working down that list gets a database that
 * fails halfway.
 *
 * So the prose is now the specification and this is the test of it.
 */
const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "supabase");

const files = () => fs.readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && f !== "run-all.sql");

describe("SCHEMA_ORDER", () => {
  it("names every SQL file, once", () => {
    expect([...SCHEMA_ORDER].sort()).toEqual(files().sort());
    expect(new Set(SCHEMA_ORDER).size).toBe(SCHEMA_ORDER.length);
  });

  it("respects every 'Run AFTER' a file states in its own header", () => {
    // The constraint the old list broke. Read out of the files themselves,
    // so adding a new dependency to a header is enough to have it enforced.
    const problems: string[] = [];
    for (const file of files()) {
      const body = fs.readFileSync(path.join(DIR, file), "utf8");
      for (const m of body.matchAll(/run after\s+(?:supabase\/)?([\w.-]+\.sql)/gi)) {
        const dep = m[1];
        const here = SCHEMA_ORDER.indexOf(file);
        const there = SCHEMA_ORDER.indexOf(dep);
        if (there === -1) { problems.push(`${file} needs ${dep}, which is not in SCHEMA_ORDER`); }
        else if (there > here) { problems.push(`${file} (${here}) runs before ${dep} (${there})`); }
      }
    }
    expect(problems).toEqual([]);
  });

  it("starts with the file that creates everything else's tables", () => {
    expect(SCHEMA_ORDER[0]).toBe("schema.sql");
  });

  it("ends with the two files that take things away, then the sample data", () => {
    // harden-rls.sql drops open policies and patch-audit-hardening.sql
    // revokes grants. Anything that CREATES one has to have run already, or
    // it is dropped and then quietly recreated behind their backs.
    const tail = SCHEMA_ORDER.slice(-3);
    expect(tail).toEqual(["harden-rls.sql", "patch-audit-hardening.sql", "seed.sql"]);
  });

  it("agrees with the health panel about which files exist", () => {
    // Two lists of the same files that can disagree is how one of them
    // stops being maintained.
    const known = new Set([
      INVENTORY_FILE, ...SCHEMA_FEATURES.map((f) => f.file), ...NOT_SCHEMA_FILES,
    ]);
    expect(SCHEMA_ORDER.filter((f) => !known.has(f))).toEqual([]);
  });
});

describe("supabase/run-all.sql", () => {
  const generated = () => fs.readFileSync(path.join(DIR, "run-all.sql"), "utf8");

  it("exists, because the deployment guide points at it", () => {
    expect(fs.existsSync(path.join(DIR, "run-all.sql"))).toBe(true);
  });

  it("contains every file, in order", () => {
    // Regenerate with `node scripts/build-run-all.mjs` when this fails --
    // which it will, the first time somebody adds a migration and forgets.
    const body = generated();
    const marks = [...body.matchAll(/^-- ==== ([\w.-]+\.sql) =/gm)].map((m) => m[1]);
    expect(marks).toEqual([...SCHEMA_ORDER]);
  });

  it("is not stale", () => {
    // Cheap proof that the concatenation still matches the parts: the last
    // line of each source file has to appear somewhere in the bundle.
    const body = generated();
    for (const file of SCHEMA_ORDER) {
      const src = fs.readFileSync(path.join(DIR, file), "utf8").trimEnd();
      const lastLine = src.split("\n").filter((l) => l.trim()).slice(-1)[0];
      expect([file, body.includes(lastLine)]).toEqual([file, true]);
    }
  });
});
