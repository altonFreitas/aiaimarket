import { describe, it, expect } from "vitest";
import {
  DEFAULT_RESTOCK_PCT, needsRestock, restockAlerts, normalizeRestockPct,
  type RestockInput,
} from "@/lib/restock";

const p = (over: Partial<RestockInput> = {}): RestockInput => ({
  id: "p1", name: "Jeans", qty: 100, restock_level: 100,
  archived: false, status: "approved", ...over,
});

describe("needsRestock", () => {
  it("stays quiet while most of the delivery is still there", () => {
    expect(needsRestock(100, 100, 75)).toBe(false);
    expect(needsRestock(80, 100, 75)).toBe(false);
    expect(needsRestock(76, 100, 75)).toBe(false);
  });

  it("fires the moment it reaches the threshold", () => {
    // "down to 75%" includes 75 itself.
    expect(needsRestock(75, 100, 75)).toBe(true);
    expect(needsRestock(74, 100, 75)).toBe(true);
    expect(needsRestock(1, 100, 75)).toBe(true);
  });

  it("works on awkward numbers rather than only on hundreds", () => {
    expect(needsRestock(45, 60, 75)).toBe(true);    // 60 * 0.75 = 45
    expect(needsRestock(46, 60, 75)).toBe(false);
    expect(needsRestock(2, 3, 75)).toBe(true);      // 3 * 0.75 = 2.25
    expect(needsRestock(3, 3, 75)).toBe(false);
  });

  it("says nothing about a product that has run out", () => {
    // An empty shelf is already reported, more urgently, by
    // out_of_stock_selling. Saying it twice in two different words is how
    // a to-do list stops being read.
    expect(needsRestock(0, 100, 75)).toBe(false);
    expect(needsRestock(-3, 100, 75)).toBe(false);
  });

  it("says nothing when there is no delivery to compare against", () => {
    // Nothing has been restocked since the column existed. Not an alert.
    expect(needsRestock(10, null, 75)).toBe(false);
    expect(needsRestock(10, undefined, 75)).toBe(false);
    expect(needsRestock(10, 0, 75)).toBe(false);
  });

  it("handles a shelf holding more than was delivered", () => {
    // A correction upward without a movement, or a manual count. Not an
    // alert, and not a crash.
    expect(needsRestock(150, 100, 75)).toBe(false);
  });

  it("follows the threshold it is given", () => {
    expect(needsRestock(50, 100, 25)).toBe(false);
    expect(needsRestock(25, 100, 25)).toBe(true);
    expect(needsRestock(90, 100, 90)).toBe(true);
  });
});

describe("normalizeRestockPct", () => {
  it("keeps a sensible number", () => {
    expect(normalizeRestockPct(75)).toBe(75);
    expect(normalizeRestockPct(1)).toBe(1);
    expect(normalizeRestockPct(99)).toBe(99);
    expect(normalizeRestockPct("50")).toBe(50);
    expect(normalizeRestockPct(50.4)).toBe(50);
  });

  it("falls back to the default rather than to the nearest edge", () => {
    // A stored 0 is far more likely to be "never configured" than a
    // deliberate request to be alerted about every product forever.
    for (const v of [0, 100, -5, 250, NaN, null, undefined, "", "soon", {}]) {
      expect(normalizeRestockPct(v)).toBe(DEFAULT_RESTOCK_PCT);
    }
  });
});

describe("restockAlerts", () => {
  it("reports how much of the last delivery is left", () => {
    const rows = restockAlerts([p({ qty: 18, restock_level: 60 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 18, level: 60, remainingPct: 30 });
  });

  it("puts the emptiest first", () => {
    const rows = restockAlerts([
      p({ id: "a", name: "A", qty: 50, restock_level: 100 }),   // 50%
      p({ id: "b", name: "B", qty: 10, restock_level: 100 }),   // 10%
      p({ id: "c", name: "C", qty: 70, restock_level: 100 }),   // 70%
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks a tie by name, so the list does not shuffle", () => {
    const rows = restockAlerts([
      p({ id: "z", name: "Zapatu", qty: 50, restock_level: 100 }),
      p({ id: "a", name: "Anel", qty: 50, restock_level: 100 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Anel", "Zapatu"]);
  });

  it("skips what nobody can buy", () => {
    const rows = restockAlerts([
      p({ id: "arch", qty: 10, restock_level: 100, archived: true }),
      p({ id: "pend", qty: 10, restock_level: 100, status: "pending" }),
      p({ id: "ok", qty: 10, restock_level: 100 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["ok"]);
  });

  it("returns nothing when everything is well stocked", () => {
    expect(restockAlerts([p({ qty: 100, restock_level: 100 })])).toEqual([]);
  });

  it("survives a catalog with no restock levels at all", () => {
    // Every product on a database that has not run the migration.
    const rows = restockAlerts([
      p({ id: "a", qty: 5, restock_level: null }),
      p({ id: "b", qty: 5, restock_level: undefined }),
    ]);
    expect(rows).toEqual([]);
  });

  it("uses the given percentage, normalised", () => {
    const products = [p({ qty: 50, restock_level: 100 })];
    expect(restockAlerts(products, 25)).toHaveLength(0);
    expect(restockAlerts(products, 60)).toHaveLength(1);
    // Nonsense falls back to the default, under which 50% is an alert.
    expect(restockAlerts(products, 0)).toHaveLength(1);
  });

  it("handles an empty catalog", () => {
    expect(restockAlerts([])).toEqual([]);
  });
});
