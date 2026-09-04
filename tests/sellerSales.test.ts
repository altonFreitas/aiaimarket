import { describe, it, expect } from "vitest";
import {
  sellerSalesReport, monthOf, monthRange, counts, isCompleted,
  type SellerSaleInput,
} from "@/lib/sellerSales";
import type { OrderItem } from "@/lib/types";

const item = (name: string, price: number, qty: number, id = name): OrderItem =>
  ({ product_id: id, name, price, qty, size: "" } as unknown as OrderItem);

const order = (
  o: Partial<SellerSaleInput> & { items: OrderItem[] }
): SellerSaleInput => ({
  id: o.id ?? "o1",
  ref: o.ref ?? "ORD-0001",
  status: o.status ?? "completed",
  created_at: o.created_at ?? "2026-09-04T10:00:00Z",
  myItems: o.items,
  mySubtotal: o.mySubtotal ?? o.items.reduce((a, i) => a + i.price * i.qty, 0),
});

describe("what counts as a sale", () => {
  it("counts everything except a cancelled order", () => {
    for (const s of ["new", "confirmed", "preparing", "out", "arrived", "completed"]) {
      expect([s, counts(s)]).toEqual([s, true]);
    }
    expect(counts("cancelled")).toBe(false);
  });

  it("treats only 'completed' as finished", () => {
    expect(isCompleted("completed")).toBe(true);
    expect(isCompleted("arrived")).toBe(false);
  });
});

describe("sellerSalesReport", () => {
  it("reports nothing rather than NaN for a store with no orders", () => {
    const r = sellerSalesReport([], 10);
    expect(r.all.orders).toBe(0);
    expect(r.all.gross).toBe(0);
    // 0/0 is NaN, and NaN renders as "$NaN" on a seller's screen.
    expect(r.all.averageOrder).toBe(0);
    expect(r.byMonth).toEqual([]);
    expect(r.topProducts).toEqual([]);
  });

  it("adds up gross, commission and net at the store's own rate", () => {
    const r = sellerSalesReport([
      order({ items: [item("Jeans", 20, 1)] }),
      order({ id: "o2", items: [item("Hat", 12, 1)] }),
    ], 10);
    expect(r.all.gross).toBe(32);
    expect(r.all.commission).toBe(3.2);
    expect(r.all.net).toBe(28.8);
  });

  it("leaves a cancelled order out of the money but keeps it in the statuses", () => {
    // It did happen. It is just not revenue -- and a store looking for
    // "why is this order not in my total" should still find it here.
    const r = sellerSalesReport([
      order({ items: [item("Jeans", 20, 1)] }),
      order({ id: "o2", status: "cancelled", items: [item("Hat", 12, 1)] }),
    ], 10);
    expect(r.all.gross).toBe(20);
    expect(r.all.orders).toBe(1);
    expect(r.byStatus).toContainEqual({ status: "cancelled", orders: 1 });
  });

  it("separates what has been sold from what has been delivered", () => {
    // The dashboard's "still owed" is built on completed orders only. If
    // this screen showed one number and called it sales, the two would
    // disagree and the seller would be right to distrust both.
    const r = sellerSalesReport([
      order({ items: [item("Jeans", 20, 1)], status: "completed" }),
      order({ id: "o2", items: [item("Hat", 12, 1)], status: "confirmed" }),
    ], 10);
    expect(r.all.gross).toBe(32);
    expect(r.completed.gross).toBe(20);
    expect(r.completed.net).toBe(18);
  });

  it("counts units across the lines, not orders", () => {
    const r = sellerSalesReport([
      order({ items: [item("Jeans", 20, 3), item("Hat", 10, 2)] }),
    ], 0);
    expect(r.all.units).toBe(5);
    expect(r.all.orders).toBe(1);
  });

  it("gives the average basket, which revenue alone does not", () => {
    const r = sellerSalesReport([
      order({ items: [item("Jeans", 30, 1)] }),
      order({ id: "o2", items: [item("Hat", 10, 1)] }),
    ], 0);
    expect(r.all.averageOrder).toBe(20);
  });

  it("keeps money to the cent", () => {
    // 0.1 + 0.2 is 0.30000000000000004, and a seller checking this against
    // their own arithmetic will find it.
    const r = sellerSalesReport([
      order({ items: [item("A", 0.1, 1)] }),
      order({ id: "o2", items: [item("B", 0.2, 1)] }),
    ], 33.333);
    expect(r.all.gross).toBe(0.3);
    expect(r.all.commission).toBe(0.1);
    expect(r.all.net).toBe(0.2);
  });

  it("ranks the best sellers by units, then revenue, then name", () => {
    const r = sellerSalesReport([
      order({ items: [item("Jeans", 20, 1), item("Hat", 5, 4)] }),
    ], 0);
    expect(r.topProducts.map((p) => p.name)).toEqual(["Hat", "Jeans"]);
    expect(r.topProducts[0]).toMatchObject({ units: 4, gross: 20 });
  });

  it("groups the same product across orders", () => {
    const r = sellerSalesReport([
      order({ items: [item("Jeans", 20, 1)] }),
      order({ id: "o2", items: [item("Jeans", 20, 2)] }),
    ], 0);
    expect(r.topProducts).toHaveLength(1);
    expect(r.topProducts[0]).toMatchObject({ units: 3, gross: 60 });
  });

  it("still reports a line whose product has since been deleted", () => {
    // A store asking "what sells" wants last quarter's answer too.
    const gone = { name: "Old thing", price: 10, qty: 2 } as unknown as OrderItem;
    const r = sellerSalesReport([order({ items: [gone] })], 0);
    expect(r.topProducts[0]).toMatchObject({ name: "Old thing", units: 2 });
  });

  it("fills the quiet months instead of hiding them", () => {
    // August selling nothing is the point of the chart, not a gap to close
    // by pretending July and September were consecutive.
    const r = sellerSalesReport([
      order({ created_at: "2026-07-04T00:00:00Z", items: [item("A", 10, 1)] }),
      order({ id: "o2", created_at: "2026-09-04T00:00:00Z", items: [item("A", 10, 1)] }),
    ], 0);
    expect(r.byMonth.map((m) => m.period)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(r.byMonth[1]).toMatchObject({ orders: 0, gross: 0 });
  });

  it("uses the subtotal it was given rather than re-adding the lines", () => {
    // mySubtotal is computed server-side over this seller's items only. If
    // this recomputed it from myItems it would agree today and drift the
    // day a discount or a fee lands on the order.
    const r = sellerSalesReport([
      order({ items: [item("Jeans", 20, 1)], mySubtotal: 18 }),
    ], 0);
    expect(r.all.gross).toBe(18);
  });

  it("survives a rate that is missing or nonsense", () => {
    const o = [order({ items: [item("A", 10, 1)] })];
    expect(sellerSalesReport(o, NaN).all.commission).toBe(0);
    expect(sellerSalesReport(o, undefined as unknown as number).all.commission).toBe(0);
  });
});

describe("month arithmetic", () => {
  it("reads the month off an ISO timestamp", () => {
    expect(monthOf("2026-09-04T10:00:00Z")).toBe("2026-09");
  });

  it("walks across a year boundary", () => {
    expect(monthRange("2025-11", "2026-02"))
      .toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("handles a single month and a reversed range", () => {
    expect(monthRange("2026-09", "2026-09")).toEqual(["2026-09"]);
    expect(monthRange("2026-09", "2026-01")).toEqual(["2026-09"]);
  });

  it("is bounded, so a bad range cannot spin a serverless function", () => {
    expect(monthRange("1900-01", "2500-01").length).toBeLessThanOrEqual(240);
  });
});
