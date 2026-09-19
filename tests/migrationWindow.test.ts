import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* THE WINDOW BETWEEN DEPLOYING CODE AND RUNNING THE SQL.
 *
 * Every file in supabase/ adds columns to tables the application already
 * writes to, and the two do not land together: the code ships, the SQL is
 * pasted into Supabase by hand afterwards. In between, Postgres fails the
 * WHOLE statement over one unknown column name -- so a field nobody has
 * filled in can stop a shop dead.
 *
 * lib/missingColumn.ts exists for exactly this, and three writes were not
 * using it for columns that come from migrations. Reproduced against a
 * real database with each column absent:
 *
 *   orders.discount      -> no order could be placed AT ALL. The comment
 *                           beside it claimed writeTolerating would drop
 *                           it; the helper only drops what it is HANDED,
 *                           and it was handed idempotency_key alone.
 *   orders.is_preorder   -> the same, independently.
 *   products.preorder_*  -> no product could be created or edited.
 *
 * This test reads the source because the failure is a column NAME reaching
 * the database, and the name is what has to stay out of the always-written
 * object.
 */

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const ORDERS = read("src/lib/actions/orders.ts");
const PRODUCTS = read("src/lib/actions/products.ts");

/** One writeTolerating call, split at the arrow.
 *
 * `marker` is a string unique to the call -- these files hold several, and
 * a regex sweeping for the first one would have this test asking its
 * questions of the wrong call and passing for the wrong reason.
 *
 * `tolerated` is the optional set, the fields the helper may drop when the
 * database turns out not to have them. `always` is everything after the
 * arrow: the column names that must exist in every database, because
 * Postgres fails the whole statement over one it does not know. */
function split(src: string, marker: string): { tolerated: string; always: string } {
  const at = src.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const callStart = src.lastIndexOf("writeTolerating", at);
  expect(callStart, `a writeTolerating before ${marker}`).toBeGreaterThan(-1);
  const arrow = src.indexOf("(extra) =>", callStart);
  expect(arrow, `the arrow after ${marker}`).toBeGreaterThan(callStart);
  // Any indentation: these calls are nested to different depths.
  const close = /\n\s*\);/.exec(src.slice(arrow));
  expect(close, `the end of the call at ${marker}`).not.toBeNull();
  return {
    tolerated: src.slice(callStart, arrow),
    always: src.slice(arrow, arrow + close!.index),
  };
}

describe("columns that arrive with a migration are never required", () => {
  const ORDER = '.from("orders")';
  const PRODUCT_UPDATE = 'sb.from("products").update({';
  const PRODUCT_INSERT = 'sb.from("products").insert({';

  it("does not make an order depend on orders.discount", () => {
    const { tolerated, always } = split(ORDERS, ORDER);
    expect(tolerated).toMatch(/discount/);
    expect(always).not.toMatch(/^\s*discount,/m);
  });

  it("does not make an order depend on orders.is_preorder", () => {
    const { tolerated, always } = split(ORDERS, ORDER);
    expect(tolerated).toMatch(/is_preorder/);
    expect(always).not.toMatch(/^\s*is_preorder:/m);
  });

  it("does not make saving a product depend on products.preorder_*", () => {
    // The edit path and the create path: separate calls, separately broken.
    for (const marker of [PRODUCT_UPDATE, PRODUCT_INSERT]) {
      const { tolerated, always } = split(PRODUCTS, marker);
      expect(always, marker).not.toMatch(/preorder_enabled:/);
      expect(always, marker).not.toMatch(/preorder_eta:/);
      expect(tolerated, marker).toMatch(/preorder_enabled/);
      expect(tolerated, marker).toMatch(/preorder_eta/);
    }
  });

  it("keeps audience tolerated, which is the case this module was built for", () => {
    for (const marker of [PRODUCT_UPDATE, PRODUCT_INSERT]) {
      const { tolerated, always } = split(PRODUCTS, marker);
      expect(always, marker).not.toMatch(/audience:/);
      expect(tolerated, marker).toMatch(/audience/);
    }
  });
});
