import { describe, it, expect } from "vitest";
import { ratingAverage, stars, effectivePrice } from "@/lib/utils";

describe("ratingAverage", () => {
  it("returns null for a product nobody has reviewed", () => {
    // null, not 0 — an unrated listing is not a zero-star listing, and the
    // UI relies on this to decide whether to render stars at all.
    expect(ratingAverage({ rating_sum: 0, rating_count: 0 })).toBeNull();
  });

  it("returns null when the columns are absent entirely", () => {
    // What a database that hasn't run marketplace-v2.sql looks like.
    expect(ratingAverage({})).toBeNull();
    expect(ratingAverage({ rating_sum: null, rating_count: null })).toBeNull();
  });

  it("averages and rounds to one decimal", () => {
    expect(ratingAverage({ rating_sum: 9, rating_count: 2 })).toBe(4.5);
    expect(ratingAverage({ rating_sum: 10, rating_count: 3 })).toBe(3.3);
  });

  it("does not divide by a negative or nonsense count", () => {
    expect(ratingAverage({ rating_sum: 5, rating_count: -1 })).toBeNull();
  });
});

describe("stars", () => {
  it("always renders exactly five glyphs", () => {
    for (const n of [0, 1, 2.4, 3.5, 4.9, 5]) {
      expect(stars(n)).toHaveLength(5);
    }
  });
  it("rounds to the nearest whole star", () => {
    expect(stars(4.2)).toBe("★★★★☆");
    expect(stars(4.6)).toBe("★★★★★");
  });
  it("clamps out-of-range input instead of producing a broken string", () => {
    expect(stars(-3)).toBe("☆☆☆☆☆");
    expect(stars(99)).toBe("★★★★★");
  });
});

describe("effectivePrice", () => {
  it("uses the discount when one is genuinely running", () => {
    expect(effectivePrice({ price: 100, discount_price: 60 })).toBe(60);
  });
  it("uses the list price when there is no discount", () => {
    expect(effectivePrice({ price: 100, discount_price: null })).toBe(100);
    expect(effectivePrice({ price: 100 })).toBe(100);
  });
  it("treats a zero discount as no discount, never as a free product", () => {
    expect(effectivePrice({ price: 100, discount_price: 0 })).toBe(100);
  });
});
