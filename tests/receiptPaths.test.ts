import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* "RECEIVED" MUST MEAN RECEIVED, BY WHICHEVER DOOR IT WAS SET.
 *
 * A purchase order's status can be moved two ways, and they are the same
 * field: the quick-status buttons at the top of the form, which write it at
 * once (setPurchaseOrderStatusIn), and the Purchase status dropdown inside
 * the form, which goes with Save (savePurchaseOrderIn).
 *
 * Only the first of them called applyReceipt. So a shop that picked
 * "received" in the dropdown and pressed Save got an order that SAID the
 * goods had landed and a shelf that had not moved: no stock movement, no
 * catalog product for something bought without one, no landed cost. The
 * product stayed "Out of stock" and the storefront never changed -- which
 * is exactly what it looked like from the outside, because nothing had
 * happened. Nothing failed either. There was no error to read.
 *
 * That is the shape of bug this file exists for: not a wrong answer, but a
 * second path to the same state that quietly does less than the first. It
 * is a source-reading test, which is crude, and it is the kind that would
 * have caught it -- receiving needs a live Postgres and a Supabase client,
 * so the alternative was no test at all.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const PURCHASING = read("src/lib/purchasing.ts");

/** The body of one exported function, from its signature to the line that
 * closes it at column 0. Good enough for this file, which is written in
 * that style throughout. */
function body(src: string, fn: string): string {
  const start = src.indexOf(`export async function ${fn}`);
  expect([fn, start >= 0]).toEqual([fn, true]);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end === -1 ? undefined : end);
}

describe("every way of reaching 'received'", () => {
  /* Both writers, named. A third one added later is meant to fail here
     rather than ship: the point of the list is that it is exhaustive. */
  const WRITERS = ["savePurchaseOrderIn", "setPurchaseOrderStatusIn"];

  it("is one of exactly these two functions", () => {
    // If a status write appears anywhere else, it has to be added above
    // and given the same receipt -- or this test is measuring nothing.
    const writes = [...PURCHASING.matchAll(/export async function (\w+)/g)]
      .map((m) => m[1])
      .filter((fn) => /status:\s*input\.status|status:\s*status|\{\s*status\s*\}/.test(
        body(PURCHASING, fn)));
    expect(writes.sort()).toEqual([...WRITERS].sort());
  });

  for (const fn of WRITERS) {
    it(`${fn} applies the receipt`, () => {
      const src = body(PURCHASING, fn);
      expect([fn, /applyReceipt\(/.test(src)]).toEqual([fn, true]);
      // Guarded, not unconditional: a draft must not put goods on a shelf.
      expect([fn, /status === "received"/.test(src)]).toEqual([fn, true]);
    });

    it(`${fn} stamps an arrival date on a landed order`, () => {
      /* No arrival date means no lead time and no on-time judgement, so an
         order that lands without one costs the supplier's record a data
         point permanently. Both doors stamped it or neither should, and for
         a while only one did -- so the same move made two ways produced two
         different rows. */
      const src = body(PURCHASING, fn);
      expect([fn, /"arrived"/.test(src) && /todayIso\(\)/.test(src)])
        .toEqual([fn, true]);
    });
  }
});

describe("receiving twice", () => {
  it("is refused by the database rather than by a check", () => {
    /* Both doors can now be walked through repeatedly -- Save on an order
       already marked received, or the quick button pressed again. That is
       only safe because the constraint is what refuses, not a read before
       the write: a check-then-insert still double-counts under two
       concurrent clicks. */
    const sql = read("supabase/size-stock.sql");
    expect(sql).toMatch(/unique index[\s\S]{0,200}stock_movements_receipt_once/i);
    expect(read("src/lib/receiving.ts")).toContain("UNIQUE_VIOLATION");
  });

  it("is reported by applyReceipt rather than thrown", () => {
    // A second receipt of a line is the expected case, not an error, and
    // must not abort the lines after it -- an order half-received once is
    // topped up by the lines it genuinely missed.
    const src = read("src/lib/receiving.ts");
    expect(src).toMatch(/alreadyReceived\+\+;\s*continue/);
  });
});

describe("the form's two status controls", () => {
  const FORM = read("src/components/admin/procurement/PurchaseOrderForm.tsx");

  it("does not leave the dropdown behind when a button is pressed", () => {
    /* `f.status` is seeded from the `po` prop once, and useState does not
       re-read a prop. Pressing Approved therefore changed the database,
       left the dropdown saying Draft -- and the next Save wrote Draft
       straight back over it, so the status appeared not to stick anywhere,
       including the table on /admin/procurement. */
    const fn = FORM.slice(FORM.indexOf("async function quickStatus"));
    const end = fn.indexOf("\n  }");
    expect(fn.slice(0, end)).toMatch(/set\(\{\s*status/);
  });

  it("offers every status, including the one the order is at", () => {
    // Filtering the current status out left no way to re-run a receipt
    // that had half-failed: the only button that would do it was the one
    // being hidden.
    expect(FORM).not.toMatch(/PO_STATUSES\.filter\(\(s\) => s !== po\.status\)/);
    expect(FORM).toMatch(/PO_STATUSES\.map\(\(s\) =>/);
  });
});
