import { describe, it, expect } from "vitest";
import {
  buildReplenishment, dailyRate, daysBetween, groupBySupplier, toReorder,
  DEFAULT_POLICY, parsePrefillLines, type ReplenishmentInput,
} from "@/lib/replenishment";
import type { Order, Product } from "@/lib/types";

const NOW = Date.parse("2026-09-01T00:00:00Z");
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1", seller_id: "", ref: "AIAI-0001", name: "Samba", slug: "samba",
    category_id: null, price: 45, discount_price: null, qty: 10,
    stock_status: "in", archived: false, created_at: iso(365),
    description: "", sizes: [], tags: [], images: [],
    pay_cod: true, pay_cop: true, pay_bank: true, pay_wallet: true, pay_fiar: false,
    ...over,
  } as Product;
}

function order(status: Order["status"], productId: string, qty: number, daysAgo: number): Order {
  return {
    id: "o" + Math.random(), ref: "CD1", status, items: [{ product_id: productId, qty, name: "x", price: 1 }],
    created_at: iso(daysAgo),
  } as unknown as Order;
}

function input(over: Partial<ReplenishmentInput> = {}): ReplenishmentInput {
  return {
    products: [product()], orders: [], onOrder: new Map(),
    supplierByProduct: new Map(), nowMs: NOW, ...over,
  };
}

describe("daysBetween", () => {
  it("counts whole and partial days forward", () => {
    expect(daysBetween(iso(10), NOW)).toBe(10);
    expect(daysBetween(iso(0.5), NOW)).toBeCloseTo(0.5, 5);
  });
  it("never goes negative for a future date", () => {
    expect(daysBetween(new Date(NOW + 5 * DAY).toISOString(), NOW)).toBe(0);
  });
  it("treats an unparseable date as no elapsed time", () => {
    expect(daysBetween("not a date", NOW)).toBe(0);
  });
});

describe("dailyRate", () => {
  it("divides by the window for an established product", () => {
    // 56 units over a 56-day window on a product a year old = 1/day
    expect(dailyRate(56, iso(365), NOW, 56)).toBe(1);
  });

  it("divides by the product's AGE when it is younger than the window", () => {
    // 10 units in the 5 days since it was listed is 2/day, not 10/56.
    // Dividing by the window would report 0.18/day and tell the shop to
    // order nothing for its fastest new line.
    expect(dailyRate(10, iso(5), NOW, 56)).toBe(2);
    expect(dailyRate(10, iso(5), NOW, 56)).not.toBeCloseTo(10 / 56, 3);
  });

  it("never divides by less than a day", () => {
    const r = dailyRate(3, iso(0), NOW, 56);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(3);
  });

  it("is zero when nothing sold", () => {
    expect(dailyRate(0, iso(365), NOW, 56)).toBe(0);
  });
});

describe("buildReplenishment", () => {
  it("counts orders being fulfilled as demand, not only completed ones", () => {
    const rows = buildReplenishment(input({
      orders: [
        order("completed", "p1", 20, 10),
        order("preparing", "p1", 20, 5),
        order("confirmed", "p1", 16, 2),
      ],
    }));
    // 56 units over the 56-day window
    expect(rows[0].dailyRate).toBeCloseTo(1, 6);
  });

  it("ignores cancelled orders", () => {
    const rows = buildReplenishment(input({
      orders: [order("cancelled", "p1", 500, 3)],
    }));
    expect(rows[0].dailyRate).toBe(0);
  });

  it("ignores sales older than the window", () => {
    const rows = buildReplenishment(input({
      orders: [order("completed", "p1", 100, 90)],
    }));
    expect(rows[0].dailyRate).toBe(0);
  });

  it("subtracts unconfirmed orders from the position but not from demand", () => {
    const rows = buildReplenishment(input({
      products: [product({ qty: 10 })],
      orders: [order("new", "p1", 4, 1)],
    }));
    expect(rows[0].promised).toBe(4);
    expect(rows[0].position).toBe(6);
    expect(rows[0].dailyRate).toBe(0); // an unconfirmed order is not a sale yet
  });

  it("counts units already on a purchase order as covering the need", () => {
    const withoutPo = buildReplenishment(input({
      products: [product({ qty: 0 })],
      orders: [order("completed", "p1", 56, 10)],
    }))[0];
    const withPo = buildReplenishment(input({
      products: [product({ qty: 0 })],
      orders: [order("completed", "p1", 56, 10)],
      onOrder: new Map([["p1", 100]]),
    }))[0];
    expect(withoutPo.suggestedQty).toBeGreaterThan(0);
    expect(withPo.suggestedQty).toBe(0);
    expect(withPo.urgency).toBe("ok");
  });

  it("computes the reorder point from the supplier's own lead time", () => {
    const rows = buildReplenishment(input({
      orders: [order("completed", "p1", 56, 10)],  // 1/day
      supplierByProduct: new Map([["p1", { id: "s1", name: "PT Jaya", leadDays: 30 }]]),
    }));
    // 1/day x (30 lead + 7 safety) = 37
    expect(rows[0].reorderPoint).toBeCloseTo(37, 6);
    expect(rows[0].leadDays).toBe(30);
    expect(rows[0].leadKnown).toBe(true);
  });

  it("falls back to an assumed lead time and says so", () => {
    const rows = buildReplenishment(input({
      orders: [order("completed", "p1", 56, 10)],
    }));
    expect(rows[0].leadDays).toBe(DEFAULT_POLICY.defaultLeadDays);
    expect(rows[0].leadKnown).toBe(false);
  });

  it("orders enough to last past the next order, not just past the lead time", () => {
    const rows = buildReplenishment(input({
      products: [product({ qty: 0 })],
      orders: [order("completed", "p1", 56, 10)],  // 1/day
      supplierByProduct: new Map([["p1", { id: "s1", name: "PT Jaya", leadDays: 30 }]]),
    }));
    // target = 1/day x (30 + 7 + 14) = 51, position 0
    expect(rows[0].suggestedQty).toBe(51);
  });

  it("suggests nothing for a product with no sales, however empty", () => {
    const rows = buildReplenishment(input({ products: [product({ qty: 0 })] }));
    expect(rows[0].dailyRate).toBe(0);
    expect(rows[0].suggestedQty).toBe(0);
    expect(rows[0].urgency).toBe("ok");
    expect(rows[0].daysOfCover).toBeNull();
    expect(rows[0].stockoutOn).toBeNull();
  });

  it("skips archived products", () => {
    expect(buildReplenishment(input({ products: [product({ archived: true })] }))).toHaveLength(0);
  });

  it("dates the stockout from the cover it has left", () => {
    const rows = buildReplenishment(input({
      products: [product({ qty: 10 })],
      orders: [order("completed", "p1", 56, 10)],  // 1/day, 10 days of cover
    }));
    expect(rows[0].daysOfCover).toBeCloseTo(10, 6);
    expect(rows[0].stockoutOn).toBe("2026-09-11");
  });
});

describe("urgency", () => {
  const sellingOnePerDay = [ order("completed", "p1", 56, 10) ];

  it("is 'out' when the position is gone", () => {
    const r = buildReplenishment(input({
      products: [product({ qty: 0 })], orders: sellingOnePerDay }))[0];
    expect(r.urgency).toBe("out");
  });

  it("is 'urgent' inside the lead time, when ordering today already arrives late", () => {
    // 10 days of cover against a 14-day assumed lead time
    const r = buildReplenishment(input({
      products: [product({ qty: 10 })], orders: sellingOnePerDay }))[0];
    expect(r.urgency).toBe("urgent");
  });

  it("is 'soon' when the next cycle would run it out", () => {
    // 30 days of cover; lead 14 + safety 7 + review 14 = 35
    const r = buildReplenishment(input({
      products: [product({ qty: 30 })], orders: sellingOnePerDay }))[0];
    expect(r.urgency).toBe("soon");
  });

  it("is 'ok' with cover beyond the next cycle", () => {
    const r = buildReplenishment(input({
      products: [product({ qty: 200 })], orders: sellingOnePerDay }))[0];
    expect(r.urgency).toBe("ok");
  });

  it("is never urgent for a product nothing is buying", () => {
    const r = buildReplenishment(input({ products: [product({ qty: 0 })] }))[0];
    expect(r.urgency).toBe("ok");
  });
});

describe("toReorder", () => {
  it("keeps only lines worth acting on, worst first", () => {
    const rows = buildReplenishment(input({
      products: [
        product({ id: "a", ref: "A", qty: 200 }),  // ok
        product({ id: "b", ref: "B", qty: 0 }),    // out
        product({ id: "c", ref: "C", qty: 10 }),   // urgent
      ],
      orders: [
        order("completed", "a", 56, 10),
        order("completed", "b", 56, 10),
        order("completed", "c", 56, 10),
      ],
    }));
    expect(toReorder(rows).map((r) => r.ref)).toEqual(["B", "C"]);
  });

  it("drops a line whose suggestion rounds to nothing", () => {
    const rows = buildReplenishment(input({
      products: [product({ qty: 0 })],
      onOrder: new Map([["p1", 999]]),
      orders: [order("completed", "p1", 56, 10)],
    }));
    expect(toReorder(rows)).toHaveLength(0);
  });
});

describe("groupBySupplier", () => {
  it("puts one purchase order's worth together and totals its units", () => {
    const rows = buildReplenishment(input({
      products: [
        product({ id: "a", ref: "A", qty: 0 }),
        product({ id: "b", ref: "B", qty: 0 }),
      ],
      orders: [order("completed", "a", 56, 10), order("completed", "b", 56, 10)],
      supplierByProduct: new Map([
        ["a", { id: "s1", name: "PT Jaya", leadDays: 14 }],
        ["b", { id: "s1", name: "PT Jaya", leadDays: 14 }],
      ]),
    }));
    const groups = groupBySupplier(toReorder(rows));
    expect(groups).toHaveLength(1);
    expect(groups[0].supplierName).toBe("PT Jaya");
    expect(groups[0].units).toBe(groups[0].rows.reduce((n, r) => n + r.suggestedQty, 0));
  });

  it("sorts products with no known supplier last", () => {
    const rows = buildReplenishment(input({
      products: [
        product({ id: "a", ref: "A", qty: 0 }),
        product({ id: "b", ref: "B", qty: 0 }),
      ],
      orders: [order("completed", "a", 56, 10), order("completed", "b", 56, 10)],
      supplierByProduct: new Map([["b", { id: "s1", name: "PT Jaya", leadDays: 14 }]]),
    }));
    const groups = groupBySupplier(toReorder(rows));
    expect(groups.at(-1)!.supplierId).toBeNull();
  });
});

describe("parsePrefillLines", () => {
  it("reads id:qty pairs", () => {
    expect(parsePrefillLines("a:3,b:12")).toEqual([
      { productId: "a", qty: 3 }, { productId: "b", qty: 12 },
    ]);
  });
  it("is empty for nothing at all", () => {
    expect(parsePrefillLines(null)).toEqual([]);
    expect(parsePrefillLines("")).toEqual([]);
    expect(parsePrefillLines(undefined)).toEqual([]);
  });
  it("drops a pair with no quantity rather than ordering NaN of it", () => {
    expect(parsePrefillLines("a:,b:2")).toEqual([{ productId: "b", qty: 2 }]);
    expect(parsePrefillLines("a:banana")).toEqual([]);
  });
  it("drops zero and negative quantities", () => {
    expect(parsePrefillLines("a:0,b:-4,c:1")).toEqual([{ productId: "c", qty: 1 }]);
  });
  it("floors a fractional quantity", () => {
    expect(parsePrefillLines("a:2.9")).toEqual([{ productId: "a", qty: 2 }]);
  });
  it("keeps the first of a repeated product, not two lines for it", () => {
    expect(parsePrefillLines("a:3,a:9")).toEqual([{ productId: "a", qty: 3 }]);
  });
  it("survives junk without throwing", () => {
    expect(parsePrefillLines(",,:,a,:5,")).toEqual([]);
  });
});
