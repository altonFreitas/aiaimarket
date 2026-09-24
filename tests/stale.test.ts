import { describe, it, expect } from "vitest";
import { staleProducts, normalizeStaleDays, DEFAULT_STALE_DAYS } from "@/lib/stale";

const NOW = Date.parse("2026-09-24T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const p = (id: string, over: Partial<Parameters<typeof staleProducts>[0][number]> = {}) => ({
  id, name: id, createdAt: daysAgo(400), lastSoldAt: daysAgo(1), ...over,
});

describe("what counts as not selling", () => {
  it("reports a product whose last sale is older than the limit", () => {
    const out = staleProducts([p("a", { lastSoldAt: daysAgo(31) })], 30, NOW);
    expect(out).toEqual([{ id: "a", name: "a", days: 31, neverSold: false }]);
  });

  it("leaves alone one that sold inside it", () => {
    expect(staleProducts([p("a", { lastSoldAt: daysAgo(29) })], 30, NOW)).toEqual([]);
  });

  it("includes the day the limit falls on", () => {
    // "30 days" means 30, not 31: an off-by-one here is a product the shop
    // is told about a day late, every time.
    expect(staleProducts([p("a", { lastSoldAt: daysAgo(30) })], 30, NOW)).toHaveLength(1);
  });

  it("measures a product that never sold from the day it was listed", () => {
    /* Not treated as infinitely old. A product listed yesterday has not
       sold either, and reporting it beside one that has sat there since
       March would bury the March one. */
    const out = staleProducts([
      p("new", { createdAt: daysAgo(3), lastSoldAt: null }),
      p("old", { createdAt: daysAgo(90), lastSoldAt: null }),
    ], 30, NOW);
    expect(out.map((x) => x.id)).toEqual(["old"]);
    expect(out[0]).toMatchObject({ days: 90, neverSold: true });
  });

  it("says which ones nobody has ever bought", () => {
    // A product that sold well until March is a different problem from one
    // that has never interested anybody.
    const out = staleProducts([
      p("sold", { lastSoldAt: daysAgo(60) }),
      p("never", { createdAt: daysAgo(60), lastSoldAt: null }),
    ], 30, NOW);
    expect(out.map((x) => [x.id, x.neverSold])).toEqual([["never", true], ["sold", false]]);
  });
});

describe("the order it comes back in", () => {
  it("puts the longest idle first", () => {
    const out = staleProducts([
      p("b", { lastSoldAt: daysAgo(40) }),
      p("c", { lastSoldAt: daysAgo(200) }),
      p("a", { lastSoldAt: daysAgo(31) }),
    ], 30, NOW);
    expect(out.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("breaks a tie on the name, so the list does not reshuffle itself", () => {
    const out = staleProducts([
      p("zeta", { lastSoldAt: daysAgo(50) }),
      p("alpha", { lastSoldAt: daysAgo(50) }),
    ], 30, NOW);
    expect(out.map((x) => x.id)).toEqual(["alpha", "zeta"]);
  });
});

describe("what it refuses to guess", () => {
  it("skips a row with no usable date rather than inventing one", () => {
    // Inventing one would pin it to the top of the list for ever.
    expect(staleProducts(
      [{ id: "a", name: "a", createdAt: "not a date", lastSoldAt: null }], 30, NOW))
      .toEqual([]);
  });

  it("falls back to 30 days for a limit nobody could have meant", () => {
    /* Zero would report the whole catalogue every morning; 3000 would turn
       the notice off for eight years, silently. */
    expect(normalizeStaleDays(0)).toBe(DEFAULT_STALE_DAYS);
    expect(normalizeStaleDays(-5)).toBe(DEFAULT_STALE_DAYS);
    expect(normalizeStaleDays(3000)).toBe(DEFAULT_STALE_DAYS);
    expect(normalizeStaleDays("abc")).toBe(DEFAULT_STALE_DAYS);
    expect(normalizeStaleDays(null)).toBe(DEFAULT_STALE_DAYS);
  });

  it("keeps a limit the shop could have meant", () => {
    expect(normalizeStaleDays(1)).toBe(1);
    expect(normalizeStaleDays(45)).toBe(45);
    expect(normalizeStaleDays(365)).toBe(365);
    expect(normalizeStaleDays("60")).toBe(60);
    expect(normalizeStaleDays(59.6)).toBe(60);
  });

  it("applies the same clamp inside the search itself", () => {
    /* A caller that skipped normalizeStaleDays must not get a different
       answer from the one the settings page promised. Un-clamped, a limit
       of 0 reports the whole catalogue -- including something sold
       yesterday -- so that is what this asks about. */
    const sellingFine = p("a", { lastSoldAt: daysAgo(5) });
    expect(staleProducts([sellingFine], 0, NOW)).toEqual([]);
    // And the default limit is what it falls back to, not "no limit".
    expect(staleProducts([p("b", { lastSoldAt: daysAgo(31) })], 0, NOW))
      .toHaveLength(1);
  });
});
