import { describe, it, expect } from "vitest";
import {
  sortProducts, parseSort, parsePage, parsePrice, capTotal, SEARCH_TOTAL_CAP,
} from "@/lib/data/search";
import fs from "node:fs";
import path from "node:path";
import type { Product } from "@/lib/types";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1", seller_id: "s1", ref: "PRD-0001", name: "Item", slug: "item",
  category_id: null, price: 10, discount_price: null, sizes: [], tags: [],
  stock_status: "in", qty: 5, description: "", images: [],
  municipality: null, post: null, suku: null, landmark: null,
  pay_cod: true, pay_cop: true, pay_bank: false, pay_wallet: false, pay_fiar: false,
  archived: false, status: "approved", views: 0, wa_clicks: 0,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("parseSort", () => {
  it("defaults to relevance when there is a search term", () => {
    expect(parseSort(undefined, true)).toBe("relevance");
  });
  it("defaults to newest when there is no search term", () => {
    // Relevance to nothing is not an ordering.
    expect(parseSort(undefined, false)).toBe("new");
  });
  it("rejects a sort this app does not implement", () => {
    expect(parseSort("'; drop table products; --", true)).toBe("relevance");
    expect(parseSort("cheapest", false)).toBe("new");
  });
  it("keeps a sort it does implement", () => {
    for (const s of ["relevance", "new", "low", "high", "rating"]) {
      expect(parseSort(s, true)).toBe(s);
    }
  });
});

describe("parsePage", () => {
  it("clamps anything unusable to page 1", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-4")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("NaN")).toBe(1);
  });
  it("keeps a real page number", () => {
    expect(parsePage("7")).toBe(7);
  });
  it("truncates a fractional page rather than passing it to SQL", () => {
    expect(parsePage("3.9")).toBe(3);
  });
});

describe("parsePrice", () => {
  it("treats missing/blank as no filter", () => {
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice("")).toBeNull();
  });
  it("rejects non-numeric and negative input", () => {
    expect(parsePrice("cheap")).toBeNull();
    expect(parsePrice("-5")).toBeNull();
  });
  it("accepts zero and decimals", () => {
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice("12.50")).toBe(12.5);
  });
});

describe("sortProducts", () => {
  it("sorts by the price actually paid, not the list price", () => {
    // The old catalog sorted on `price`, so a $100 item discounted to $5
    // sorted as if it cost $100 — the exact item a "cheapest first" shopper
    // is looking for, buried.
    const cheap = product({ id: "cheap", price: 100, discount_price: 5 });
    const dear = product({ id: "dear", price: 20, discount_price: null });
    expect(sortProducts([dear, cheap], "low").map((p) => p.id)).toEqual(["cheap", "dear"]);
    expect(sortProducts([cheap, dear], "high").map((p) => p.id)).toEqual(["dear", "cheap"]);
  });

  it("ignores a discount_price that isn't a real discount", () => {
    const zeroed = product({ id: "zeroed", price: 30, discount_price: 0 });
    const plain = product({ id: "plain", price: 25 });
    expect(sortProducts([zeroed, plain], "low").map((p) => p.id)).toEqual(["plain", "zeroed"]);
  });

  it("puts unrated products after rated ones, not level with one star", () => {
    const good = product({ id: "good", rating_sum: 9, rating_count: 2 });   // 4.5
    const poor = product({ id: "poor", rating_sum: 2, rating_count: 2 });   // 1.0
    const unrated = product({ id: "unrated" });
    expect(sortProducts([unrated, poor, good], "rating").map((p) => p.id))
      .toEqual(["good", "poor", "unrated"]);
  });

  it("falls back to newest-first for relevance, which it cannot compute", () => {
    const older = product({ id: "older", created_at: "2026-01-01T00:00:00Z" });
    const newer = product({ id: "newer", created_at: "2026-06-01T00:00:00Z" });
    expect(sortProducts([older, newer], "relevance").map((p) => p.id)).toEqual(["newer", "older"]);
  });

  it("breaks price ties with newest-first, so ordering is stable and meaningful", () => {
    const older = product({ id: "older", price: 10, created_at: "2026-01-01T00:00:00Z" });
    const newer = product({ id: "newer", price: 10, created_at: "2026-06-01T00:00:00Z" });
    expect(sortProducts([older, newer], "low").map((p) => p.id)).toEqual(["newer", "older"]);
  });

  it("does not mutate its input", () => {
    const list = [product({ id: "a", price: 9 }), product({ id: "b", price: 1 })];
    sortProducts(list, "low");
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

/* ---------------------------------------------------------------------------
   HOW DEEP THE CATALOG IS COUNTED
   ---------------------------------------------------------------------------
   search_products used to answer with count(*) over () across the whole match
   set, so the catalog page -- where the match set is the entire catalog --
   read every product to show twenty-four. Measured on 60,000 products before
   the change: 82.6ms for that page, against 1.6ms once the count stopped
   being exhaustive.

   What was bought with real money is an exact total past a thousand. These
   guards are about spending it honestly.
   ------------------------------------------------------------------------ */

describe("the total, once counting stops", () => {
  it("is exact below the cap", () => {
    expect(capTotal(0, 24)).toEqual({ total: 0, totalCapped: false, pageCount: 1 });
    expect(capTotal(7, 24)).toEqual({ total: 7, totalCapped: false, pageCount: 1 });
    expect(capTotal(25, 24)).toEqual({ total: 25, totalCapped: false, pageCount: 2 });
  });

  it("is exact AT the cap, and says so only past it", () => {
    /* The function fetches one row past the cap so this distinction can be
       made at all. Calling a thousand "1,000+" would be as wrong as calling
       sixty thousand "1,000". */
    expect(capTotal(SEARCH_TOTAL_CAP, 24).totalCapped).toBe(false);
    expect(capTotal(SEARCH_TOTAL_CAP, 24).total).toBe(SEARCH_TOTAL_CAP);
    expect(capTotal(SEARCH_TOTAL_CAP + 1, 24).totalCapped).toBe(true);
  });

  it("never reports more than it counted", () => {
    // A number bigger than the cap would be invented, and a shopper paging
    // to it would land on an empty grid.
    const big = capTotal(60001, 24);
    expect(big.total).toBe(SEARCH_TOTAL_CAP);
    expect(big.totalCapped).toBe(true);
    expect(big.pageCount).toBe(Math.ceil(SEARCH_TOTAL_CAP / 24));
  });

  it("offers no page the search cannot answer", () => {
    /* The pager renders a link per page. The deepest one it can offer must
       still be inside what the function will return, or the last page of a
       big catalog is a dead link. */
    for (const perPage of [1, 12, 24, 100]) {
      const { pageCount } = capTotal(999_999, perPage);
      expect((pageCount - 1) * perPage, "deepest offset at " + perPage)
        .toBeLessThan(SEARCH_TOTAL_CAP);
    }
  });
});

describe("the cap is one number, not two", () => {
  /* COMMENTS STRIPPED, and that is not tidiness. The note above this
     function explains what it replaced, quoting "count(*) over ()" in the
     prose -- so the positional assertion below found the explanation
     instead of the code and failed against a correct file. A guard that
     reads comments is a guard that can be satisfied by writing about the
     thing rather than doing it. */
  const SQL = fs.readFileSync(
    path.join(process.cwd(), "supabase/drop-audience.sql"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

  it("agrees with the SQL that produces it", () => {
    /* THE HAZARD THIS FILE EXISTS FOR. The function caps the rows and this
       module reads that cap; if they drift, the storefront either prints
       "1,000+" for a set it counted exactly, or offers pages the function
       will not serve. */
    const m = /v_cap\s+constant int := (\d+);/.exec(SQL);
    expect(m, "v_cap in drop-audience.sql").not.toBeNull();
    expect(Number(m![1])).toBe(SEARCH_TOTAL_CAP);
  });

  it("fetches one past the cap, so more-than is knowable", () => {
    expect(SQL).toMatch(/limit v_cap \+ 1/);
  });

  it("counts over the capped rows, not the whole match set", () => {
    /* The point of the change. count(*) over () has to see every row it
       counts, so it has to be looking at the bounded set. */
    const body = SQL.slice(SQL.indexOf("create function search_products"));
    const cap = body.indexOf("limit v_cap + 1");
    const count = body.indexOf("count(*) over ()");
    expect(cap).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(cap);
  });

  it("orders before it caps, so the cap keeps the right rows", () => {
    /* `limit` without an order takes an arbitrary thousand. Sorting those
       would put the fourth-cheapest product on page one of "cheapest
       first" -- fast, and wrong. */
    const body = SQL.slice(SQL.indexOf("create function search_products"));
    const inner = body.slice(0, body.indexOf("limit v_cap + 1"));
    expect(inner).toMatch(/order by[\s\S]*case when sort = 'low'/);
  });
});

describe("both search paths say the same thing", () => {
  const CODE = fs.readFileSync(path.join(process.cwd(), "src/lib/data/search.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("caps the in-memory fallback too", () => {
    /* The fallback knows the exact answer, and still reports the capped
       one: the two paths differ in speed and in ranking, and must not
       differ in what they SAY, or a shop's totals change the day its
       migration runs. */
    expect((CODE.match(/\.\.\.capTotal\(/g) ?? []).length).toBe(2);
    expect(CODE).toMatch(/\.\.\.capTotal\(hits\.length, perPage\)/);
    expect(CODE).toMatch(/\.\.\.capTotal\(counted, perPage\)/);
  });

  it("computes the page count in one place", () => {
    // It was computed twice, identically, in both paths. Two copies of an
    // arithmetic invariant is one copy too many.
    expect((CODE.match(/pageCount: Math\.max/g) ?? []).length).toBe(1);
  });
});

describe("the shopper is told the number is a floor", () => {
  const TOOLBAR = fs.readFileSync(
    path.join(process.cwd(), "src/components/Toolbar.tsx"), "utf8");
  const LAYOUT = fs.readFileSync(
    path.join(process.cwd(), "src/components/CatalogLayout.tsx"), "utf8");

  it('prints a "+" rather than a number the shop does not have', () => {
    expect(TOOLBAR).toMatch(/\{count\}\{countCapped \? "\+" : ""\}/);
  });

  it("is actually given the flag", () => {
    // The prop existing and never being passed is the failure mode: every
    // count would print bare and look exact.
    expect(LAYOUT).toMatch(/countCapped=\{result\.totalCapped\}/);
  });
});
