import { describe, it, expect } from "vitest";
import {
  daysBetween, poSubtotal, poTotal, poQty, poDelayDays, isDelayed, poDaysRemaining,
  poLeadTime, arrivedOnTime, deliveryState, computeKpis, growth, spendByMonth,
  supplierPerformance, spendByCountry, spendByCategory, spendByProduct,
  statusBreakdown, buildAlerts, filterPurchaseOrders, scoreSupplier,
  landedCosts, isResaleLine, parseSizes,
} from "@/lib/procurement";
import type { PoStatus, PurchaseOrder, PurchaseOrderItem, Supplier } from "@/lib/types";

const TODAY = "2026-06-15";

const supplier = (over: Partial<Supplier> = {}): Supplier => ({
  id: "s1", name: "Acme", country_code: "PT", contact_name: "", email: "", phone: "",
  lead_time_days: null, notes: "", active: true, created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const line = (over: Partial<PurchaseOrderItem> = {}): PurchaseOrderItem => ({
  id: "i" + Math.random(), po_id: "po1", product_id: null, product_name: "Widget",
  category: "components", qty: 10, unit_price: 5, created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po" + Math.random(), po_number: "PO-2026-0001", supplier_id: "s1", buyer: "Ana",
  order_date: "2026-05-01", expected_arrival: "2026-06-01", actual_arrival: null,
  currency: "USD", fx_rate: 1, tax: 0, shipping: 0, discount: 0,
  status: "confirmed", payment_status: "unpaid", payment_date: null, notes: "",
  created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
  items: [line()],
  ...over,
});

describe("daysBetween", () => {
  it("counts forward days and returns negatives backwards", () => {
    expect(daysBetween("2026-06-01", "2026-06-15")).toBe(14);
    expect(daysBetween("2026-06-15", "2026-06-01")).toBe(-14);
    expect(daysBetween("2026-06-15", "2026-06-15")).toBe(0);
  });
  it("crosses months and years without drifting", () => {
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    // 2028 is a leap year: February has to be 29 days here.
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("money", () => {
  it("totals lines as quantity x unit price", () => {
    expect(poSubtotal(po({ items: [line({ qty: 10, unit_price: 5 })] }))).toBe(50);
  });

  it("adds tax and shipping and subtracts discount for landed cost", () => {
    const p = po({ items: [line({ qty: 10, unit_price: 5 })], tax: 7, shipping: 3, discount: 2 });
    expect(poSubtotal(p)).toBe(50);
    expect(poTotal(p)).toBe(58);
  });

  it("converts to base currency with the rate captured at order time", () => {
    // The whole point of storing fx_rate: a euro order must not be added to a
    // dollar one as though 1 EUR were 1 USD.
    const p = po({ currency: "EUR", fx_rate: 1.1, items: [line({ qty: 10, unit_price: 5 })], tax: 10 });
    expect(poSubtotal(p)).toBeCloseTo(55);
    expect(poTotal(p)).toBeCloseTo(66);
  });

  it("sums quantity across every line", () => {
    expect(poQty(po({ items: [line({ qty: 3 }), line({ qty: 4 })] }))).toBe(7);
  });

  it("treats an order with no lines as zero, not as broken", () => {
    expect(poSubtotal(po({ items: [] }))).toBe(0);
    expect(poQty(po({ items: undefined }))).toBe(0);
  });
});

describe("delay and delivery timing", () => {
  it("measures a delivered order against the day it actually landed", () => {
    const p = po({ expected_arrival: "2026-06-01", actual_arrival: "2026-06-06", status: "received" });
    expect(poDelayDays(p, TODAY)).toBe(5);
    expect(isDelayed(p, TODAY)).toBe(true);
  });

  it("measures an undelivered order against today, so the delay keeps growing", () => {
    const p = po({ expected_arrival: "2026-06-01", actual_arrival: null });
    expect(poDelayDays(p, "2026-06-15")).toBe(14);
    expect(poDelayDays(p, "2026-06-20")).toBe(19);
  });

  it("reports zero for an early or on-time arrival, never a negative delay", () => {
    expect(poDelayDays(po({ expected_arrival: "2026-06-10", actual_arrival: "2026-06-05" }), TODAY)).toBe(0);
    expect(poDelayDays(po({ expected_arrival: "2026-06-10", actual_arrival: "2026-06-10" }), TODAY)).toBe(0);
  });

  it("never calls a cancelled order late — nobody is waiting for it", () => {
    const p = po({ expected_arrival: "2026-01-01", status: "cancelled" });
    expect(poDelayDays(p, TODAY)).toBe(0);
    expect(isDelayed(p, TODAY)).toBe(false);
  });

  it("cannot be late without a promised date", () => {
    expect(poDelayDays(po({ expected_arrival: null }), TODAY)).toBe(0);
  });

  it("counts days remaining, negative once the date has passed", () => {
    expect(poDaysRemaining(po({ expected_arrival: "2026-06-20" }), TODAY)).toBe(5);
    expect(poDaysRemaining(po({ expected_arrival: "2026-06-10" }), TODAY)).toBe(-5);
    expect(poDaysRemaining(po({ expected_arrival: null }), TODAY)).toBeNull();
  });

  it("has no lead time until the goods actually arrive", () => {
    // Counting an outstanding order as zero days would flatter every supplier
    // still holding your money.
    expect(poLeadTime(po({ actual_arrival: null }))).toBeNull();
    expect(poLeadTime(po({ order_date: "2026-05-01", actual_arrival: "2026-05-21" }))).toBe(20);
  });

  it("counts an early arrival as on time", () => {
    expect(arrivedOnTime(po({ expected_arrival: "2026-06-10", actual_arrival: "2026-06-08" }))).toBe(true);
    expect(arrivedOnTime(po({ expected_arrival: "2026-06-10", actual_arrival: "2026-06-11" }))).toBe(false);
  });
});

describe("deliveryState", () => {
  it("ranks lateness above being in transit", () => {
    // A late shipment is still in transit; the lateness is the actionable half.
    const p = po({ status: "in_transit", expected_arrival: "2026-06-01" });
    expect(deliveryState(p, TODAY)).toBe("delayed");
  });

  it("marks a late arrival delayed even after it lands", () => {
    expect(deliveryState(po({ status: "received", expected_arrival: "2026-06-01", actual_arrival: "2026-06-09" }), TODAY))
      .toBe("delayed");
  });

  it("marks an on-time arrival received", () => {
    expect(deliveryState(po({ status: "received", expected_arrival: "2026-06-10", actual_arrival: "2026-06-09" }), TODAY))
      .toBe("received");
  });

  it("flags an order due inside the window as due soon", () => {
    expect(deliveryState(po({ status: "confirmed", expected_arrival: "2026-06-18" }), TODAY)).toBe("due_soon");
    expect(deliveryState(po({ status: "confirmed", expected_arrival: "2026-07-30" }), TODAY)).toBe("open");
  });

  it("keeps cancelled out of every other state", () => {
    expect(deliveryState(po({ status: "cancelled", expected_arrival: "2026-01-01" }), TODAY)).toBe("cancelled");
  });
});

describe("computeKpis", () => {
  const suppliers = [supplier({ id: "s1", country_code: "PT" }), supplier({ id: "s2", name: "B", country_code: "CN" })];
  const orders = [
    po({ id: "a", supplier_id: "s1", status: "received", expected_arrival: "2026-05-20",
         actual_arrival: "2026-05-18", order_date: "2026-05-01", items: [line({ qty: 10, unit_price: 5 })] }),
    po({ id: "b", supplier_id: "s2", status: "received", expected_arrival: "2026-05-20",
         actual_arrival: "2026-05-30", order_date: "2026-05-01", items: [line({ qty: 2, unit_price: 100 })] }),
    po({ id: "c", supplier_id: "s1", status: "in_transit", expected_arrival: "2026-06-30",
         items: [line({ qty: 1, unit_price: 30 })] }),
    po({ id: "d", supplier_id: "s1", status: "cancelled", items: [line({ qty: 99, unit_price: 99 })] }),
  ];

  it("excludes cancelled orders from every total", () => {
    const k = computeKpis(orders, suppliers, TODAY);
    expect(k.orderCount).toBe(3);
    expect(k.totalValue).toBe(50 + 200 + 30);
    expect(k.totalQty).toBe(13);
  });

  it("counts suppliers and countries actually purchased from", () => {
    const k = computeKpis(orders, suppliers, TODAY);
    expect(k.supplierCount).toBe(2);
    expect(k.countryCount).toBe(2);
  });

  it("splits open orders into pending and in transit without double counting", () => {
    const k = computeKpis(orders, suppliers, TODAY);
    expect(k.inTransitOrders).toBe(1);
    expect(k.pendingOrders).toBe(0);
    expect(k.receivedOrders).toBe(2);
  });

  it("averages lead time over delivered orders only", () => {
    // 17 days and 29 days; the in-transit order contributes nothing.
    expect(computeKpis(orders, suppliers, TODAY).avgDeliveryDays).toBe(23);
  });

  it("computes on-time rate over orders that had a promised date", () => {
    expect(computeKpis(orders, suppliers, TODAY).onTimeRate).toBe(0.5);
  });

  it("does not let an order without a promised date count as on time", () => {
    // Otherwise a supplier improves its score by refusing to commit to dates.
    const k = computeKpis(
      [po({ status: "received", expected_arrival: null, actual_arrival: "2026-06-01" })],
      [supplier()], TODAY
    );
    expect(k.onTimeRate).toBeNull();
  });

  it("counts outstanding value as live orders not yet landed", () => {
    expect(computeKpis(orders, suppliers, TODAY).outstandingValue).toBe(30);
  });

  it("reports null averages rather than zero when there is nothing to average", () => {
    const k = computeKpis([], [], TODAY);
    expect(k.avgDeliveryDays).toBeNull();
    expect(k.onTimeRate).toBeNull();
    expect(k.totalValue).toBe(0);
  });
});

describe("growth", () => {
  it("computes period-over-period change", () => {
    expect(growth(150, 100)).toBeCloseTo(0.5);
    expect(growth(50, 100)).toBeCloseTo(-0.5);
  });
  it("returns null with no previous period rather than infinity", () => {
    // "No basis for comparison" is not "no change", and +Infinity% on a
    // first trading month is worse than printing nothing.
    expect(growth(100, 0)).toBeNull();
  });
});

describe("spendByMonth", () => {
  it("fills empty months with zero instead of dropping them", () => {
    const rows = spendByMonth(
      [po({ order_date: "2026-01-10", items: [line({ qty: 1, unit_price: 100 })] }),
       po({ order_date: "2026-03-10", items: [line({ qty: 1, unit_price: 50 })] })],
      "2026-01-01", "2026-03-31"
    );
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(rows.map((r) => r.value)).toEqual([100, 0, 50]);
  });

  it("ignores cancelled orders and anything outside the window", () => {
    const rows = spendByMonth(
      [po({ order_date: "2026-01-10", status: "cancelled", items: [line({ qty: 1, unit_price: 999 })] }),
       po({ order_date: "2025-12-10", items: [line({ qty: 1, unit_price: 999 })] })],
      "2026-01-01", "2026-02-28"
    );
    expect(rows.every((r) => r.value === 0)).toBe(true);
  });
});

describe("supplierPerformance", () => {
  const suppliers = [supplier({ id: "s1", name: "Reliable" }), supplier({ id: "s2", name: "Late" })];
  const orders = [
    po({ supplier_id: "s1", status: "received", order_date: "2026-05-01",
         expected_arrival: "2026-05-20", actual_arrival: "2026-05-15", items: [line({ qty: 10, unit_price: 10 })] }),
    po({ supplier_id: "s1", status: "received", order_date: "2026-04-01",
         expected_arrival: "2026-04-20", actual_arrival: "2026-04-18", items: [line({ qty: 10, unit_price: 10 })] }),
    po({ supplier_id: "s2", status: "received", order_date: "2026-05-01",
         expected_arrival: "2026-05-20", actual_arrival: "2026-06-10", items: [line({ qty: 5, unit_price: 10 })] }),
  ];

  it("scores a reliable supplier above a late one", () => {
    const perf = supplierPerformance(orders, suppliers, TODAY);
    const reliable = perf.find((p) => p.supplier.id === "s1")!;
    const late = perf.find((p) => p.supplier.id === "s2")!;
    expect(reliable.onTimeRate).toBe(1);
    expect(late.onTimeRate).toBe(0);
    expect(reliable.score).toBeGreaterThan(late.score);
  });

  it("weights average unit price by value, not by line count", () => {
    // 200 spent over 20 units.
    expect(supplierPerformance(orders, suppliers, TODAY).find((p) => p.supplier.id === "s1")!.avgUnitPrice).toBe(10);
  });

  it("computes share of total spend", () => {
    const perf = supplierPerformance(orders, suppliers, TODAY);
    expect(perf.find((p) => p.supplier.id === "s1")!.share).toBeCloseTo(200 / 250);
  });

  it("reports the latest purchase date and the next expected arrival", () => {
    const withOpen = [...orders, po({ supplier_id: "s1", status: "confirmed",
      order_date: "2026-06-01", expected_arrival: "2026-07-01", items: [line()] })];
    const p = supplierPerformance(withOpen, suppliers, TODAY).find((x) => x.supplier.id === "s1")!;
    expect(p.lastPurchase).toBe("2026-06-01");
    expect(p.nextArrival).toBe("2026-07-01");
  });

  it("keeps a supplier with no orders at zero rather than dropping them", () => {
    const perf = supplierPerformance([], suppliers, TODAY);
    expect(perf).toHaveLength(2);
    expect(perf[0].orders).toBe(0);
    expect(perf[0].onTimeRate).toBeNull();
  });
});

describe("scoreSupplier", () => {
  const base = {
    supplier: supplier(), orders: 0, value: 0, qty: 0, avgUnitPrice: null,
    avgDeliveryDays: null, onTimeRate: null, delayedOrders: 0, pendingOrders: 0,
    lastPurchase: null, nextArrival: null, share: 0,
  };

  it("stays within 0..100", () => {
    const perfect = scoreSupplier({ ...base, orders: 20, onTimeRate: 1, avgDeliveryDays: 0, share: 1 });
    const worst = scoreSupplier({ ...base, orders: 10, onTimeRate: 0, delayedOrders: 10, avgDeliveryDays: 90 });
    expect(perfect).toBeLessThanOrEqual(100);
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(perfect).toBeGreaterThan(worst);
  });

  it("weights reliability above size", () => {
    // A huge unreliable supplier must not outrank a small dependable one.
    const bigUnreliable = scoreSupplier({ ...base, orders: 50, onTimeRate: 0.2, delayedOrders: 40, share: 1, avgDeliveryDays: 40 });
    const smallReliable = scoreSupplier({ ...base, orders: 4, onTimeRate: 1, delayedOrders: 0, share: 0.02, avgDeliveryDays: 10 });
    expect(smallReliable).toBeGreaterThan(bigUnreliable);
  });
});

describe("groupings", () => {
  const suppliers = [supplier({ id: "s1", country_code: "PT" }), supplier({ id: "s2", country_code: "CN" })];
  const name = (c: string) => ({ PT: "Portugal", CN: "China" }[c] || c);

  it("groups spend by country and shares sum to one", () => {
    const rows = spendByCountry(
      [po({ supplier_id: "s1", items: [line({ qty: 1, unit_price: 300 })] }),
       po({ supplier_id: "s2", items: [line({ qty: 1, unit_price: 100 })] })],
      suppliers, name
    );
    expect(rows[0].label).toBe("Portugal");
    expect(rows[0].share).toBeCloseTo(0.75);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1);
  });

  it("splits a mixed order across categories instead of filing it whole", () => {
    const rows = spendByCategory([po({ items: [
      line({ category: "packaging", qty: 1, unit_price: 30 }),
      line({ category: "components", qty: 1, unit_price: 70 }),
    ] })]);
    expect(rows.map((r) => r.category)).toEqual(["components", "packaging"]);
    expect(rows.find((r) => r.category === "packaging")!.value).toBe(30);
  });

  it("merges the same product name typed with different capitals", () => {
    const rows = spendByProduct([
      po({ items: [line({ product_name: "Cement", qty: 10, unit_price: 5 })] }),
      po({ items: [line({ product_name: " cement ", qty: 10, unit_price: 5 })] }),
    ], suppliers);
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(20);
  });

  it("names the supplier that accounts for most of a product's value", () => {
    const rows = spendByProduct([
      po({ supplier_id: "s1", items: [line({ product_name: "Steel", qty: 1, unit_price: 10 })] }),
      po({ supplier_id: "s2", items: [line({ product_name: "Steel", qty: 1, unit_price: 900 })] }),
    ], [supplier({ id: "s1", name: "Small" }), supplier({ id: "s2", name: "Big" })]);
    expect(rows[0].mainSupplier).toBe("Big");
  });

  it("returns a bucket for every status, including empty ones", () => {
    const rows = statusBreakdown([po({ status: "draft" })]);
    expect(rows).toHaveLength(9);
    expect(rows.find((r) => r.status === "draft")!.count).toBe(1);
    expect(rows.find((r) => r.status === "received")!.count).toBe(0);
  });
});

describe("buildAlerts", () => {
  const suppliers = [supplier({ id: "s1" })];

  it("raises a high-severity alert for delayed orders with their value", () => {
    const a = buildAlerts(
      [po({ expected_arrival: "2026-06-01", items: [line({ qty: 1, unit_price: 500 })] })],
      suppliers, TODAY
    );
    const delayed = a.find((x) => x.kind === "delayed")!;
    expect(delayed.severity).toBe("high");
    expect(delayed.value).toBe(500);
  });

  it("warns about arrivals inside the window but not beyond it", () => {
    const a = buildAlerts(
      [po({ status: "in_transit", expected_arrival: "2026-06-17" }),
       po({ status: "in_transit", expected_arrival: "2026-07-17" })],
      suppliers, TODAY, { arrivingWithinDays: 3 }
    );
    expect(a.find((x) => x.kind === "arriving_soon")!.count).toBe(1);
  });

  it("flags orders sent but never confirmed, and not drafts", () => {
    const a = buildAlerts([po({ status: "sent" }), po({ status: "draft" })], suppliers, TODAY);
    expect(a.find((x) => x.kind === "unconfirmed")!.count).toBe(1);
  });

  it("does not brand a new supplier unreliable on one late delivery", () => {
    const a = buildAlerts(
      [po({ status: "received", expected_arrival: "2026-05-01", actual_arrival: "2026-05-20" })],
      suppliers, TODAY, { minOrdersToJudge: 3 }
    );
    expect(a.find((x) => x.kind === "supplier_underperforming")).toBeUndefined();
  });

  it("flags a supplier once there is enough evidence", () => {
    const late = () => po({ status: "received", expected_arrival: "2026-05-01", actual_arrival: "2026-05-20" });
    const a = buildAlerts([late(), late(), late()], suppliers, TODAY, { minOrdersToJudge: 3 });
    expect(a.find((x) => x.kind === "supplier_underperforming")?.label).toBe("Acme");
  });

  it("measures unusually large against this book of orders, not a fixed number", () => {
    const small = () => po({ status: "draft", expected_arrival: null, items: [line({ qty: 1, unit_price: 10 })] });
    const huge = po({ status: "draft", expected_arrival: null, items: [line({ qty: 1, unit_price: 1000 })] });
    const a = buildAlerts([small(), small(), small(), small(), huge], suppliers, TODAY);
    expect(a.find((x) => x.kind === "unusually_large")!.count).toBe(1);
  });

  it("stays quiet when there is nothing wrong", () => {
    const a = buildAlerts(
      [po({ status: "received", expected_arrival: "2026-05-01", actual_arrival: "2026-04-28" })],
      suppliers, TODAY
    );
    expect(a).toHaveLength(0);
  });

  it("sorts high severity first", () => {
    const a = buildAlerts(
      [po({ expected_arrival: "2026-06-01" }), po({ status: "sent", expected_arrival: "2026-12-01" })],
      suppliers, TODAY
    );
    expect(a[0].severity).toBe("high");
  });
});

describe("filterPurchaseOrders", () => {
  const suppliers = [supplier({ id: "s1", name: "Acme", country_code: "PT" }),
                     supplier({ id: "s2", name: "Beta", country_code: "CN" })];
  const orders = [
    po({ id: "a", po_number: "PO-1", supplier_id: "s1", buyer: "Ana", order_date: "2026-03-01",
         status: "received", payment_status: "paid", currency: "USD",
         items: [line({ product_name: "Cement", category: "raw_materials" })] }),
    po({ id: "b", po_number: "PO-2", supplier_id: "s2", buyer: "Bob", order_date: "2026-06-01",
         status: "in_transit", payment_status: "unpaid", currency: "EUR",
         items: [line({ product_name: "Screws", category: "components" })] }),
  ];
  const ids = (f: Parameters<typeof filterPurchaseOrders>[2]) =>
    filterPurchaseOrders(orders, suppliers, f).map((p) => p.id);

  it("filters by every field independently", () => {
    expect(ids({ supplierId: "s1" })).toEqual(["a"]);
    expect(ids({ countryCode: "CN" })).toEqual(["b"]);
    expect(ids({ status: "in_transit" })).toEqual(["b"]);
    expect(ids({ paymentStatus: "paid" })).toEqual(["a"]);
    expect(ids({ currency: "EUR" })).toEqual(["b"]);
    expect(ids({ buyer: "Ana" })).toEqual(["a"]);
    expect(ids({ category: "components" })).toEqual(["b"]);
  });

  it("bounds by date range inclusively", () => {
    expect(ids({ from: "2026-03-01", to: "2026-03-01" })).toEqual(["a"]);
    expect(ids({ from: "2026-04-01" })).toEqual(["b"]);
  });

  it("searches across number, supplier, buyer and product name", () => {
    expect(ids({ q: "PO-2" })).toEqual(["b"]);
    expect(ids({ q: "acme" })).toEqual(["a"]);
    expect(ids({ q: "screws" })).toEqual(["b"]);
    expect(ids({ q: "bob" })).toEqual(["b"]);
  });

  it("combines filters as AND, and returns everything when empty", () => {
    expect(ids({ supplierId: "s1", status: "in_transit" })).toEqual([]);
    expect(ids({})).toEqual(["a", "b"]);
  });
});

/* ------------------------- landed cost ------------------------- */

describe("landedCosts", () => {
  it("returns the bare purchase price when there are no header costs", () => {
    const order = po({ tax: 0, shipping: 0, discount: 0, fx_rate: 1,
      items: [line({ qty: 10, unit_price: 5 })] });
    const [l] = landedCosts(order);
    expect(l.landedUnitCost).toBeCloseTo(5);
    expect(l.landedTotal).toBeCloseTo(50);
  });

  it("adds tax and shipping, and subtracts a discount", () => {
    // 10 x $5 = $50 of goods, plus $10 tax + $20 freight - $5 discount = $25
    // of overhead on one line -> $2.50 per unit on top.
    const order = po({ tax: 10, shipping: 20, discount: 5, fx_rate: 1,
      items: [line({ qty: 10, unit_price: 5 })] });
    expect(landedCosts(order)[0].landedUnitCost).toBeCloseTo(7.5);
  });

  it("splits header costs by VALUE, so freight does not crush a cheap line", () => {
    // A $2000 machine and a $5 cable share $100 of freight. Per-unit
    // splitting would put $50 on the cable and report it sold at a loss.
    const order = po({ tax: 0, shipping: 100, discount: 0, fx_rate: 1, items: [
      line({ id: "big", qty: 1, unit_price: 2000 }),
      line({ id: "small", qty: 1, unit_price: 5 }),
    ] });
    const [big, small] = landedCosts(order);
    expect(big.landedUnitCost).toBeCloseTo(2000 + 100 * (2000 / 2005), 2);
    expect(small.landedUnitCost).toBeCloseTo(5 + 100 * (5 / 2005), 2);
    // The cable stays close to its own price rather than absorbing the ship.
    expect(small.landedUnitCost).toBeLessThan(6);
  });

  it("converts to base currency at the order's captured rate", () => {
    const order = po({ tax: 0, shipping: 0, discount: 0, fx_rate: 0.5,
      items: [line({ qty: 2, unit_price: 100 })] });
    expect(landedCosts(order)[0].landedUnitCost).toBeCloseTo(50);
  });

  it("splits equally when the goods were free but freight was not", () => {
    const order = po({ tax: 0, shipping: 60, discount: 0, fx_rate: 1, items: [
      line({ id: "a", qty: 1, unit_price: 0 }),
      line({ id: "b", qty: 2, unit_price: 0 }),
    ] });
    const [a, b] = landedCosts(order);
    expect(a.landedUnitCost).toBeCloseTo(30);   // $30 over 1 unit
    expect(b.landedUnitCost).toBeCloseTo(15);   // $30 over 2 units
  });

  it("never returns a negative cost when a discount exceeds the goods", () => {
    // A cost below zero would report margin above 100% and corrupt every
    // aggregate built on it.
    const order = po({ tax: 0, shipping: 0, discount: 500, fx_rate: 1,
      items: [line({ qty: 1, unit_price: 10 })] });
    expect(landedCosts(order)[0].landedUnitCost).toBe(0);
  });

  it("preserves line order and identity", () => {
    const order = po({ items: [line({ id: "x" }), line({ id: "y" })] });
    expect(landedCosts(order).map((l) => l.itemId)).toEqual(["x", "y"]);
  });

  it("is empty for an order with no lines", () => {
    expect(landedCosts(po({ items: [] }))).toEqual([]);
  });
});

describe("isResaleLine", () => {
  it("is true only for goods bought to sell on", () => {
    expect(isResaleLine(line({ category: "goods_for_resale" }))).toBe(true);
    // An office chair is a real purchase that must never reach the catalog.
    expect(isResaleLine(line({ category: "office" }))).toBe(false);
    expect(isResaleLine(line({ category: "services" }))).toBe(false);
  });
});

describe("parseSizes", () => {
  it("splits a comma list into a product's size array", () => {
    expect(parseSizes("S, M, L, XL")).toEqual(["S", "M", "L", "XL"]);
  });

  it("accepts slashes and newlines, which is what suppliers actually send", () => {
    expect(parseSizes("S/M/L")).toEqual(["S", "M", "L"]);
    expect(parseSizes("38\n39\n40")).toEqual(["38", "39", "40"]);
  });

  it("keeps the order given, because size order is meaningful", () => {
    // Sorting would put L before M before S and scramble the run.
    expect(parseSizes("XS, S, M, L, XL")).toEqual(["XS", "S", "M", "L", "XL"]);
  });

  it("drops blanks and stray separators", () => {
    expect(parseSizes("S,, M , ,L,")).toEqual(["S", "M", "L"]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(parseSizes("S, s, M")).toEqual(["S", "M"]);
  });

  it("is empty for nothing at all", () => {
    expect(parseSizes("")).toEqual([]);
    expect(parseSizes(null)).toEqual([]);
    expect(parseSizes(undefined)).toEqual([]);
    expect(parseSizes("  ,  ")).toEqual([]);
  });
});
