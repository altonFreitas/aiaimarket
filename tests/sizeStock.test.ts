import { describe, it, expect } from "vitest";
import {
  sizedStock, availableInSize, normalizeSizeQty, sizeQtyTotal,
  receiptMovements, lowSizes, NO_SIZE,
} from "@/lib/sizeStock";
import { parseSizes } from "@/lib/procurement";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* STOCK, PER SIZE.
 *
 * The rule that matters most is the one about UNSIZED stock: a balance
 * under the empty size is not stock of no size, it is stock whose size
 * nobody recorded. Getting that wrong in either direction is a real
 * failure -- treat it as zero and a full shelf reads as empty on the day
 * this ships; fold it into a size and the shop is shown inventory that was
 * invented for it.
 */

const bal = (size: string, qty: number) => ({ size, qty });

describe("reading the shelf", () => {
  it("keeps the product's own size order, not the alphabet", () => {
    // "L, M, S" is not a sequence anybody thinks in.
    const s = sizedStock([bal("L", 15), bal("S", 5), bal("M", 10)], ["S", "M", "L"]);
    expect(s.sizes.map((x) => x.size)).toEqual(["S", "M", "L"]);
    expect(s.sizes.map((x) => x.qty)).toEqual([5, 10, 15]);
  });

  it("adds up to the product total", () => {
    const s = sizedStock([bal("S", 5), bal("M", 10), bal("L", 15)], ["S", "M", "L"]);
    expect(s.total).toBe(30);
  });

  it("lists a size the product no longer offers but still has stock of", () => {
    // Those units exist. Hiding them would be hiding inventory from the
    // only screen that could act on it.
    const s = sizedStock([bal("S", 5), bal("XXL", 2)], ["S", "M"]);
    expect(s.sizes.map((x) => x.size)).toEqual(["S", "M", "XXL"]);
    expect(s.sizes.find((x) => x.size === "M")!.qty).toBe(0);
  });

  it("keeps unsized stock apart from every size", () => {
    // Calling it Medium would be inventing inventory.
    const s = sizedStock([bal(NO_SIZE, 30), bal("M", 4)], ["S", "M"]);
    expect(s.unsized).toBe(30);
    expect(s.sizes.find((x) => x.size === "M")!.qty).toBe(4);
    expect(s.total).toBe(34);
  });

  it("is not tracked until a size has actually been counted", () => {
    // THE FLAG THE WHOLE ROLLOUT DEPENDS ON. Every screen reads it before
    // showing a per-size figure, because on day one every product has its
    // whole balance unsized and showing "0 in M" would be a lie about a
    // full shelf.
    expect(sizedStock([bal(NO_SIZE, 30)], ["S", "M"]).tracked).toBe(false);
    expect(sizedStock([], ["S", "M"]).tracked).toBe(false);
    expect(sizedStock([bal("M", 1)], ["S", "M"]).tracked).toBe(true);
  });

  it("adds up two rows of the same size", () => {
    expect(sizedStock([bal("M", 4), bal("M", -1)], ["M"]).sizes[0].qty).toBe(3);
  });
});

describe("what a shopper may take", () => {
  it("backs every size with the unsized pool", () => {
    // Thirty shirts counted before any of this existed can still be sold
    // as Medium, because some of them ARE Medium.
    const s = sizedStock([bal(NO_SIZE, 30)], ["S", "M", "L"]);
    expect(availableInSize(s, "M")).toBe(30);
    expect(availableInSize(s, "L")).toBe(30);
  });

  it("adds the size's own stock to it", () => {
    const s = sizedStock([bal(NO_SIZE, 10), bal("M", 4)], ["M"]);
    expect(availableInSize(s, "M")).toBe(14);
  });

  it("says none when a tracked size is empty and nothing is unsized", () => {
    const s = sizedStock([bal("S", 5), bal("M", 0)], ["S", "M"]);
    expect(availableInSize(s, "M")).toBe(0);
    expect(availableInSize(s, "S")).toBe(5);
  });

  it("never returns a negative", () => {
    // A size oversold by a correction is still "none available", not a
    // number that would print as "-2 left".
    const s = sizedStock([bal("M", -2)], ["M"]);
    expect(availableInSize(s, "M")).toBe(0);
  });

  it("falls back to the total for a line with no size", () => {
    const s = sizedStock([bal("S", 5), bal("M", 10)], ["S", "M"]);
    expect(availableInSize(s, "")).toBe(15);
  });

  it("matches what the database would allow", () => {
    /* size_available() in SQL is `sum(delta) where size = p_size or size
       = ''`. The storefront restates that so it can decide what to offer
       without a round trip, and the two have to agree or the page offers
       something the database then refuses at checkout. */
    const rows = [bal(NO_SIZE, 7), bal("M", 3), bal("L", 0)];
    const s = sizedStock(rows, ["M", "L"]);
    const sql = (size: string) =>
      rows.filter((r) => r.size === size || r.size === NO_SIZE)
        .reduce((n, r) => n + r.qty, 0);
    for (const size of ["M", "L"]) {
      expect([size, availableInSize(s, size)]).toEqual([size, sql(size)]);
    }
  });
});

describe("buying by size", () => {
  it("drops anything that is not a positive whole number of units", () => {
    // -3 Medium and 2.5 Large are not quantities anybody meant, and
    // carrying them forward would put them into the ledger.
    expect(normalizeSizeQty({ S: 5, M: -3, L: 2.5, XL: 0, XXL: "7" }))
      .toEqual({ S: 5, L: 2, XXL: 7 });
  });

  it("survives whatever the database or a form hands it", () => {
    expect(normalizeSizeQty(null)).toEqual({});
    expect(normalizeSizeQty([1, 2])).toEqual({});
    expect(normalizeSizeQty("S:5")).toEqual({});
    expect(normalizeSizeQty({ "  ": 4 })).toEqual({});
  });

  it("totals the breakdown", () => {
    expect(sizeQtyTotal({ S: 5, M: 10, L: 15 })).toBe(30);
    expect(sizeQtyTotal({})).toBe(0);
  });

  it("splits a receipt into one movement per size", () => {
    expect(receiptMovements({ S: 5, M: 10 }, 99))
      .toEqual([{ size: "S", qty: 5 }, { size: "M", qty: 10 }]);
  });

  it("receives a line with no breakdown as one unsized movement", () => {
    // What every purchase did before this existed, and what a fridge
    // still does.
    expect(receiptMovements({}, 12)).toEqual([{ size: NO_SIZE, qty: 12 }]);
  });

  it("receives nothing for a line of nothing", () => {
    expect(receiptMovements({}, 0)).toEqual([]);
    expect(receiptMovements({}, -4)).toEqual([]);
  });

  it("ignores the fallback once a breakdown exists", () => {
    // The breakdown decides. A qty left over from before the sizes were
    // filled in must not add phantom units.
    expect(receiptMovements({ M: 3 }, 99)).toEqual([{ size: "M", qty: 3 }]);
  });
});

describe("reading a size list", () => {
  it("has exactly one parser, and it is procurement's", () => {
    /* A second one lived in lib/sizeStock.ts and split on "|" where this
       one does not. The purchase order form would have offered quantity
       boxes for "38" and "39" while receiving created a single product
       size called "38|39" -- so every count typed into those boxes would
       have landed under a size the product never had.

       parseSizes() is what actually writes products.sizes, so it is the
       only one, and this asserts the other has not crept back. */
    const src = readFileSync(resolve(__dirname, "../src/lib/sizeStock.ts"), "utf8");
    expect(src).not.toMatch(/export function parseSize/);
  });

  it("splits on commas, slashes and newlines -- and not on pipes", () => {
    expect(parseSizes("S, M, L")).toEqual(["S", "M", "L"]);
    expect(parseSizes("S/M/L")).toEqual(["S", "M", "L"]);
    expect(parseSizes("S\nM")).toEqual(["S", "M"]);
    // "38|39" is one label, because that is what reaches products.sizes.
    expect(parseSizes("38|39")).toEqual(["38|39"]);
  });

  it("treats one size typed twice as one size", () => {
    expect(parseSizes("m, M, l")).toEqual(["m", "l"]);
  });

  it("is empty for goods that have no sizes", () => {
    expect(parseSizes("")).toEqual([]);
    expect(parseSizes(null)).toEqual([]);
  });
});

describe("a size running out", () => {
  const p = (id: string, name: string, rows: Array<{ size: string; qty: number }>,
             order: string[]) => ({ id, name, stock: sizedStock(rows, order) });

  it("finds the size the total was hiding", () => {
    // Thirty shirts is a healthy number and no comfort at all to the
    // shopper who wants Medium, of which there are two.
    const out = lowSizes([p("1", "Shirt",
      [bal("S", 14), bal("M", 2), bal("L", 14)], ["S", "M", "L"])]);
    expect(out.map((x) => [x.size, x.qty])).toEqual([["M", 2]]);
  });

  it("says nothing about a product nobody has counted by size", () => {
    // THE RULE THAT MAKES THIS SHIPPABLE. Without it, every size of every
    // product reads as out of stock on day one -- a hundred alerts that
    // mean nothing, and the end of anybody reading the list.
    expect(lowSizes([p("1", "Shirt", [bal(NO_SIZE, 30)], ["S", "M", "L"])]))
      .toEqual([]);
  });

  it("reports a counted size that has reached zero", () => {
    // Precisely the case worth knowing about.
    const out = lowSizes([p("1", "Shirt", [bal("S", 9), bal("M", 0)], ["S", "M"])]);
    expect(out.map((x) => x.size)).toEqual(["M"]);
  });

  it("puts the emptiest shelf first", () => {
    const out = lowSizes([
      p("1", "Shirt", [bal("M", 2), bal("L", 9)], ["M", "L"]),
      p("2", "Hat", [bal("M", 0), bal("L", 9)], ["M", "L"]),
    ]);
    expect(out.map((x) => [x.productName, x.qty])).toEqual([["Hat", 0], ["Shirt", 2]]);
  });

  it("takes the threshold from the caller", () => {
    const rows = [p("1", "Shirt", [bal("M", 5), bal("L", 9)], ["M", "L"])];
    expect(lowSizes(rows, 2)).toEqual([]);
    expect(lowSizes(rows, 5).map((x) => x.size)).toEqual(["M"]);
  });
});

describe("the SQL agrees with the code", () => {
  const sql = readFileSync(resolve(__dirname, "../supabase/size-stock.sql"), "utf8");

  it("makes receiving idempotent per size, not per line", () => {
    /* The original unique index is on po_item_id alone. A line buying 5 S,
       10 M and 15 L writes three movements, and that index would accept
       the first and reject the other two -- the shop would receive five
       shirts and believe it had thirty. */
    expect(sql).toContain("drop index if exists stock_movements_receipt_once");
    expect(sql).toMatch(/stock_movements_receipt_once[\s\S]{0,120}\(po_item_id, size\)/);
  });

  it("backs every size with the unsized pool, in the database too", () => {
    expect(sql).toMatch(/m\.size = coalesce\(p_size, ''\) or m\.size = ''/);
  });

  it("keeps the product-level lock and adds the size check after it", () => {
    // Locking per size would let two baskets for two sizes of the same
    // shirt pass the total check at once and oversell it between them.
    expect(sql).toContain("for update");
    expect(sql).toMatch(/Only % left of "%" in size %/);
  });
});
