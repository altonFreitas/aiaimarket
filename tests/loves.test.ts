import { describe, it, expect } from "vitest";
import { loveCount, loveTotals, mostLoved } from "@/lib/loves";
import type { Product } from "@/lib/types";

/* Only the fields the ranking reads. Same shape as tests/nav.test.ts uses,
 * and for the same reason: a fixture spelling out forty columns is a test
 * of the fixture. */
function product(p: Partial<Product> & { id: string }): Product {
  return {
    seller_id: "s1", ref: "PRD-" + p.id, name: "Product " + p.id, slug: "p-" + p.id,
    category_id: null, price: 10, discount_price: null, sizes: [], tags: [],
    stock_status: "in", qty: 1, description: "", images: [],
    municipality: null, post: null, suku: null, landmark: null,
    pay_cod: true, pay_cop: false, pay_bank: false, pay_wallet: false, pay_fiar: false,
    archived: false, status: "approved", views: 0, wa_clicks: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...p,
  } as Product;
}

describe("loveCount", () => {
  it("reads the number off the row", () => {
    expect(loveCount(product({ id: "1", loves: 7 }))).toBe(7);
  });

  it("counts a shop that has not run the migration as zero", () => {
    // The column is simply not on the row yet. Zero is the honest answer:
    // nothing has been recorded. Anything else would be an invention.
    expect(loveCount(product({ id: "1" }))).toBe(0);
  });

  it("refuses to be poisoned by a value that is not a count", () => {
    for (const bad of [-3, NaN, Infinity, null, undefined]) {
      expect([bad, loveCount({ loves: bad as never })]).toEqual([bad, 0]);
    }
  });
});

describe("mostLoved", () => {
  const stock = [
    product({ id: "a", loves: 2 }),
    product({ id: "b", loves: 9 }),
    product({ id: "c" }),
    product({ id: "d", loves: 5 }),
  ];

  it("ranks by hearts, best first", () => {
    expect(mostLoved(stock, 10).map((p) => p.id)).toEqual(["b", "d", "a"]);
  });

  it("leaves out what nobody has loved rather than topping the row up", () => {
    // The row is called "Most loved". A product at zero in it is a
    // recommendation the shop invented, and the whole point of this signal
    // is that every number in it was tapped by somebody.
    expect(mostLoved(stock, 10).some((p) => p.id === "c")).toBe(false);
  });

  it("shows nothing at all on the day the feature ships", () => {
    expect(mostLoved([product({ id: "a" }), product({ id: "b" })], 10)).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(mostLoved(stock, 2).map((p) => p.id)).toEqual(["b", "d"]);
    expect(mostLoved(stock, 0)).toEqual([]);
  });

  it("does not reorder the list it was given", () => {
    const before = stock.map((p) => p.id);
    mostLoved(stock, 10);
    expect(stock.map((p) => p.id)).toEqual(before);
  });
});

describe("loveTotals", () => {
  it("adds up the shop and names its most-loved product", () => {
    const out = loveTotals([
      product({ id: "a", name: "Sandal", loves: 2 }),
      product({ id: "b", name: "Jacket", loves: 9 }),
      product({ id: "c", name: "Kettle" }),
    ]);
    expect(out.total).toBe(11);
    expect(out.top).toEqual({ id: "b", name: "Jacket", loves: 9 });
  });

  it("has no favourite when nothing has been loved", () => {
    // Which is how the admin home knows to hide the panel rather than
    // print a confident zero that could equally mean "not migrated".
    expect(loveTotals([product({ id: "a" })])).toEqual({ total: 0, top: null });
  });

  it("counts an empty catalogue as zero, not as a crash", () => {
    expect(loveTotals([])).toEqual({ total: 0, top: null });
  });
});
