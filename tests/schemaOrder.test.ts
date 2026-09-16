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

/* Every file that IS a migration.
 *
 * run-all.sql is generated from these, and ci-bootstrap.sql stands in for
 * what Supabase provides before a project's first migration -- it is
 * applied only to the bare Postgres the integration tests run against and
 * must never reach a real database. Both are named in NOT_SCHEMA_FILES so
 * there is one exemption list rather than several that can disagree. */
/* NOT simply NOT_SCHEMA_FILES: seed.sql is in that list (it is sample data,
 * not schema, so the health panel ignores it) and IS in SCHEMA_ORDER, since
 * an operator setting up a demo shop needs to know where it goes. The two
 * exempted here are the ones that are not migrations at all. */
const EXEMPT = new Set(["run-all.sql", "ci-bootstrap.sql"]);
const files = () => fs.readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !EXEMPT.has(f));

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

/* ---------------------------------------------------------------------------
 * Two files, one constraint name
 * ------------------------------------------------------------------------ */

describe("a constraint two files both add", () => {
  /* THE BUG THIS EXISTS FOR, found by an owner and not by any test here.
   *
   * seller-features.sql and seller-procurement.sql both did:
   *
   *     alter table sellers drop constraint if exists sellers_features_check;
   *     alter table sellers add constraint sellers_features_check check (...);
   *
   * and seller-areas.sql later widened the same column's rules and rewrote
   * every row to match. Re-running run-all.sql then stopped dead with
   * "check constraint sellers_features_check is violated by some row",
   * because the earlier files put the SHORT list back over the new rows.
   *
   * Applying to a clean database twice -- which is what CI does, and what I
   * checked -- never sees it: the tables are empty, so the short list has
   * nothing to trip over. It only breaks on a shop with data, which is
   * every real one.
   *
   * The same shape was sitting in stock_movements_reason_check, where
   * stock-reservation.sql's six reasons ran before supplier-returns.sql's
   * seven. Any shop that had sent goods back to a supplier would have hit
   * it on the next re-run.
   *
   * So: when more than one file adds the same constraint, every file but
   * the last one in run order has to ask before adding. */
  const files = fs.readdirSync(DIR)
    .filter((f) => f.endsWith(".sql") && f !== "run-all.sql");

  /** A file's SQL with its comments removed.
   *
   * COMMENTS ARE STRIPPED BEFORE ANY OF THIS LOOKS AT THE TEXT, and that is
   * not a detail: the prose above each of these guards explains the guard,
   * so a check reading the raw file passes on the strength of the
   * explanation while the code below it says something else. That is
   * exactly what the first version of this test did -- it went green with
   * the guard replaced by `if true then`. */
  const sqlOf = (file: string) =>
    fs.readFileSync(path.join(DIR, file), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  /** Is the add at `at` wrapped in a do-block that asks pg_constraint first?
   *
   * EXACT, not "is there an `if not exists` nearby". These files are full of
   * `add column if not exists` and `create table if not exists`, so a window
   * of preceding text says yes for every add in the folder -- which is what
   * the first version of this did, and it reported supplier-returns.sql as
   * guarded when that file adds unconditionally. A check that cannot come
   * back false is not a check. */
  const guarded = (body: string, at: number): boolean => {
    const opened = body.lastIndexOf("do $$", at);
    if (opened < 0) return false;
    const closed = body.indexOf("end $$", opened);
    if (closed >= 0 && closed < at) return false;      // block ended first
    const head = body.slice(opened, at);
    return /if\s+not\s+exists/i.test(head) && /pg_constraint/i.test(head);
  };

  /** Where each constraint name is added, and at what offset. */
  const adds = new Map<string, { file: string; at: number }[]>();
  for (const file of files) {
    const body = sqlOf(file);
    for (const m of body.matchAll(/add\s+constraint\s+([a-z0-9_]+)/gi)) {
      const list = adds.get(m[1]) ?? [];
      list.push({ file, at: m.index ?? 0 });
      adds.set(m[1], list);
    }
  }

  /** Files that DROP each constraint name. A drop is a claim on the
   * constraint just as much as an add: seller-areas.sql drops
   * sellers_features_check and puts a wider rule under a different name, so
   * no file that adds the old name gets to be the last word. */
  const drops = new Map<string, string[]>();
  for (const file of files) {
    const body = sqlOf(file);
    for (const m of body.matchAll(/drop\s+constraint\s+if\s+exists\s+([a-z0-9_]+)/gi)) {
      drops.set(m[1], [...(drops.get(m[1]) ?? []), file]);
    }
  }

  /** The last file in RUN order to touch a constraint at all, by adding or
   * dropping it. Only that one may add without asking first. */
  const lastToucher = (name: string): string => {
    const touchers = [
      ...(adds.get(name) ?? []).map((a) => a.file),
      ...(drops.get(name) ?? []),
    ];
    return touchers.sort(
      (a, b) => SCHEMA_ORDER.indexOf(a) - SCHEMA_ORDER.indexOf(b)).pop()!;
  };

  const shared = [...adds.entries()].filter(([name, where]) =>
    new Set(where.map((w) => w.file)).size > 1
    || (drops.get(name) ?? []).some((d) => !where.some((w) => w.file === d)));

  it("finds the ones worth checking at all", () => {
    // If this ever hits zero the test below is passing vacuously.
    expect(shared.length).toBeGreaterThan(0);
  });

  it("makes every add but the last one conditional", () => {
    const unguarded: string[] = [];
    for (const [name, where] of shared) {
      const owner = lastToucher(name);
      for (const w of where) {
        if (w.file === owner) continue;
        if (!guarded(sqlOf(w.file), w.at)) unguarded.push(`${w.file}: ${name}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("never drops a shared constraint outside its guard", () => {
    /* A `drop constraint if exists` above the guard defeats it: the drop
       removes the constraint, the guard then finds none and adds the short
       list anyway. That is the first fix I wrote for this, and it did not
       work. */
    const offenders: string[] = [];
    for (const [name, where] of shared) {
      const owner = lastToucher(name);
      for (const w of where) {
        if (w.file === owner) continue;
        const body = sqlOf(w.file);
        const dropRe = new RegExp("drop\\s+constraint\\s+if\\s+exists\\s+" + name, "i");
        if (dropRe.test(body)) offenders.push(`${w.file}: drops ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
