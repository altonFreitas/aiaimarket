import { describe, it, expect } from "vitest";
import {
  buildProductDemand, computeFunnel, findDemandSignals, signalsOf,
  demandByCategory, computeCatalogHealth,
} from "@/lib/demand";
import type { Category, Order, OrderItem, Product } from "@/lib/types";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1", seller_id: "s1", ref: "PRD-001", name: "Widget", slug: "widget",
  category_id: "c1", price: 10, discount_price: null, sizes: [], tags: [],
  stock_status: "in", qty: 5, description: "", images: ["a.jpg"], municipality: null,
  post: null, suku: null, landmark: null, pay_cod: true, pay_cop: false,
  pay_bank: false, pay_wallet: false, pay_fiar: false, archived: false,
  status: "approved", views: 0, wa_clicks: 0, created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const category = (over: Partial<Category> = {}): Category => ({
  id: "c1", name: "Furniture", slug: "furniture", parent_id: null, sort_order: 0, ...over,
});

const item = (over: Partial<OrderItem> = {}): OrderItem => ({
  product_id: "p1", seller_id: "s1", name: "Widget", size: "", price: 10, qty: 2, ...over,
});

const order = (over: Partial<Order> = {}): Order => ({
  id: "o" + Math.random(), ref: "DL-0001", buyer_name: "Bob", buyer_phone: "77000001",
  items: [item()], mode: "delivery", zone_id: "dili_center", fee: 3,
  quote_requested: false, subtotal: 20, total: 23, address_line: "Rua 1",
  municipality: "Dili", post: null, suku: null, aldeia: null, landmark: null,
  pay_method: "cod", pay_status: "unpaid", proof_url: null, note: "",
  status: "completed", cancel_reason: null, cancel_requested_at: null,
  created_at: "2026-06-01T10:00:00Z", ...over,
});

describe("buildProductDemand", () => {
  it("joins lifetime view counters to all-time order history", () => {
    const rows = buildProductDemand(
      [product({ views: 100, wa_clicks: 20 })], [order()], [category()]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      views: 100, waClicks: 20, orders: 1, units: 2, revenue: 20,
      categoryName: "Furniture",
    });
    expect(rows[0].viewToClick).toBeCloseTo(0.2);
    expect(rows[0].clickToOrder).toBeCloseTo(0.05);
    expect(rows[0].viewToOrder).toBeCloseTo(0.01);
  });

  it("leaves rates NULL rather than zero when the denominator is zero", () => {
    const rows = buildProductDemand([product({ views: 0, wa_clicks: 0 })], [], [category()]);
    expect(rows[0].viewToClick).toBeNull();
    expect(rows[0].clickToOrder).toBeNull();
    expect(rows[0].viewToOrder).toBeNull();
  });

  it("excludes archived products -- they cannot be bought", () => {
    const rows = buildProductDemand(
      [product({ views: 500 }), product({ id: "p2", archived: true, views: 999 })],
      [], [category()]
    );
    expect(rows.map((r) => r.productId)).toEqual(["p1"]);
  });

  it("excludes cancelled orders from the sold side", () => {
    const rows = buildProductDemand(
      [product({ views: 100 })],
      [order({ status: "completed" }), order({ status: "cancelled" })],
      [category()]
    );
    expect(rows[0].orders).toBe(1);
    expect(rows[0].units).toBe(2);
  });

  it("counts an order once even when it holds the product on two lines", () => {
    const rows = buildProductDemand(
      [product({ views: 50 })],
      [order({ items: [item({ qty: 1 }), item({ qty: 3 })] })],
      [category()]
    );
    expect(rows[0].orders).toBe(1);   // one order...
    expect(rows[0].units).toBe(4);    // ...four units
  });

  it("labels a product whose category was deleted rather than dropping it", () => {
    const rows = buildProductDemand([product({ views: 5 })], [], []);
    expect(rows[0].categoryName).toBe("");
  });
});

describe("computeFunnel", () => {
  it("totals the three stages and both conversion rates", () => {
    const rows = buildProductDemand(
      [product({ views: 100, wa_clicks: 10 }),
       product({ id: "p2", ref: "PRD-002", views: 100, wa_clicks: 30 })],
      [order()], [category()]
    );
    const f = computeFunnel(rows);
    expect(f.views).toBe(200);
    expect(f.waClicks).toBe(40);
    expect(f.orders).toBe(1);
    expect(f.viewToClick).toBeCloseTo(0.2);
  });

  it("has null rates, not zero, on an empty catalog", () => {
    const f = computeFunnel([]);
    expect(f.views).toBe(0);
    expect(f.viewToOrder).toBeNull();
  });
});

describe("findDemandSignals", () => {
  const catalog = () => [
    // wanted but unbuyable
    product({ id: "hot", ref: "PRD-HOT", name: "Hot", views: 500, stock_status: "out" }),
    // plenty of interest, never sells
    product({ id: "dud", ref: "PRD-DUD", name: "Dud", views: 400 }),
    // sells well despite low visibility
    product({ id: "hidden", ref: "PRD-HID", name: "Hidden", views: 5 }),
    // nobody looks, nobody buys
    product({ id: "dead", ref: "PRD-DEAD", name: "Dead", views: 1 }),
  ];
  const sales = () => [
    order({ items: [item({ product_id: "hidden", name: "Hidden" })] }),
    order({ items: [item({ product_id: "hidden", name: "Hidden" })] }),
    order({ items: [item({ product_id: "hidden", name: "Hidden" })] }),
  ];

  it("flags an out-of-stock product people keep looking at as lost sales", () => {
    const f = findDemandSignals(buildProductDemand(catalog(), sales(), [category()]));
    expect(signalsOf(f, "lost_sales").map((x) => x.name)).toEqual(["Hot"]);
  });

  it("flags heavy views with no sales as a listing or price problem", () => {
    const f = findDemandSignals(buildProductDemand(catalog(), sales(), [category()]));
    expect(signalsOf(f, "views_no_sales").map((x) => x.name)).toEqual(["Dud"]);
  });

  it("flags a product that sells despite low visibility as underexposed", () => {
    const f = findDemandSignals(buildProductDemand(catalog(), sales(), [category()]));
    expect(signalsOf(f, "underexposed").map((x) => x.name)).toEqual(["Hidden"]);
  });

  it("flags a product nobody looks at and nobody buys as ignored", () => {
    const f = findDemandSignals(buildProductDemand(catalog(), sales(), [category()]));
    expect(signalsOf(f, "ignored").map((x) => x.name)).toEqual(["Dead"]);
  });

  it("prefers restocking over re-pricing when a product looks like both", () => {
    // Out of stock AND zero sales AND heavy views: lost_sales wins, because
    // restocking is the action -- the price may be fine.
    const rows = buildProductDemand(
      [product({ id: "x", views: 900, stock_status: "out" }),
       product({ id: "y", views: 10 })],
      [], [category()]
    );
    const f = findDemandSignals(rows);
    const x = f.find((r) => r.productId === "x");
    expect(x?.signal).toBe("lost_sales");
  });

  it("does not call three views and no sale a finding", () => {
    // minViews guards against declaring a verdict on noise.
    const rows = buildProductDemand([product({ views: 3 })], [], [category()]);
    const f = findDemandSignals(rows, { minViews: 10 });
    expect(signalsOf(f, "views_no_sales")).toHaveLength(0);
  });
});

describe("demandByCategory", () => {
  it("ranks categories by attention and reports where it converts", () => {
    const rows = buildProductDemand(
      [product({ id: "a", views: 300, category_id: "c1" }),
       product({ id: "b", views: 100, category_id: "c2" })],
      [order({ items: [item({ product_id: "b" })] })],
      [category(), category({ id: "c2", name: "Seating" })]
    );
    const cats = demandByCategory(rows);
    expect(cats[0].label).toBe("Furniture");     // most viewed
    expect(cats[0].viewShare).toBeCloseTo(0.75);
    // Seating draws less attention but actually converts.
    const seating = cats.find((c) => c.label === "Seating");
    expect(seating?.viewToOrder).toBeCloseTo(0.01);
    expect(cats[0].viewToOrder).toBe(0);
  });

  it("buckets products with no category under one label", () => {
    const rows = buildProductDemand([product({ category_id: null, views: 4 })], [], []);
    expect(demandByCategory(rows)[0].label).toBe("Uncategorised");
  });
});

describe("computeCatalogHealth", () => {
  it("counts the listing problems that suppress demand", () => {
    const rows = buildProductDemand([
      product({ id: "a", stock_status: "out" }),
      product({ id: "b", stock_status: "low" }),
      product({ id: "c", images: [] }),
      product({ id: "d", category_id: null }),
      product({ id: "e", status: "pending" }),
      product({ id: "f", views: 12 }),
    ], [], [category()]);
    const h = computeCatalogHealth(rows);
    expect(h.live).toBe(6);
    expect(h.outOfStock).toBe(1);
    expect(h.lowStock).toBe(1);
    expect(h.noImage).toBe(1);
    expect(h.uncategorised).toBe(1);
    expect(h.pendingApproval).toBe(1);
    expect(h.neverViewed).toBe(5);
  });
});
