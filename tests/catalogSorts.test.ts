import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sortProducts, dealFraction, parseSort } from "@/lib/data/search";
import type { Product } from "@/lib/types";

/* TWO MORE WAYS TO ORDER THE CATALOGUE, AND THE TWO PLACES THAT HAVE TO
 * AGREE ABOUT THEM.
 *
 * Ordering happens in the database -- the search is paginated and counted
 * there -- with an in-memory fallback for a shop whose migrations have not
 * been run. Both implement the same sorts, and the failure that matters is
 * not either of them being wrong on its own: it is the two disagreeing, so
 * that a shop's catalogue silently reorders itself the day somebody pastes
 * the SQL.
 *
 *   'popular'  products.views, then products.wa_clicks. Both counters are
 *              deduplicated before they are written -- one per caller per
 *              product per fifteen minutes, see lib/counterGuard.ts -- so
 *              this is nearer a count of people than of page loads.
 *   'deal'     how far the price is reduced as a FRACTION. $5 off $10
 *              beats $5 off $500, and the shopper reading "-50%" agrees.
 */

const SQL = fs.readFileSync(
  path.join(process.cwd(), "supabase/search-sorts.sql"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const CODE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/data/search.ts"), "utf8");
const BAR = fs.readFileSync(
  path.join(process.cwd(), "src/components/shop/ShopBar.tsx"), "utf8");

let n = 0;
function prod(over: Partial<Product>): Product {
  n += 1;
  return {
    id: "p" + n, seller_id: "s", ref: "R", name: "P" + n, slug: "p" + n,
    category_id: null, price: 10, discount_price: null, sizes: [], tags: [],
    stock_status: "in", qty: 1, description: "", images: [],
    municipality: null, post: null, suku: null, landmark: null,
    pay_cod: true, pay_cop: false, pay_bank: false, pay_wallet: false,
    pay_fiar: false, archived: false, status: "approved",
    views: 0, wa_clicks: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Product;
}
const names = (ps: Product[]) => ps.map((p) => p.name);

describe("biggest discount means the biggest fraction, not the biggest amount", () => {
  it("puts half off a shirt above five dollars off a phone", () => {
    /* THE WHOLE DECISION, in one case. Both are $5 off. One is half price
       and the other is a rounding error, and the shopper reading "-50%"
       against "-1%" already knows which is the better deal. */
    const shirt = prod({ name: "shirt", price: 10, discount_price: 5 });
    const phone = prod({ name: "phone", price: 500, discount_price: 495 });
    expect(names(sortProducts([phone, shirt], "deal"))).toEqual(["shirt", "phone"]);
  });

  it("puts everything on offer above everything that is not", () => {
    const small = prod({ name: "1pc", price: 100, discount_price: 99 });
    const full = prod({ name: "full", price: 5, discount_price: null });
    expect(names(sortProducts([full, small], "deal"))).toEqual(["1pc", "full"]);
  });

  it("orders the ones that are not on offer by newest, not at random", () => {
    const older = prod({ name: "older", created_at: "2026-01-01T00:00:00Z" });
    const newer = prod({ name: "newer", created_at: "2026-06-01T00:00:00Z" });
    expect(names(sortProducts([older, newer], "deal"))).toEqual(["newer", "older"]);
  });

  it("does not treat a broken discount as a discount", () => {
    // A discount at or above the asking price is a data error, not an
    // offer, and putting it at the top of "biggest discount" would be
    // advertising it.
    expect(dealFraction(prod({ price: 10, discount_price: 10 }))).toBeNull();
    expect(dealFraction(prod({ price: 10, discount_price: 12 }))).toBeNull();
    expect(dealFraction(prod({ price: 10, discount_price: 0 }))).toBeNull();
    expect(dealFraction(prod({ price: 0, discount_price: 5 }))).toBeNull();
    expect(dealFraction(prod({ price: 10, discount_price: null }))).toBeNull();
  });

  it("reads a real one as the fraction off", () => {
    expect(dealFraction(prod({ price: 40, discount_price: 30 }))).toBeCloseTo(0.25);
  });
});

describe("most viewed ranks by the counter the shop actually keeps", () => {
  it("puts the most looked at first", () => {
    const quiet = prod({ name: "quiet", views: 3 });
    const busy = prod({ name: "busy", views: 900 });
    expect(names(sortProducts([quiet, busy], "popular"))).toEqual(["busy", "quiet"]);
  });

  it("breaks a tie on who pressed Order via WhatsApp", () => {
    // Somebody who pressed it wanted it more than somebody who looked.
    const looked = prod({ name: "looked", views: 900, wa_clicks: 1 });
    const wanted = prod({ name: "wanted", views: 900, wa_clicks: 9 });
    expect(names(sortProducts([looked, wanted], "popular"))).toEqual(["wanted", "looked"]);
  });

  it("falls back to newest when nobody has looked at either", () => {
    const older = prod({ name: "older", created_at: "2026-01-01T00:00:00Z" });
    const newer = prod({ name: "newer", created_at: "2026-06-01T00:00:00Z" });
    expect(names(sortProducts([older, newer], "popular"))).toEqual(["newer", "older"]);
  });

  it("survives a row where the counters are missing", () => {
    // Optional in practice: a product row read through a narrow select.
    const none = prod({ name: "none", views: undefined as unknown as number });
    const some = prod({ name: "some", views: 2 });
    expect(names(sortProducts([none, some], "popular"))).toEqual(["some", "none"]);
  });
});

describe("a sort the shop does not have is not a sort", () => {
  it("accepts the two new names", () => {
    expect(parseSort("popular", false)).toBe("popular");
    expect(parseSort("deal", false)).toBe("deal");
  });

  it("still refuses anything else", () => {
    expect(parseSort("cheapest", false)).toBe("new");
    expect(parseSort(undefined, false)).toBe("new");
  });
});

describe("the database and the fallback offer the same sorts", () => {
  /* THE FAILURE THIS SECTION IS FOR. Adding a name to the picker without
     adding it to the SQL does not break anything visibly: the function
     falls through to its final tiebreaker and returns newest-first, while
     the in-memory path -- used only by shops whose migration has not run
     -- returns the right thing. The catalogue then reorders itself the day
     somebody pastes the file. */
  const tsSorts = (/const SORTS: readonly CatalogSort\[\] =\s*\[([^\]]*)\]/
    .exec(CODE)?.[1] ?? "").match(/"([a-z]+)"/g)?.map((x) => x.slice(1, -1)) ?? [];

  /** The sort names the function branches on, in one of its two order-bys,
   *  IN ORDER AND WITH REPEATS. A set would say the two order-bys agree
   *  when one of them has lost a tie-breaker: 'popular' is two keys, views
   *  then wa_clicks, and dropping one leaves the name behind. */
  function sqlKeys(block: string): string[] {
    return [...block.matchAll(/sort = '([a-z]+)'/g)].map((m) => m[1]);
  }
  const sqlSorts = (block: string) => [...new Set(sqlKeys(block))].sort();
  const body = SQL.slice(SQL.indexOf("function search_products"));
  const inner = body.slice(0, body.indexOf("limit v_cap + 1"));
  const outer = body.slice(body.indexOf("limit v_cap + 1"));

  it("reads a sort list from both, so this test can fail", () => {
    expect(tsSorts.length).toBeGreaterThan(4);
    expect(sqlSorts(inner).length).toBeGreaterThan(3);
  });

  it("names every sort the application offers", () => {
    // 'new' is the absence of a branch -- it IS the final tiebreaker --
    // so it is the one name that must not appear.
    for (const s of tsSorts) {
      if (s === "new") { expect(sqlSorts(outer), "new").not.toContain("new"); continue; }
      expect(sqlSorts(outer), s).toContain(s);
    }
  });

  it("and offers none the application does not", () => {
    for (const s of sqlSorts(outer)) expect(tsSorts, s).toContain(s);
  });

  it("orders the capped rows by the same keys it orders the page by", () => {
    /* The subtle one. The function orders INSIDE the CTE so the cap keeps
       the right thousand, then orders again outside because a CTE's row
       order is not guaranteed. If a sort is named in one and not the
       other, the cap keeps the wrong rows -- and only for shops with more
       than a thousand matches, which is the hardest kind of bug to see. */
    expect(sqlKeys(inner)).toEqual(sqlKeys(outer));
    // And it really is more than one key per name, or the check above is
    // no stronger than comparing the two sets.
    expect(sqlKeys(inner).length).toBeGreaterThan(sqlSorts(inner).length);
  });

  it("keeps the fallback's tie-breaks in the same order as the SQL's", () => {
    // views then wa_clicks, both descending, in both places.
    expect(inner.indexOf("then p.views end desc"))
      .toBeLessThan(inner.indexOf("then p.wa_clicks end desc"));
    const fb = CODE.slice(CODE.indexOf('sort === "popular"'));
    expect(fb.indexOf("y.views")).toBeLessThan(fb.indexOf("y.wa_clicks"));
  });

  it("sorts the ones with no discount last on both paths", () => {
    expect(outer).toMatch(/sort = 'deal' then m\.deal_frac end desc nulls last/);
    expect(CODE).toMatch(/\(dealFraction\(y\) \?\? -1\) - \(dealFraction\(x\) \?\? -1\)/);
  });
});

describe("the picker offers only sorts that exist", () => {
  const offered = [...BAR.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);

  it("offers the two new ones", () => {
    expect(offered).toContain("popular");
    expect(offered).toContain("deal");
  });

  it("offers nothing the parser would throw away", () => {
    // An option the parser rejects silently becomes "newest", so the
    // picker would show a choice that does nothing.
    for (const o of offered) expect(parseSort(o, true), o).toBe(o);
  });
});

describe("the migration is a replacement, not a second function", () => {
  it("keeps the signature it had, so it needs no drop", () => {
    /* Postgres overloads on argument types: a CHANGED signature has to
       drop the old one first or both survive and every call that does not
       name the new argument fails as ambiguous. This file changes only the
       body, which is why it may use create-or-replace -- and why it must
       not introduce a parameter without also dropping. */
    expect(SQL).toMatch(/create or replace function search_products\(/);
    expect(SQL).not.toMatch(/drop function if exists search_products/);
    const sig = /create or replace function search_products\(([\s\S]*?)\n\)/.exec(SQL)![1];
    /* EXACTLY these ten, in this order. Naming them one by one is the
       point: a parameter added, renamed or removed fails here, and the
       only way past is to come back and read the paragraph above. */
    expect([...sig.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1])).toEqual([
      "q", "category_ids", "seller_ids", "min_price", "max_price",
      "in_stock_only", "sort", "lim", "off", "id_filter",
    ]);
  });

  it("indexes what the two new sorts scan", () => {
    expect(SQL).toMatch(/create index if not exists products_views_idx/);
    expect(SQL).toMatch(/create index if not exists products_deal_idx/);
  });

  it("is registered as the last word on the function", () => {
    const health = fs.readFileSync(
      path.join(process.cwd(), "src/lib/schemaHealth.ts"), "utf8");
    const list = /search_products: \[([\s\S]*?)\]/.exec(health)![1];
    const files = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(files[files.length - 1]).toBe("search-sorts.sql");
    // And in the run order, after the file it replaces.
    const order = /export const SCHEMA_ORDER[\s\S]*?\n\];/.exec(health)![0];
    expect(order.indexOf('"search-sorts.sql"'))
      .toBeGreaterThan(order.indexOf('"drop-audience.sql"'));
  });

  it("is in the file run-all.sql is built from", () => {
    const all = fs.readFileSync(path.join(process.cwd(), "supabase/run-all.sql"), "utf8");
    expect(all).toContain("search-sorts.sql");
    expect(all).toContain("products_deal_idx");
  });
});
