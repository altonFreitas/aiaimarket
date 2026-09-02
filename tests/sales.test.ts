import { describe, it, expect } from "vitest";
import {
  buildSalesLines, totals, growth, computeSalesKpis, groupOrders,
  deliveryDelayDays, deliveryState, salesByMonth, monthKeys, salesByQuarter,
  salesByYear, salesByDay, salesByWeek, weekStart, salesByProduct, salesByCategory, salesByCustomer,
  salesBySeller, salesByMunicipality, rank, customerAnalysis, statusBreakdown,
  lowPerformers, targetProgress, buildSalesAlerts, buildInsights,
  filterSalesLines, filterIsActive, linesToCsv, todayIso, daysBetween, shiftIso,
  type LineSources, type SalesTarget, returnKey, returnableQty } from "@/lib/sales";
import type { Category, Order, OrderItem, OrderStatus, Product, Seller } from "@/lib/types";

const TODAY = "2026-06-15";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1", seller_id: "sel1", ref: "PRD-001", name: "Widget", slug: "widget",
  category_id: "c1", price: 10, discount_price: null, sizes: [], tags: [],
  stock_status: "in", qty: 5, description: "", images: [], municipality: null,
  post: null, suku: null, landmark: null, pay_cod: true, pay_cop: false,
  pay_bank: false, pay_wallet: false, pay_fiar: false, archived: false,
  status: "approved", views: 0, wa_clicks: 0, created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const category = (over: Partial<Category> = {}): Category => ({
  id: "c1", name: "Furniture", slug: "furniture", parent_id: null, sort_order: 0, ...over,
});

const seller = (over: Partial<Seller> = {}): Seller => ({
  id: "sel1", user_id: null, full_name: "Ana", store_name: "Ana's Store", slug: "ana",
  email: "", phone: "", description: "", address: "", city: "", country: "TL",
  seller_type: "individual", status: "approved", commission_rate: null,
  delivery_available: true, pickup_available: false, delivery_fee: null,
  delivery_area: "", totp_enabled: false, created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const item = (over: Partial<OrderItem> = {}): OrderItem => ({
  product_id: "p1", seller_id: "sel1", name: "Widget", size: "", price: 10, qty: 2, ...over,
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

const sources = (over: Partial<LineSources> = {}): LineSources => ({
  products: [product()], categories: [category()], sellers: [seller()],
  costs: new Map([["p1", 6]]), ...over,
});

const lines = (orders: Order[], src: Partial<LineSources> = {}) =>
  buildSalesLines(orders, sources(src));

/* ------------------------------- dates ------------------------------- */

describe("date helpers", () => {
  it("formats today in LOCAL time, not UTC", () => {
    // 23:30 local on the 14th is already the 15th in UTC. toISOString()
    // would report the wrong day for half of every evening.
    const d = new Date(2026, 5, 14, 23, 30);
    expect(todayIso(d)).toBe("2026-06-14");
  });

  it("counts whole days between dates, signed", () => {
    expect(daysBetween("2026-06-01", "2026-06-15")).toBe(14);
    expect(daysBetween("2026-06-15", "2026-06-01")).toBe(-14);
    expect(daysBetween("2026-06-15", "2026-06-15")).toBe(0);
  });

  it("shifts dates across month boundaries", () => {
    expect(shiftIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIso("2026-01-31", 1)).toBe("2026-02-01");
  });
});

/* ---------------------------- line building ---------------------------- */

describe("buildSalesLines", () => {
  it("flattens each order into one line per item with joined names", () => {
    const ls = lines([order()]);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({
      productName: "Widget", categoryName: "Furniture", sellerName: "Ana's Store",
      municipality: "Dili", qty: 2, unitPrice: 10, netSales: 20,
    });
  });

  it("excludes the delivery fee from net sales", () => {
    // The order's total is 23 (20 goods + 3 delivery). Revenue is 20.
    const ls = lines([order({ fee: 3, total: 23 })]);
    expect(totals(ls).revenue).toBe(20);
  });

  it("computes profit and margin from the cost map", () => {
    const ls = lines([order()]);
    expect(ls[0].cost).toBe(12);        // 6 x 2
    expect(ls[0].grossProfit).toBe(8);  // 20 - 12
    expect(ls[0].margin).toBeCloseTo(0.4);
  });

  it("prefers the cost SNAPSHOT on the line over the live cost", () => {
    // The product costs 6 today but cost 4 when this sold. History must not
    // move when a supplier reprices.
    const ls = lines([order({ items: [item({ cost: 4 })] })]);
    expect(ls[0].cost).toBe(8);
    expect(ls[0].grossProfit).toBe(12);
  });

  it("leaves profit NULL when no cost is known, never zero", () => {
    const ls = lines([order()], { costs: new Map() });
    expect(ls[0].cost).toBeNull();
    expect(ls[0].grossProfit).toBeNull();
    expect(ls[0].margin).toBeNull();
  });

  it("reconstructs the discount from the product's list price", () => {
    const ls = lines([order({ items: [item({ price: 8 })] })]);   // list 10, paid 8
    expect(ls[0].discount).toBe(4);                                // 2 x 2 units
  });

  it("never reports a negative discount after a price cut", () => {
    // The product now lists at 5 but this order paid 10. That is not a
    // -100% discount; it is an old order at the old price.
    const ls = lines([order()], { products: [product({ price: 5 })] });
    expect(ls[0].discount).toBe(0);
  });

  it("keeps the order's own item snapshot when the product is gone", () => {
    const ls = lines([order()], { products: [], categories: [], costs: new Map() });
    expect(ls[0].productName).toBe("Widget");
    expect(ls[0].netSales).toBe(20);
    expect(ls[0].categoryName).toBe("");
  });

  it("labels a pickup order's municipality rather than leaving it blank", () => {
    const ls = lines([order({ mode: "pickup", municipality: null })]);
    expect(ls[0].municipality).toBe("Pickup");
  });
});

/* -------------------------------- totals -------------------------------- */

describe("totals", () => {
  it("excludes cancelled orders from revenue entirely", () => {
    const ls = lines([order({ status: "completed" }), order({ status: "cancelled" })]);
    expect(totals(ls).revenue).toBe(20);
    expect(totals(ls).orders).toBe(1);
  });

  it("counts distinct orders, not lines", () => {
    const ls = lines([order({
      items: [item(), item({ product_id: "p1", name: "Widget", qty: 1 })],
    })]);
    expect(ls).toHaveLength(2);
    expect(totals(ls).orders).toBe(1);
    expect(totals(ls).qty).toBe(3);
  });

  it("reports cost coverage when only some lines are costed", () => {
    const ls = lines([order({
      items: [item(), item({ product_id: "p2", name: "Other", price: 30, qty: 1 })],
    })], { costs: new Map([["p1", 6]]) });
    const t = totals(ls);
    expect(t.revenue).toBe(50);          // 20 + 30
    expect(t.costCoverage).toBeCloseTo(0.4);  // only the 20 is costed
    // Margin describes the costed subset only: (20-12)/20, not (50-12)/50.
    expect(t.margin).toBeCloseTo(0.4);
  });

  it("has null margin, not zero, when nothing is costed", () => {
    const t = totals(lines([order()], { costs: new Map() }));
    expect(t.grossProfit).toBeNull();
    expect(t.margin).toBeNull();
    expect(t.costCoverage).toBe(0);
  });
});

describe("growth", () => {
  it("returns null against a zero baseline instead of Infinity", () => {
    expect(growth(100, 0)).toBeNull();
  });
  it("computes signed percentage change", () => {
    expect(growth(150, 100)).toBeCloseTo(0.5);
    expect(growth(75, 100)).toBeCloseTo(-0.25);
  });
});

/* --------------------------------- KPIs --------------------------------- */

describe("computeSalesKpis", () => {
  it("separates sold from delivered revenue", () => {
    const ls = lines([
      order({ status: "completed" }),
      order({ status: "confirmed" }),
    ]);
    const k = computeSalesKpis(ls, { today: TODAY });
    expect(k.revenue).toBe(40);           // both count as sales
    expect(k.deliveredRevenue).toBe(20);  // only the completed one is realised
    expect(k.pendingOrders).toBe(1);
    expect(k.pendingValue).toBe(20);
  });

  it("computes AOV and units per order over non-cancelled orders", () => {
    const ls = lines([order(), order({ items: [item({ qty: 4 })] })]);
    const k = computeSalesKpis(ls, { today: TODAY });
    expect(k.avgOrderValue).toBe(30);   // (20 + 40) / 2
    expect(k.unitsPerOrder).toBe(3);    // (2 + 4) / 2
  });

  it("counts a customer as returning only when they bought before the window", () => {
    const prior = lines([order({ buyer_phone: "77000001" })]);
    const ls = lines([order({ buyer_phone: "77000001" }), order({ buyer_phone: "77000002" })]);
    const k = computeSalesKpis(ls, { today: TODAY, priorLines: prior });
    expect(k.customers).toBe(2);
    expect(k.newCustomers).toBe(1);
    expect(k.returningCustomers).toBe(1);
  });

  it("treats every customer as new when there is no prior history", () => {
    const k = computeSalesKpis(lines([order()]), { today: TODAY });
    expect(k.newCustomers).toBe(1);
  });

  it("counts active customers within the window only", () => {
    const ls = lines([
      order({ created_at: "2026-06-10T00:00:00Z", buyer_phone: "1" }),
      order({ created_at: "2025-01-01T00:00:00Z", buyer_phone: "2" }),
    ]);
    const k = computeSalesKpis(ls, { today: TODAY, activeWindowDays: 90 });
    expect(k.customers).toBe(2);
    expect(k.activeCustomers).toBe(1);
  });

  it("measures on-time rate only over orders that promised a date", () => {
    const ls = lines([
      // promised the 10th, delivered the 9th -> on time
      order({ expected_delivery: "2026-06-10", delivered_at: "2026-06-09", status: "completed" }),
      // promised the 1st, delivered the 5th -> late
      order({ expected_delivery: "2026-06-01", delivered_at: "2026-06-05", status: "completed" }),
      // no promise at all -> not counted either way
      order({ status: "completed" }),
    ]);
    const k = computeSalesKpis(ls, { today: TODAY });
    expect(k.onTimeRate).toBeCloseTo(0.5);
  });

  it("has a null on-time rate when nothing ever promised a date", () => {
    expect(computeSalesKpis(lines([order()]), { today: TODAY }).onTimeRate).toBeNull();
  });

  it("counts an undelivered order past its promised date as delayed", () => {
    const ls = lines([order({ expected_delivery: "2026-06-01", status: "out" })]);
    expect(computeSalesKpis(ls, { today: TODAY }).delayedOrders).toBe(1);
  });

  it("computes the cancellation rate over all orders including cancelled", () => {
    const ls = lines([order(), order(), order({ status: "cancelled" })]);
    expect(computeSalesKpis(ls, { today: TODAY }).cancellationRate).toBeCloseTo(1 / 3);
  });
});

/* ------------------------------ order rollup ------------------------------ */

describe("groupOrders", () => {
  it("sums lines back into one row per order", () => {
    const ls = lines([order({
      items: [item(), item({ product_id: "p2", name: "Other", price: 5, qty: 3 })],
    })]);
    const rolled = groupOrders(ls);
    expect(rolled).toHaveLength(1);
    expect(rolled[0].revenue).toBe(35);
    expect(rolled[0].qty).toBe(5);
  });

  it("states an order's margin against its costed lines only", () => {
    const ls = lines([order({
      items: [item(), item({ product_id: "p2", name: "Other", price: 30, qty: 1 })],
    })], { costs: new Map([["p1", 6]]) });
    const [o] = groupOrders(ls);
    expect(o.cost).toBe(12);
    expect(o.grossProfit).toBe(8);        // against the 20, not the 50
    expect(o.margin).toBeCloseTo(0.4);
  });
});

describe("deliveryDelayDays", () => {
  const roll = (over: Partial<Order>) => groupOrders(lines([order(over)]))[0];

  it("is null when no delivery date was ever promised", () => {
    expect(deliveryDelayDays(roll({}), TODAY)).toBeNull();
  });

  it("measures a delivered order against its ACTUAL arrival, so it stops growing", () => {
    const o = roll({ expected_delivery: "2026-06-01", delivered_at: "2026-06-04", status: "completed" });
    expect(deliveryDelayDays(o, TODAY)).toBe(3);
    expect(deliveryDelayDays(o, "2026-12-31")).toBe(3);
  });

  it("measures an undelivered order against today, so it grows daily", () => {
    const o = roll({ expected_delivery: "2026-06-01", status: "out" });
    expect(deliveryDelayDays(o, "2026-06-05")).toBe(4);
    expect(deliveryDelayDays(o, "2026-06-15")).toBe(14);
  });

  it("is zero, not negative, for an early delivery", () => {
    const o = roll({ expected_delivery: "2026-06-10", delivered_at: "2026-06-01", status: "completed" });
    expect(deliveryDelayDays(o, TODAY)).toBe(0);
  });

  it("classifies delivery states", () => {
    expect(deliveryState(roll({ expected_delivery: "2026-06-01", delivered_at: "2026-06-01", status: "completed" }), TODAY))
      .toBe("delivered_on_time");
    expect(deliveryState(roll({ expected_delivery: "2026-06-01", delivered_at: "2026-06-09", status: "completed" }), TODAY))
      .toBe("delivered_late");
    expect(deliveryState(roll({ expected_delivery: "2026-06-01", status: "out" }), TODAY)).toBe("delayed");
    expect(deliveryState(roll({ expected_delivery: "2026-06-20", status: "out" }), TODAY)).toBe("due");
    expect(deliveryState(roll({ status: "out" }), TODAY)).toBe("no_date");
    expect(deliveryState(roll({ status: "cancelled", expected_delivery: "2026-01-01" }), TODAY)).toBe("cancelled");
  });
});

/* ------------------------------ time series ------------------------------ */

describe("time series", () => {
  it("buckets by month and keeps empty months in the series", () => {
    const ls = lines([order({ created_at: "2026-03-05T00:00:00Z" })]);
    const series = salesByMonth(ls, monthKeys(2026));
    expect(series).toHaveLength(12);
    expect(series[2].revenue).toBe(20);   // March
    expect(series[3].revenue).toBe(0);    // April, still present
  });

  it("buckets by quarter within a year", () => {
    const ls = lines([
      order({ created_at: "2026-02-01T00:00:00Z" }),
      order({ created_at: "2026-08-01T00:00:00Z" }),
    ]);
    const q = salesByQuarter(ls, 2026);
    expect(q[0].revenue).toBe(20);
    expect(q[2].revenue).toBe(20);
    expect(q[1].revenue).toBe(0);
  });

  it("lists only years that have data", () => {
    const ls = lines([
      order({ created_at: "2025-06-01T00:00:00Z" }),
      order({ created_at: "2026-06-01T00:00:00Z" }),
    ]);
    expect(salesByYear(ls).map((y) => y.key)).toEqual(["2025", "2026"]);
  });

  it("anchors a week to the Monday on or before the date", () => {
    // 2026-06-15 is a Monday.
    expect(weekStart("2026-06-15")).toBe("2026-06-15");
    expect(weekStart("2026-06-18")).toBe("2026-06-15");  // Thursday
    // Sunday belongs to the week that STARTED, not the one about to.
    expect(weekStart("2026-06-21")).toBe("2026-06-15");
    expect(weekStart("2026-06-22")).toBe("2026-06-22");  // next Monday
  });

  it("puts a new-year date in the week that began in the old year", () => {
    // 2026-01-01 is a Thursday; its week began Monday 2025-12-29. An ISO
    // week NUMBER would call this week 1 of 2026 and lose that.
    expect(weekStart("2026-01-01")).toBe("2025-12-29");
  });

  it("returns a dense weekly series ending with this week", () => {
    const ls = lines([order({ created_at: "2026-06-10T00:00:00Z" })]);
    const weeks = salesByWeek(ls, TODAY, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[3].key).toBe("2026-06-15");   // the week containing TODAY
    expect(weeks[2].key).toBe("2026-06-08");   // the one before it
    expect(weeks[2].revenue).toBe(20);
    expect(weeks[1].revenue).toBe(0);          // empty weeks are kept
  });

  it("groups every day of a week into the same bucket", () => {
    const ls = lines([
      order({ created_at: "2026-06-08T00:00:00Z" }),   // Monday
      order({ created_at: "2026-06-14T00:00:00Z" }),   // Sunday
    ]);
    const weeks = salesByWeek(ls, TODAY, 2);
    expect(weeks[0].key).toBe("2026-06-08");
    expect(weeks[0].revenue).toBe(40);
    expect(weeks[0].orders).toBe(2);
  });

  it("labels a week by the day it starts", () => {
    expect(salesByWeek([], "2026-06-15", 1)[0].label).toBe("15/06");
  });

  it("returns a dense daily series ending today", () => {
    const ls = lines([order({ created_at: "2026-06-14T00:00:00Z" })]);
    const days = salesByDay(ls, TODAY, 7);
    expect(days).toHaveLength(7);
    expect(days[6].key).toBe(TODAY);
    expect(days[5].revenue).toBe(20);
  });
});

/* ------------------------------- group-bys ------------------------------- */

describe("group-bys", () => {
  const mixed = () => lines([
    order({ items: [item()] }),                                   // Widget 20
    order({
      buyer_phone: "77000002", buyer_name: "Cara", municipality: "Baucau",
      items: [item({ product_id: "p2", name: "Chair", seller_id: "sel2", price: 50, qty: 1 })],
    }),
  ], {
    products: [product(), product({ id: "p2", name: "Chair", category_id: "c2" })],
    categories: [category(), category({ id: "c2", name: "Seating" })],
    sellers: [seller(), seller({ id: "sel2", store_name: "Bee Shop" })],
    costs: new Map([["p1", 6], ["p2", 20]]),
  });

  it("groups by product, sorted by revenue, with shares that sum to 1", () => {
    const rows = salesByProduct(mixed());
    expect(rows[0].label).toBe("Chair");
    expect(rows[0].revenue).toBe(50);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1);
  });

  it("groups by category, customer, seller and municipality", () => {
    expect(salesByCategory(mixed()).map((r) => r.label).sort()).toEqual(["Furniture", "Seating"]);
    expect(salesByCustomer(mixed())[0].label).toBe("Cara");
    expect(salesBySeller(mixed())[0].label).toBe("Bee Shop");
    expect(salesByMunicipality(mixed()).map((r) => r.label).sort()).toEqual(["Baucau", "Dili"]);
  });

  it("labels uncategorised products rather than dropping them", () => {
    const ls = lines([order()], { categories: [] });
    expect(salesByCategory(ls)[0].label).toBe("Uncategorised");
  });

  it("re-ranks by the requested measure", () => {
    const rows = salesByProduct(mixed());
    expect(rank(rows, "qty")[0].label).toBe("Widget");        // 2 units vs 1
    expect(rank(rows, "revenue")[0].label).toBe("Chair");     // 50 vs 20
    expect(rank(rows, "profit")[0].label).toBe("Chair");      // 30 vs 8
  });

  it("sorts unknown margins last in BOTH directions, never as zero", () => {
    const ls = lines([
      order({ items: [item()] }),
      order({ items: [item({ product_id: "p9", name: "Unknown", price: 5, qty: 1 })] }),
    ], { costs: new Map([["p1", 6]]) });
    const ranked = rank(salesByProduct(ls), "margin");
    expect(ranked[ranked.length - 1].label).toBe("Unknown");
  });
});

/* --------------------------- customer analysis --------------------------- */

describe("customerAnalysis", () => {
  it("records first and last purchase and days since", () => {
    const ls = lines([
      order({ created_at: "2026-01-10T00:00:00Z" }),
      order({ created_at: "2026-06-10T00:00:00Z" }),
    ]);
    const [c] = customerAnalysis(ls, { today: TODAY });
    expect(c.firstPurchase).toBe("2026-01-10");
    expect(c.lastPurchase).toBe("2026-06-10");
    expect(c.daysSincePurchase).toBe(5);
    expect(c.orders).toBe(2);
  });

  it("flags a customer inactive past the window", () => {
    const ls = lines([order({ created_at: "2026-01-01T00:00:00Z" })]);
    const [c] = customerAnalysis(ls, { today: TODAY, inactiveDays: 90 });
    expect(c.isInactive).toBe(true);
  });

  it("detects declining purchases by comparing halves of their history", () => {
    const ls = lines([
      order({ created_at: "2026-01-01T00:00:00Z", items: [item({ qty: 10 })] }),
      order({ created_at: "2026-06-01T00:00:00Z", items: [item({ qty: 1 })] }),
    ]);
    const [c] = customerAnalysis(ls, { today: TODAY });
    expect(c.trend).not.toBeNull();
    expect(c.trend as number).toBeLessThan(0);
  });

  it("has a null trend for a one-off buyer rather than inventing one", () => {
    const [c] = customerAnalysis(lines([order()]), { today: TODAY });
    expect(c.trend).toBeNull();
  });

  it("counts outstanding orders and their value", () => {
    const ls = lines([order({ status: "confirmed" }), order({ status: "completed" })]);
    const [c] = customerAnalysis(ls, { today: TODAY });
    expect(c.outstandingOrders).toBe(1);
    expect(c.outstandingValue).toBe(20);
  });
});

/* --------------------------------- status --------------------------------- */

describe("statusBreakdown", () => {
  it("reports every status in flow order, including empty ones", () => {
    const ls = lines([order({ status: "confirmed" }), order({ status: "cancelled" })]);
    const rows = statusBreakdown(ls);
    expect(rows.map((r) => r.status)).toEqual([
      "new", "confirmed", "preparing", "out", "arrived", "completed", "cancelled",
    ]);
    expect(rows.find((r) => r.status === "confirmed")).toMatchObject({ count: 1, value: 20 });
    expect(rows.find((r) => r.status === "new")).toMatchObject({ count: 0, value: 0 });
  });
});

/* ----------------------------- low performers ----------------------------- */

describe("lowPerformers", () => {
  it("uses the median so one runaway seller does not condemn the catalog", () => {
    const ls = lines([
      order({ items: [item({ product_id: "star", name: "Star", price: 1000, qty: 1 })] }),
      order({ items: [item({ product_id: "mid1", name: "Mid1", price: 100, qty: 1 })] }),
      order({ items: [item({ product_id: "mid2", name: "Mid2", price: 100, qty: 1 })] }),
      order({ items: [item({ product_id: "dud", name: "Dud", price: 5, qty: 1 })] }),
    ], { costs: new Map() });
    const flagged = lowPerformers(ls).map((r) => r.label);
    expect(flagged).toContain("Dud");
    expect(flagged).not.toContain("Star");
    expect(flagged).not.toContain("Mid1");
  });

  it("includes catalog products that sold nothing at all", () => {
    const rows = lowPerformers(lines([order()]), {
      unsoldProducts: [{ id: "px", name: "Never Sold" }],
    });
    const dead = rows.find((r) => r.label === "Never Sold");
    expect(dead?.reasons).toContain("no_sales");
    expect(dead?.revenue).toBe(0);
  });

  it("flags a low margin product", () => {
    const ls = lines([order()], { costs: new Map([["p1", 9.8]]) });  // 2% margin
    expect(lowPerformers(ls)[0]?.reasons).toContain("low_margin");
  });
});

/* --------------------------------- targets --------------------------------- */

describe("targetProgress", () => {
  const targets: SalesTarget[] = [{
    id: "t1", period: "2026-06", scope: "global", scope_id: "",
    amount: 1000, created_at: "2026-01-01T00:00:00Z",
  }];

  it("computes achievement and what is left", () => {
    const p = targetProgress(targets, "2026-06", 750);
    expect(p.achievement).toBeCloseTo(0.75);
    expect(p.remaining).toBe(250);
    expect(p.difference).toBe(-250);
  });

  it("reports null achievement when no target exists, not 0%", () => {
    expect(targetProgress(targets, "2026-07", 500).achievement).toBeNull();
  });

  it("never reports negative remaining once the target is beaten", () => {
    const p = targetProgress(targets, "2026-06", 1500);
    expect(p.remaining).toBe(0);
    expect(p.difference).toBe(500);
  });
});

/* --------------------------------- alerts --------------------------------- */

describe("buildSalesAlerts", () => {
  const kinds = (ls: ReturnType<typeof lines>, over = {}) =>
    buildSalesAlerts(ls, { today: TODAY, ...over }).map((a) => a.kind);

  it("raises delayed deliveries", () => {
    const ls = lines([order({ expected_delivery: "2026-06-01", status: "out" })]);
    expect(kinds(ls)).toContain("delayed_deliveries");
  });

  it("raises a below-target alert only when a target exists", () => {
    const targets: SalesTarget[] = [{
      id: "t1", period: "2026-06", scope: "global", scope_id: "",
      amount: 1000, created_at: "2026-01-01T00:00:00Z",
    }];
    expect(kinds(lines([order()]), { targets, period: "2026-06" })).toContain("below_target");
    expect(kinds(lines([order()]), { targets, period: "2026-07" })).not.toContain("below_target");
  });

  it("raises declining sales against the previous period", () => {
    expect(kinds(lines([order()]), { previousRevenue: 100 })).toContain("sales_declining");
    expect(kinds(lines([order()]), { previousRevenue: 5 })).not.toContain("sales_declining");
  });

  it("explains blank margins when most revenue has no cost", () => {
    expect(kinds(lines([order()], { costs: new Map() }))).toContain("no_cost_data");
    expect(kinds(lines([order()]))).not.toContain("no_cost_data");
  });

  it("says nothing at all when there is nothing to say", () => {
    expect(kinds(lines([order({ status: "completed" })]))).toEqual([]);
  });
});

/* -------------------------------- insights -------------------------------- */

describe("buildInsights", () => {
  it("is empty for an empty book rather than inventing findings", () => {
    expect(buildInsights([], TODAY)).toEqual([]);
  });

  it("names the best product, customer and month", () => {
    const ls = lines([
      order({ created_at: "2026-03-01T00:00:00Z" }),
      order({
        created_at: "2026-05-01T00:00:00Z", buyer_name: "Cara", buyer_phone: "2",
        items: [item({ product_id: "p2", name: "Chair", price: 90, qty: 1 })],
      }),
    ]);
    const found = Object.fromEntries(buildInsights(ls, TODAY).map((i) => [i.kind, i.label]));
    expect(found.best_product).toBe("Chair");
    expect(found.best_customer).toBe("Cara");
    expect(found.best_month).toBe("2026-05");
  });
});

/* --------------------------------- filters --------------------------------- */

describe("filterSalesLines", () => {
  const ls = () => lines([
    order({ created_at: "2026-01-15T00:00:00Z", municipality: "Dili" }),
    order({
      created_at: "2026-06-10T00:00:00Z", municipality: "Baucau",
      buyer_name: "Cara", status: "cancelled",
      items: [item({ product_id: "p2", name: "Chair", price: 50, qty: 1 })],
    }),
  ]);

  it("filters by date range inclusively at both ends", () => {
    expect(filterSalesLines(ls(), { from: "2026-06-10", to: "2026-06-10" }, TODAY)).toHaveLength(1);
    expect(filterSalesLines(ls(), { from: "2026-01-01", to: "2026-12-31" }, TODAY)).toHaveLength(2);
  });

  it("filters by municipality, status and product", () => {
    expect(filterSalesLines(ls(), { municipality: "Dili" }, TODAY)).toHaveLength(1);
    expect(filterSalesLines(ls(), { status: "cancelled" }, TODAY)).toHaveLength(1);
    expect(filterSalesLines(ls(), { productId: "p2" }, TODAY)).toHaveLength(1);
  });

  it("searches across ref, product, customer and place", () => {
    expect(filterSalesLines(ls(), { q: "chair" }, TODAY)).toHaveLength(1);
    expect(filterSalesLines(ls(), { q: "cara" }, TODAY)).toHaveLength(1);
    expect(filterSalesLines(ls(), { q: "baucau" }, TODAY)).toHaveLength(1);
    expect(filterSalesLines(ls(), { q: "zzz" }, TODAY)).toHaveLength(0);
  });

  it("combines filters as AND", () => {
    expect(filterSalesLines(ls(), { municipality: "Dili", status: "cancelled" }, TODAY)).toHaveLength(0);
  });

  it("knows when any filter is set", () => {
    expect(filterIsActive({})).toBe(false);
    expect(filterIsActive({ status: "" })).toBe(false);
    expect(filterIsActive({ municipality: "Dili" })).toBe(true);
  });
});

/* ---------------------------------- CSV ---------------------------------- */

describe("linesToCsv", () => {
  it("writes a header and one row per line", () => {
    const csv = linesToCsv(lines([order()]));
    const rows = csv.split("\n");
    expect(rows[0]).toContain("ref,date,customer");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("Widget");
  });

  it("leaves cost and margin blank rather than zero when unknown", () => {
    const csv = linesToCsv(lines([order()], { costs: new Map() }));
    expect(csv.split("\n")[1]).toContain(",,,");
  });

  it("quotes cells containing commas or quotes", () => {
    const csv = linesToCsv(lines([order({ items: [item({ name: 'Chair, "big"' })] })]));
    expect(csv).toContain('"Chair, ""big"""');
  });

  it("neutralises a leading = so a product name cannot become a formula", () => {
    const csv = linesToCsv(lines([order({ items: [item({ name: "=1+1" })] })]));
    expect(csv).toContain("'=1+1");
  });
});

/* ----------------------- statuses used by the UI ----------------------- */

describe("status coverage", () => {
  it("covers every OrderStatus in SALES_STATUSES", () => {
    const all: OrderStatus[] = [
      "new", "confirmed", "preparing", "out", "arrived", "completed", "cancelled",
    ];
    const rows = statusBreakdown([]);
    expect(rows.map((r) => r.status).sort()).toEqual([...all].sort());
  });
});

/* ------------------------------ returns ------------------------------ */

describe("returns netted off the lines", () => {
  const o = order({ id: "o9", items: [item({ product_id: "p1", qty: 5, price: 10 })] });

  it("changes nothing when no returns are supplied", () => {
    const [l] = lines([o]);
    expect(l.qty).toBe(5);
    expect(l.netSales).toBe(50);
  });

  it("removes returned units from quantity and revenue", () => {
    const [l] = lines([o], { returns: new Map([[returnKey("o9", "p1"), 2]]) });
    expect(l.qty).toBe(3);
    expect(l.netSales).toBe(30);
  });

  it("carries the correction into cost and gross profit", () => {
    // cost 6/unit: 3 kept units cost 18 and earn 30, so 12 profit at 40%
    const [l] = lines([o], { returns: new Map([[returnKey("o9", "p1"), 2]]) });
    expect(l.cost).toBe(18);
    expect(l.grossProfit).toBe(12);
    expect(l.margin).toBeCloseTo(0.4, 6);
  });

  it("reports a fully returned line as nothing sold, not as a loss", () => {
    const [l] = lines([o], { returns: new Map([[returnKey("o9", "p1"), 5]]) });
    expect(l.qty).toBe(0);
    expect(l.netSales).toBe(0);
    expect(l.grossProfit).toBe(0);
    expect(l.margin).toBeNull();  // no revenue to have a margin on
  });

  it("never goes negative when more comes back than went out", () => {
    // A data error must not become negative revenue that quietly cancels a
    // real sale somewhere else in the total.
    const [l] = lines([o], { returns: new Map([[returnKey("o9", "p1"), 99]]) });
    expect(l.qty).toBe(0);
    expect(l.netSales).toBe(0);
  });

  it("applies a return to its own order only", () => {
    const other = order({ id: "o10", items: [item({ product_id: "p1", qty: 5, price: 10 })] });
    const out = lines([o, other], { returns: new Map([[returnKey("o9", "p1"), 5]]) });
    expect(out.find((l) => l.orderId === "o9")!.qty).toBe(0);
    expect(out.find((l) => l.orderId === "o10")!.qty).toBe(5);
  });

  it("applies a return to its own product only", () => {
    const two = order({ id: "o11", items: [
      item({ product_id: "p1", qty: 4, price: 10 }),
      item({ product_id: "p2", qty: 4, price: 10 }),
    ] });
    const out = lines([two], { returns: new Map([[returnKey("o11", "p1"), 4]]) });
    expect(out.find((l) => l.productId === "p1")!.qty).toBe(0);
    expect(out.find((l) => l.productId === "p2")!.qty).toBe(4);
  });
});

describe("returnableQty", () => {
  const none = new Map<string, number>();

  it("is the whole order when nothing has come back", () => {
    expect(returnableQty([{ product_id: "p1", qty: 3 }], none).get("p1")).toBe(3);
  });

  it("subtracts what has already been returned", () => {
    expect(returnableQty([{ product_id: "p1", qty: 3 }], new Map([["p1", 2]])).get("p1")).toBe(1);
  });

  it("adds up two sizes of one product into one allowance", () => {
    // Stock does not care about sizes, so neither can the allowance:
    // otherwise returning the M would be checked against the L's quantity.
    expect(returnableQty(
      [{ product_id: "p1", qty: 2 }, { product_id: "p1", qty: 3 }], none).get("p1")).toBe(5);
  });

  it("never goes below zero, however much was recorded as returned", () => {
    expect(returnableQty([{ product_id: "p1", qty: 3 }], new Map([["p1", 99]])).get("p1")).toBe(0);
  });

  it("ignores a line with no product", () => {
    expect(returnableQty([{ product_id: "", qty: 3 }], none).size).toBe(0);
  });
});
