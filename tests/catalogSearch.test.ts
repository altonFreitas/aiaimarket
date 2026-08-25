import { describe, it, expect } from "vitest";
import { sortProducts, parseSort, parsePage, parsePrice } from "@/lib/data/search";
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
