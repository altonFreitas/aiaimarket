import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_ORDER } from "@/lib/schemaHealth";

/* WHICH FILE'S VERSION OF A FUNCTION ACTUALLY WINS.
 *
 * THE INCIDENT THIS EXISTS FOR. supabase/patch-audit-hardening.sql ran last
 * and did a `create or replace` on decrement_stock_on_confirm() to add a row
 * lock -- correct when it was written, and superseded since by
 * stock-ledger.sql. Because it ran afterwards it silently put the old
 * definition back, and THE RESERVATION SYSTEM WAS INERT ON EVERY DATABASE
 * BUILT FROM run-all.sql. Nothing on any screen said so. It was found by
 * accident (see commit 6bdb1eb), which is the only way this class of fault
 * is ever found.
 *
 * WHY A TEST RATHER THAN A RULE. Eight functions in this schema are defined
 * in more than one file, and every one of them is deliberate: a later file
 * genuinely does need to widen reserve_order_stock() for sizes and then for
 * variants, and drop-audience.sql genuinely does need to restate
 * search_products() without the column it is dropping. Forbidding the
 * pattern would mean restructuring sixty-two files on a live shop. What was
 * missing is not a prohibition -- it is that the invariant "the LAST
 * definition is the intended one" was held by nothing but hand-written
 * comments in schemaHealth.ts.
 *
 * So this states the winner for each of the eight, out loud, and fails when:
 *
 *   - a reorder changes which file's version survives,
 *   - a new file redefines one of them without saying so here,
 *   - a function starts being defined twice and nobody declared it.
 *
 * A legitimate change here is one line: move the name to its new final
 * definer, in the same commit that moves the SQL. That is the whole point --
 * it becomes a decision somebody makes rather than one nobody notices. */

const DIR = path.join(process.cwd(), "supabase");

/** The file whose definition must be the one the database ends up with.
 *
 * Every entry is a function that more than one file creates. Verified
 * against the ordering in SCHEMA_ORDER at the time of writing; the test
 * below is what keeps it true. */
const FINAL_DEFINER: Readonly<Record<string, string>> = {
  // Reservation, not the pre-reservation ledger version and not the
  // pre-ledger one in schema.sql. This is the exact function the incident
  // above reverted.
  decrement_stock_on_confirm: "stock-reservation.sql",
  // Widened twice on purpose: sizes first, then variants.
  reserve_order_stock: "variants.sql",
  sync_order_stock_state: "size-stock.sql",
  sync_order_stock: "stock-reservation.sql",
  // drop-audience.sql restates attribute-filters.sql's definition with the
  // audience parameter removed, so it MUST come after it. If these two ever
  // swap, search loses its attribute filters and nothing errors.
  search_products: "drop-audience.sql",
  // Keeps the ledger's "never clamp a negative balance" rule and adds
  // restock_level on top of it.
  apply_stock_movement: "audience-restock.sql",
  // Adds the line's tax to the rows order-items.sql builds.
  sync_order_items: "legal-currency-tax.sql",
  // Only a settled refund moves the order's payment status.
  sync_order_refund_status: "refund-settlement.sql",
};

/** Every function a file creates, lower-cased, deduplicated. */
function functionsIn(file: string): Set<string> {
  let body: string;
  try {
    body = fs.readFileSync(path.join(DIR, file), "utf8");
  } catch {
    return new Set();
  }
  const found = body.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_]+)\s*\(/gi);
  return new Set([...found].map((m) => m[1].toLowerCase()));
}

/** function name -> the files that define it, in the order they run. */
function definersByFunction(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of SCHEMA_ORDER) {
    // run-all.sql is the generated concatenation of everything else, so it
    // defines every function in the schema and would drown the real answer.
    if (file === "run-all.sql") continue;
    for (const name of functionsIn(file)) {
      const list = out.get(name) ?? [];
      list.push(file);
      out.set(name, list);
    }
  }
  return out;
}

describe("a later SQL file replacing an earlier file's function", () => {
  const defs = definersByFunction();
  const redefined = [...defs].filter(([, files]) => files.length > 1);

  it("finds the files at all, so this cannot pass by reading nothing", () => {
    expect(SCHEMA_ORDER.length).toBeGreaterThan(20);
    expect(defs.size).toBeGreaterThan(20);
  });

  it("lands on the declared winner for every function defined more than once", () => {
    const wrong: string[] = [];
    for (const [name, files] of redefined) {
      const expected = FINAL_DEFINER[name];
      const actual = files[files.length - 1];
      if (expected && expected !== actual) {
        wrong.push(
          `${name}: SCHEMA_ORDER ends on ${actual}, but ${expected} is declared as the winner ` +
          `(defined in ${files.join(" → ")})`
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("has every redefined function declared, so a new one cannot slip in unnoticed", () => {
    const undeclared = redefined
      .map(([name, files]) => ({ name, files }))
      .filter(({ name }) => !(name in FINAL_DEFINER))
      .map(({ name, files }) =>
        `${name} is now defined in ${files.length} files (${files.join(" → ")}) — ` +
        `add it to FINAL_DEFINER naming the one that must win`
      );
    expect(undeclared).toEqual([]);
  });

  it("does not declare a winner for a function that is no longer redefined", () => {
    // Keeps the map honest in the other direction: a stale entry here reads
    // as a live constraint and would mislead the next person to move a file.
    const names = new Set(redefined.map(([name]) => name));
    const stale = Object.keys(FINAL_DEFINER).filter((name) => !names.has(name));
    expect(stale).toEqual([]);
  });

  it("names a declared winner that really does define the function", () => {
    const missing = Object.entries(FINAL_DEFINER)
      .filter(([name, file]) => !functionsIn(file).has(name))
      .map(([name, file]) => `${file} is declared the winner for ${name} but does not define it`);
    expect(missing).toEqual([]);
  });
});
