import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* THE RULE: products.qty is moved by stock_movements and by nothing else.
 *
 * supabase/stock-ledger.sql makes the database enforce half of it --
 * apply_stock_movement() is the only thing that adds to the balance, and
 * stock_reconciliation reports the drift when something else writes it. But
 * the database cannot stop an UPDATE that names qty, so the other half was
 * a comment in lib/actions/stock.ts saying "Nothing else in the application
 * may write products.qty", and a comment stops nothing.
 *
 * It did not stop this. The admin's product form was fixed to go through
 * the ledger; the seller's was not, and kept writing qty and stock_status
 * onto the row directly on every save. Same table, same rule, one caller
 * obeying it. Nothing failed, nothing was reported, and the damage showed
 * up only as drift nobody was reading.
 *
 * So the rule is checked here, by reading the source. It is a crude test
 * and it is the one that would have caught a bug that lived through a
 * migration written specifically to prevent it.
 */

const ROOT = path.join(__dirname, "..");

/** Every .ts/.tsx file under src/. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

/** lib/stockLedger.ts is the writer itself -- except it does not write qty
 * either; it writes a movement and lets the trigger do the rest. It is
 * listed because it is the file that would legitimately change if that ever
 * stopped being true. */
const LEDGER = "src/lib/stockLedger.ts";

/** The files allowed to seed a brand-new row at zero.
 *
 * Each creates a product with `qty: 0, stock_status: "out"` and then stocks
 * it with a movement. That is the correct pattern -- a product's history
 * starts at its first unit -- and it is an INSERT of an empty shelf, not an
 * UPDATE of a real one. The exemption is checked, not taken on trust: see
 * the second test, which allows these files the literal zero and nothing
 * else. */
const OPENING_INSERT = [
  "src/lib/actions/products.ts",
  "src/lib/actions/seller-products.ts",
  // Receiving a purchase order for goods the shop has never listed before.
  "src/lib/actions/receive.ts",
];

/** TypeScript types, which follow a colon in exactly the same shape as a
 * value does. `qty: number` in an interface is a declaration, not a write. */
const TYPE_NAME = /^(number|string|boolean|StockStatus|StockMovementReason)\b/;

/** Where a Supabase write names `qty` or `stock_status` as a column.
 *
 * Deliberately loose: it matches the field in any object literal, which
 * over-reports rather than under-reports. A false positive is a line to
 * look at; a false negative is this whole test being decorative. */
function writesStock(src: string): string[] {
  const hits: string[] = [];
  src.split("\n").forEach((raw, i) => {
    // Prose is not a write. Comments in these files discuss qty and
    // stock_status constantly -- they are where the rule is explained --
    // and a scanner that reads its own explanation as a violation reports
    // the fix as the bug. Trailing comments are cut rather than skipped, so
    // `qty: 0, // the movement adds the stock` is still seen.
    const trimmed = raw.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    const line = raw.replace(/\/\/.*$/, "");
    // A property assignment, not a read: never `p.qty`, `qty > 0`, or a
    // type annotation.
    //
    // The type is checked by slicing the line rather than by a negative
    // lookahead inside the pattern. A lookahead here does not work: `\s*`
    // before it backtracks to zero characters, the lookahead then compares
    // against " number" instead of "number", and every interface field in
    // the codebase reads as a stock write. It did, until this was fixed.
    const m = /(^|[\s{,(])(qty|stock_status)\s*:[ \t]*/.exec(line);
    if (m && !TYPE_NAME.test(line.slice(m.index + m[0].length))) {
      hits.push(`${i + 1}: ${line.trim()}`);
      return;
    }
    // The OTHER shape, and the one the real bug was written in. The seller
    // stock button built its patch object a property at a time --
    //
    //     const patch: Record<string, unknown> = { stock_status: next };
    //     if (next === "out") patch.qty = 0;
    //
    // -- which an object-literal scanner walks straight past. An earlier
    // version of this test did exactly that: it caught the bug in the save
    // path and missed the identical one two functions below it.
    //
    // `=` and not `==`/`===`/`>=`: a comparison reads qty, it does not
    // write it.
    if (/[.\]](qty|stock_status)\s*=[^=]/.test(line)) {
      hits.push(`${i + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

describe("nothing but the ledger writes products.qty", () => {
  it("finds no direct stock write outside the files allowed one", () => {
    const allowed = new Set([LEDGER, ...OPENING_INSERT]);
    const offenders: string[] = [];
    for (const file of sources()) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (allowed.has(rel)) continue;
      const src = fs.readFileSync(file, "utf8");
      // Only files that actually talk to the products table can write it.
      if (!/from\("products"\)/.test(src)) continue;
      for (const hit of writesStock(src)) offenders.push(`${rel}:${hit}`);
    }
    // Named in the failure, so the message says which line to look at
    // rather than only that something is wrong.
    expect(offenders).toEqual([]);
  });

  it("allows the exempt files only their opening insert", () => {
    // The exemption is narrow on purpose, and this is what keeps it narrow:
    // those files may seed an empty shelf, and may not do anything else
    // with qty. If one of them starts writing a real quantity again --
    // which is exactly the bug this file exists for -- the literal stops
    // being `0` and this fails.
    for (const rel of OPENING_INSERT) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const hit of writesStock(src)) {
        const line = hit.replace(/^\d+: /, "");
        // No \b after "out": the next character is a comma, and a boundary
        // between a quote and a comma does not exist.
        const ok = /\bqty:\s*0\b/.test(line) || /\bstock_status:\s*"out"/.test(line);
        expect([rel, hit, ok]).toEqual([rel, hit, true]);
      }
    }
  });
});

describe("the shared writer is not itself an endpoint", () => {
  it("keeps moveStockTo out of every \"use server\" file", () => {
    // In Next.js every exported async function in a "use server" file is a
    // public HTTP address. A stock writer that checks nothing must never be
    // one: it would let a stranger set any product to any quantity, and it
    // would look like an ordinary helper the whole time.
    const src = fs.readFileSync(path.join(ROOT, LEDGER), "utf8");
    // The DIRECTIVE -- a line that is nothing but the string -- rather than
    // the words anywhere in the file. The first version of this looked for
    // the text and failed on the comment in stockLedger.ts explaining why
    // the directive is not there.
    const directive = src.split("\n").some((l) => /^\s*["']use server["'];?\s*$/.test(l));
    expect(directive).toBe(false);
    expect(src.startsWith('import "server-only"')).toBe(true);
  });

  it("has every function that calls it authenticate first", () => {
    // The check that replaces the one the module cannot do for itself:
    // whoever calls the unguarded writer must establish who is asking.
    //
    // PER FUNCTION, not per file. An earlier version of this asked only
    // whether the guard appeared somewhere in the same file, and a
    // deliberately broken copy of seller-products.ts -- with the guard
    // stripped from the function that moves stock, and left in the three
    // that do not -- passed it. A file-level check answers "does this file
    // know about permissions", which is not the question.
    const guards = /require(Admin|ApprovedSeller|Seller)\s*\(/;
    let checked = 0;

    for (const file of sources()) {
      const src = fs.readFileSync(file, "utf8");
      if (!/from "@\/lib\/stockLedger"/.test(src)) continue;
      const rel = path.relative(ROOT, file).split(path.sep).join("/");

      // Each chunk is one top-level function body: everything from its
      // signature to the next one.
      for (const chunk of src.split(/^export\s+(?:async\s+)?function\s+/m).slice(1)) {
        if (!/\bmoveStockTo\s*\(/.test(chunk)) continue;
        const name = /^\w+/.exec(chunk)?.[0] ?? "?";
        checked++;
        expect([rel, name, guards.test(chunk)]).toEqual([rel, name, true]);
      }
    }

    // If nothing was examined, the loop above proves nothing -- a renamed
    // import or a changed path would quietly turn this test into a no-op
    // that passes forever.
    expect(checked).toBeGreaterThan(0);
  });
});
