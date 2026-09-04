import type {
  Category, Order, OrderStatus, Product, Seller,
} from "@/lib/types";
import { storeDay } from "./tz";

/* ===========================================================================
 * sales.ts — every number on the sales management dashboard.
 *
 * Pure functions over plain arrays: no Supabase, no React, no Date.now()
 * hidden inside a formula (today is always passed in). That is what makes
 * all of it testable, and what stops two panels quietly disagreeing about
 * the same money.
 *
 * THREE RULES, stated once here and applied everywhere below.
 *
 * 1. REVENUE RECOGNITION.
 *    Net sales = line revenue (unit price x qty) of orders that are NOT
 *    cancelled. Two deliberate exclusions:
 *      - the delivery fee, which is a pass-through to whoever delivers, not
 *        merchandise the store sold. Including it inflates both revenue and
 *        margin, and makes "average order value" a function of geography.
 *      - cancelled orders, entirely. A cancelled order is not a discount or
 *        a return, it is a sale that did not happen.
 *    `deliveredRevenue` is the stricter completed-only figure, reported
 *    beside it, because "sold" and "collected" are different questions and a
 *    dashboard that answers only one of them hides the backlog.
 *
 * 2. UNKNOWN COST IS NULL, NEVER ZERO.
 *    Cost lives in product_costs and is optional. A missing cost makes that
 *    line's profit and margin null; nulls are skipped in aggregates, and
 *    every aggregate carries `costCoverage` -- the share of its revenue that
 *    had a known cost. Treating unknown cost as zero would report 100%
 *    margin on everything, which is not a cautious estimate, it is a wrong
 *    answer that looks like a great quarter.
 *
 * 3. TWO MAPPINGS FROM THE SPEC ONTO THIS BUSINESS.
 *    - "Sales representative" -> the SELLER whose product sold. This is a
 *      marketplace: nobody is assigned an account, the seller is the party
 *      whose performance is actually being measured.
 *    - "Country" -> the MUNICIPALITY the order ships to. The store sells
 *      inside Timor-Leste, so a country column would read "Timor-Leste"
 *      on every row and answer nothing; municipality is the same question
 *      at the resolution where it has an answer.
 * ======================================================================== */

/** Statuses that are not cancelled -- the ones that count as sales. */
export const LIVE_STATUSES: readonly OrderStatus[] = [
  "new", "confirmed", "preparing", "out", "arrived", "completed",
];

/** In flow order, so status panels read as a pipeline rather than an
 * alphabetical list. Mirrors utils.FLOW plus the two terminal states. */
export const SALES_STATUSES: readonly OrderStatus[] = [
  "new", "confirmed", "preparing", "out", "arrived", "completed", "cancelled",
];

/** Not yet delivered and not cancelled: the backlog (spec section 13). */
export const PENDING_STATUSES: readonly OrderStatus[] = [
  "new", "confirmed", "preparing", "out",
];

const DAY_MS = 86_400_000;

/** Today in the SHOP's timezone.
 *
 * This used to read the server's own clock, which meant the answer changed
 * with the hosting region and was wrong for Dili on every UTC host -- a
 * sale at 7am local was filed under the previous day. See lib/tz.ts. */
export function todayIso(now: Date = new Date()): string {
  return storeDay(now);
}

/** Whole days from `a` to `b`, both YYYY-MM-DD. Negative when b precedes a. */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / DAY_MS);
}

/** The calendar day an order was placed, as YYYY-MM-DD. */
export function orderDate(o: Order): string {
  return storeDay(new Date(o.created_at));
}

/* ---------------------------------------------------------------------------
 * The flattened line. Sections 2, 5, 6, 7, 9, 10, 16 and 22 of the spec are
 * all the same operation -- group these by one column and sum. Flattening
 * once, here, is what stops eight panels each re-deriving revenue slightly
 * differently.
 * ------------------------------------------------------------------------ */

export interface SalesLine {
  orderId: string;
  ref: string;
  /** Order date, YYYY-MM-DD. */
  date: string;
  createdAt: string;

  customerPhone: string;
  customerName: string;
  municipality: string;

  sellerId: string | null;
  sellerName: string;

  productId: string;
  productName: string;
  categoryId: string | null;
  categoryName: string;

  qty: number;
  /** What the buyer actually paid per unit. */
  unitPrice: number;
  /** Undiscounted list price at the time we can best reconstruct it. */
  listPrice: number;
  /** (listPrice - unitPrice) * qty. Zero when nothing was discounted. */
  discount: number;
  /** unitPrice * qty. The spec's "Net Sales Value". */
  netSales: number;

  unitCost: number | null;
  cost: number | null;
  grossProfit: number | null;
  /** 0..1, or null when cost is unknown. */
  margin: number | null;

  status: OrderStatus;
  payStatus: string;
  payMethod: string;

  expectedDelivery: string | null;
  deliveredAt: string | null;
  invoicedAt: string | null;
}

export interface LineSources {
  products: Product[];
  categories: Category[];
  sellers: Seller[];
  /** product_id -> unit cost. Absent id means "cost unknown". */
  costs: Map<string, number>;
  /** Units handed back, keyed by returnKey(orderId, productId).
   *
   * Netted off the line here rather than subtracted from each metric
   * downstream: quantity, net sales, discount, cost, gross profit and margin
   * all derive from the same two numbers, so correcting them once at the
   * source corrects every figure on the dashboard at once. Optional, so a
   * store that has not run supabase/returns.sql reads exactly as before. */
  returns?: Map<string, number>;
}

/** How many of each line an order may still have returned.
 *
 * Pure, and shared by the action that records a return and the form that
 * offers one, so the button cannot offer a quantity the action will refuse.
 * Counts what has ALREADY come back, so two returns of two out of three
 * cannot become four. */
export function returnableQty(
  ordered: Array<{ product_id: string; qty: number }>,
  alreadyReturned: Map<string, number>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of ordered) {
    if (!item.product_id) continue;
    const sold = (out.get(item.product_id) || 0) + (Number(item.qty) || 0);
    out.set(item.product_id, sold);
  }
  for (const [productId, sold] of out) {
    out.set(productId, Math.max(0, sold - (alreadyReturned.get(productId) || 0)));
  }
  return out;
}

/** The key both sides of the returns netting agree on. Exported so the
 * caller building the map cannot disagree with the reader using it. */
export function returnKey(orderId: string, productId: string): string {
  return orderId + "\u0000" + productId;
}

/** Flatten every order into one row per line item.
 *
 * The order's own `items` snapshot is authoritative for name, price and qty
 * -- it is what the buyer was actually charged, and it survives the product
 * later being renamed, repriced, archived or deleted. The live product row
 * is consulted only for things the snapshot never carried: category, and the
 * list price used to reconstruct the discount. */
export function buildSalesLines(orders: Order[], src: LineSources): SalesLine[] {
  const productById = new Map(src.products.map((p) => [p.id, p]));
  const categoryById = new Map(src.categories.map((c) => [c.id, c]));
  const sellerById = new Map(src.sellers.map((s) => [s.id, s]));

  const lines: SalesLine[] = [];
  for (const o of orders) {
    const date = orderDate(o);
    for (const item of o.items || []) {
      const product = productById.get(item.product_id);
      const category = product?.category_id ? categoryById.get(product.category_id) : undefined;
      const seller = item.seller_id ? sellerById.get(item.seller_id) : undefined;

      const soldQty = Number(item.qty) || 0;
      const unitPrice = Number(item.price) || 0;

      // Goods handed back were never really sold. Floored at zero rather
      // than trusted: a return larger than the order is a data error, and
      // it must not turn into negative revenue that quietly cancels out a
      // real sale somewhere else in the total.
      const returned = Math.min(
        soldQty, Math.max(0, src.returns?.get(returnKey(o.id, item.product_id)) ?? 0));
      const qty = soldQty - returned;

      // The line snapshot has no list price of its own. The product's
      // current `price` is the best available reconstruction -- and it is
      // exact for the ordinary case, a discount_price sale where `price`
      // never moved. Guarded with max() so a later price CUT can never
      // manufacture a negative discount out of an old order.
      const listPrice = Math.max(unitPrice, Number(product?.price) || unitPrice);

      // The snapshot taken at checkout wins: it is what these goods actually
      // cost when they were sold, and it keeps last year's margin from
      // moving when a supplier price changes today. The live cost is the
      // fallback, so orders placed before costs were ever recorded still
      // report something instead of leaving the whole page blank.
      const unitCost = item.cost != null
        ? Number(item.cost)
        : src.costs.has(item.product_id)
          ? Number(src.costs.get(item.product_id))
          : null;

      const netSales = unitPrice * qty;
      const cost = unitCost == null ? null : unitCost * qty;
      const grossProfit = cost == null ? null : netSales - cost;

      lines.push({
        orderId: o.id,
        ref: o.ref,
        date,
        createdAt: o.created_at,
        customerPhone: (o.buyer_phone || "").trim(),
        customerName: o.buyer_name || "",
        municipality: (o.municipality || "").trim() || (o.mode === "pickup" ? "Pickup" : ""),
        sellerId: item.seller_id ?? null,
        sellerName: seller?.store_name || "",
        productId: item.product_id,
        productName: item.name,
        categoryId: product?.category_id ?? null,
        categoryName: category?.name || "",
        qty,
        unitPrice,
        listPrice,
        discount: (listPrice - unitPrice) * qty,
        netSales,
        unitCost,
        cost,
        grossProfit,
        margin: grossProfit == null || netSales === 0 ? null : grossProfit / netSales,
        status: o.status,
        payStatus: o.pay_status,
        payMethod: o.pay_method,
        expectedDelivery: o.expected_delivery ?? null,
        deliveredAt: o.delivered_at ?? null,
        invoicedAt: o.invoiced_at ?? null,
      });
    }
  }
  return lines;
}

export function isCancelled(l: SalesLine): boolean { return l.status === "cancelled"; }
export function isLive(l: SalesLine): boolean { return l.status !== "cancelled"; }
export function isDelivered(l: SalesLine): boolean {
  return l.status === "arrived" || l.status === "completed";
}
export function isPending(l: SalesLine): boolean {
  return (PENDING_STATUSES as readonly string[]).includes(l.status);
}

/* ---------------------------------------------------------------------------
 * Aggregation. Every group-by in the dashboard funnels through one totals
 * accumulator, so "revenue" means exactly the same thing in all of them.
 * ------------------------------------------------------------------------ */

export interface Totals {
  revenue: number;
  qty: number;
  orders: number;
  discount: number;
  /** Sum of cost over lines that HAVE a cost. */
  cost: number;
  /** revenue - cost, over those same lines only. Null when none had a cost. */
  grossProfit: number | null;
  /** grossProfit / (revenue of costed lines). Null when nothing was costed. */
  margin: number | null;
  /** 0..1 -- share of revenue whose cost is known. 1 means the margin above
   * covers everything; 0.4 means it describes 40% of the business and the UI
   * should say so rather than present it as the whole picture. */
  costCoverage: number;
}

export function emptyTotals(): Totals {
  return {
    revenue: 0, qty: 0, orders: 0, discount: 0,
    cost: 0, grossProfit: null, margin: null, costCoverage: 0,
  };
}

/** Totals over the non-cancelled lines of `lines`. Cancelled lines are
 * dropped here, once, rather than at forty call sites. */
export function totals(lines: SalesLine[]): Totals {
  const live = lines.filter(isLive);
  let revenue = 0, qty = 0, discount = 0, cost = 0, costedRevenue = 0;
  let anyCost = false;
  const orderIds = new Set<string>();

  for (const l of live) {
    revenue += l.netSales;
    qty += l.qty;
    discount += l.discount;
    orderIds.add(l.orderId);
    if (l.cost != null) {
      cost += l.cost;
      costedRevenue += l.netSales;
      anyCost = true;
    }
  }

  const grossProfit = anyCost ? costedRevenue - cost : null;
  return {
    revenue, qty, orders: orderIds.size, discount, cost,
    grossProfit,
    margin: grossProfit != null && costedRevenue > 0 ? grossProfit / costedRevenue : null,
    costCoverage: revenue > 0 ? costedRevenue / revenue : 0,
  };
}

/** Percentage change, or null when there is no previous period to compare
 * against. Null rather than 0 or Infinity: "we had no sales last March" is
 * not "0% growth", and a dashboard that prints +Infinity has lied. */
export function growth(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

/* ---------------------------------------------------------------------------
 * Section 1 -- headline KPIs.
 * ------------------------------------------------------------------------ */

export interface SalesKpis extends Totals {
  /** Completed only -- money actually realised. */
  deliveredRevenue: number;
  avgOrderValue: number;
  /** Units per order. */
  unitsPerOrder: number;
  customers: number;
  /** Bought at least once within `activeWindowDays`. */
  activeCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  pendingOrders: number;
  pendingValue: number;
  deliveredOrders: number;
  cancelledOrders: number;
  cancelledValue: number;
  /** 0..1 of all orders including cancelled. */
  cancellationRate: number;
  /** Orders past their promised delivery date and still undelivered. */
  delayedOrders: number;
  /** Mean days from order to delivery, over delivered orders that have both
   * dates. Null when nothing has been delivered with dates recorded. */
  avgFulfilmentDays: number | null;
  /** Delivered on or before the promised date, over those that promised one. */
  onTimeRate: number | null;
}

export interface KpiOptions {
  today: string;
  activeWindowDays?: number;
  /** Lines from BEFORE the reporting window, used only to tell a first-time
   * buyer from a returning one. Without it every customer in the window
   * looks new. */
  priorLines?: SalesLine[];
}

export function computeSalesKpis(lines: SalesLine[], opts: KpiOptions): SalesKpis {
  const { today, activeWindowDays = 90, priorLines = [] } = opts;
  const base = totals(lines);
  const live = lines.filter(isLive);

  const byOrder = groupOrders(lines);
  const liveOrders = byOrder.filter((o) => o.status !== "cancelled");
  const cancelledOrders = byOrder.filter((o) => o.status === "cancelled");

  const deliveredRevenue = live
    .filter((l) => l.status === "completed")
    .reduce((a, l) => a + l.netSales, 0);

  const pending = liveOrders.filter((o) => (PENDING_STATUSES as readonly string[]).includes(o.status));
  const delivered = liveOrders.filter((o) => o.status === "arrived" || o.status === "completed");

  const customerSet = new Set(live.map((l) => l.customerPhone).filter(Boolean));
  const priorCustomers = new Set(priorLines.filter(isLive).map((l) => l.customerPhone).filter(Boolean));
  let newCustomers = 0;
  for (const c of customerSet) if (!priorCustomers.has(c)) newCustomers++;

  const activeCutoff = shiftIso(today, -activeWindowDays);
  const activeCustomers = new Set(
    live.filter((l) => l.date >= activeCutoff).map((l) => l.customerPhone).filter(Boolean)
  ).size;

  // Fulfilment speed and punctuality, over orders that carry the dates they
  // need. An order with no promised date is not late and not on time -- it
  // is simply not part of this measurement.
  const fulfilmentDays: number[] = [];
  let promised = 0, onTime = 0, delayed = 0;
  for (const o of liveOrders) {
    if (o.deliveredAt && o.date) fulfilmentDays.push(daysBetween(o.date, o.deliveredAt));
    if (!o.expectedDelivery) continue;
    promised++;
    if (o.deliveredAt) {
      if (daysBetween(o.expectedDelivery, o.deliveredAt) <= 0) onTime++;
    } else if (daysBetween(o.expectedDelivery, today) > 0) {
      delayed++;
    }
  }

  return {
    ...base,
    deliveredRevenue,
    avgOrderValue: base.orders ? base.revenue / base.orders : 0,
    unitsPerOrder: base.orders ? base.qty / base.orders : 0,
    customers: customerSet.size,
    activeCustomers,
    newCustomers,
    returningCustomers: customerSet.size - newCustomers,
    pendingOrders: pending.length,
    pendingValue: pending.reduce((a, o) => a + o.revenue, 0),
    deliveredOrders: delivered.length,
    cancelledOrders: cancelledOrders.length,
    cancelledValue: cancelledOrders.reduce((a, o) => a + o.revenue, 0),
    cancellationRate: byOrder.length ? cancelledOrders.length / byOrder.length : 0,
    delayedOrders: delayed,
    avgFulfilmentDays: fulfilmentDays.length
      ? fulfilmentDays.reduce((a, n) => a + n, 0) / fulfilmentDays.length
      : null,
    onTimeRate: promised ? onTime / promised : null,
  };
}

/** Shift a YYYY-MM-DD date by whole days. */
export function shiftIso(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z");
  if (!Number.isFinite(t)) return iso;
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------------
 * Order-level rollup. Some questions ("how many orders are late") are about
 * orders, not lines, and summing lines would count a three-line order three
 * times.
 * ------------------------------------------------------------------------ */

export interface OrderRollup {
  orderId: string;
  ref: string;
  date: string;
  customerPhone: string;
  customerName: string;
  municipality: string;
  status: OrderStatus;
  payStatus: string;
  payMethod: string;
  revenue: number;
  qty: number;
  cost: number | null;
  grossProfit: number | null;
  margin: number | null;
  expectedDelivery: string | null;
  deliveredAt: string | null;
  invoicedAt: string | null;
  lines: SalesLine[];
}

export function groupOrders(lines: SalesLine[]): OrderRollup[] {
  const map = new Map<string, OrderRollup>();
  for (const l of lines) {
    let r = map.get(l.orderId);
    if (!r) {
      r = {
        orderId: l.orderId, ref: l.ref, date: l.date,
        customerPhone: l.customerPhone, customerName: l.customerName,
        municipality: l.municipality, status: l.status,
        payStatus: l.payStatus, payMethod: l.payMethod,
        revenue: 0, qty: 0, cost: null, grossProfit: null, margin: null,
        expectedDelivery: l.expectedDelivery, deliveredAt: l.deliveredAt,
        invoicedAt: l.invoicedAt, lines: [],
      };
      map.set(l.orderId, r);
    }
    r.revenue += l.netSales;
    r.qty += l.qty;
    if (l.cost != null) r.cost = (r.cost ?? 0) + l.cost;
    r.lines.push(l);
  }
  // Profit per order is computed only over its costed lines, and the margin
  // is stated against that same subset -- mixing a costed and an uncosted
  // line inside one order otherwise reports a margin that is neither.
  for (const r of map.values()) {
    if (r.cost != null) {
      const costedRevenue = r.lines
        .filter((l) => l.cost != null)
        .reduce((a, l) => a + l.netSales, 0);
      r.grossProfit = costedRevenue - r.cost;
      r.margin = costedRevenue > 0 ? r.grossProfit / costedRevenue : null;
    }
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Days an order is late: measured to the actual delivery once it has
 * arrived (final), and to today while it has not (grows every day it stays
 * open). 0 when on time, null when no date was ever promised -- never 0 for
 * "unknown", which would silently count unpromised orders as punctual. */
export function deliveryDelayDays(o: OrderRollup, today: string): number | null {
  if (!o.expectedDelivery) return null;
  if (o.status === "cancelled") return null;
  const end = o.deliveredAt || today;
  return Math.max(0, daysBetween(o.expectedDelivery, end));
}

export type DeliveryState = "delivered_on_time" | "delivered_late" | "due" | "delayed" | "no_date" | "cancelled";

export function deliveryState(o: OrderRollup, today: string): DeliveryState {
  if (o.status === "cancelled") return "cancelled";
  if (!o.expectedDelivery) return o.deliveredAt ? "delivered_on_time" : "no_date";
  if (o.deliveredAt) {
    return daysBetween(o.expectedDelivery, o.deliveredAt) <= 0
      ? "delivered_on_time" : "delivered_late";
  }
  return daysBetween(o.expectedDelivery, today) > 0 ? "delayed" : "due";
}

/* ---------------------------------------------------------------------------
 * Sections 3, 15, 16, 17 -- time series.
 * ------------------------------------------------------------------------ */

export interface PeriodTotals extends Totals {
  /** "2026-08", "2026-Q3", "2026" or "2026-08-14". */
  key: string;
  label: string;
  customers: number;
  avgOrderValue: number;
}

function periodTotals(lines: SalesLine[], key: string, label: string): PeriodTotals {
  const t = totals(lines);
  return {
    ...t, key, label,
    customers: new Set(lines.filter(isLive).map((l) => l.customerPhone).filter(Boolean)).size,
    avgOrderValue: t.orders ? t.revenue / t.orders : 0,
  };
}

/** Month keys are the first 7 characters of the date, which is why the whole
 * module keeps dates as YYYY-MM-DD text: no Date objects, no time zones, and
 * grouping is a substring. */
export function salesByMonth(lines: SalesLine[], months: string[]): PeriodTotals[] {
  const byKey = new Map<string, SalesLine[]>();
  for (const l of lines) {
    const k = l.date.slice(0, 7);
    const arr = byKey.get(k); if (arr) arr.push(l); else byKey.set(k, [l]);
  }
  return months.map((m) => periodTotals(byKey.get(m) || [], m, m.slice(5) + "/" + m.slice(2, 4)));
}

export function monthKeys(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

export function salesByQuarter(lines: SalesLine[], year: number): PeriodTotals[] {
  return [0, 1, 2, 3].map((q) => {
    const inQ = lines.filter((l) => {
      if (l.date.slice(0, 4) !== String(year)) return false;
      const m = Number(l.date.slice(5, 7));
      return m >= q * 3 + 1 && m <= q * 3 + 3;
    });
    return periodTotals(inQ, `${year}-Q${q + 1}`, `Q${q + 1}`);
  });
}

export function salesByYear(lines: SalesLine[]): PeriodTotals[] {
  const years = [...new Set(lines.map((l) => l.date.slice(0, 4)).filter(Boolean))].sort();
  return years.map((y) => periodTotals(lines.filter((l) => l.date.startsWith(y)), y, y));
}

/** The Monday on or before `iso`. ISO-8601 weeks start on Monday, and
 * anchoring a week to a real date (rather than a week NUMBER) keeps the
 * whole module on plain YYYY-MM-DD text and sidesteps the year-boundary
 * trap where 2026-01-01 belongs to week 53 of 2025. */
export function weekStart(iso: string): string {
  const t = Date.parse(iso + "T00:00:00Z");
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  // getUTCDay(): 0 = Sunday. Sunday belongs to the week that began six days
  // earlier, not to the one starting tomorrow.
  const back = (d.getUTCDay() + 6) % 7;
  return shiftIso(iso, -back);
}

/* ---------------------------------------------------------------------------
 * Period presets
 *
 * The filters take a from and a to date, which is complete but is not the
 * question anyone actually asks. "How did this month go" should be one
 * click, not two date pickers and a mental note of what today is.
 *
 * Every preset is a whole calendar period, so two people reading the same
 * screen mean the same thing by it. Nothing here is a rolling window: "the
 * last 30 days" and "this month" differ by an amount that changes daily,
 * and a figure whose span moves under you cannot be compared to itself.
 * ------------------------------------------------------------------------ */

export type PeriodPreset =
  | "today" | "week" | "month" | "lastMonth" | "quarter" | "year";

export const PERIOD_PRESETS: PeriodPreset[] = [
  "today", "week", "month", "lastMonth", "quarter", "year",
];

/** First day of the month `iso` falls in, shifted by `months`. */
function monthStart(iso: string, months = 0): string {
  const year = Number(iso.slice(0, 4));
  const monthIndex = Number(iso.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Last day of the month `iso` falls in. Derived by stepping back one day
 * from the next month's first, so February and leap years need no table. */
function monthEnd(iso: string): string {
  return shiftIso(monthStart(iso, 1), -1);
}

/** The from/to a preset means, given what today is.
 *
 * Every range ends today rather than at the end of the period: a month that
 * has not finished should not report itself as a full month of trading, and
 * "this year" including December would flatter every average. The one
 * exception is last month, which is over. */
export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: weekStart(today), to: today };
    case "month":
      return { from: monthStart(today), to: today };
    case "lastMonth": {
      const start = monthStart(today, -1);
      return { from: start, to: monthEnd(start) };
    }
    case "quarter": {
      const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
      return { from: `${today.slice(0, 4)}-${String(q * 3 + 1).padStart(2, "0")}-01`, to: today };
    }
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Which preset the current filter matches, or null for a hand-picked range.
 * Lets the chip row show what is actually selected instead of guessing. */
export function activePreset(
  from: string | undefined, to: string | undefined, today: string
): PeriodPreset | null {
  if (!from || !to) return null;
  for (const p of PERIOD_PRESETS) {
    const r = presetRange(p, today);
    if (r.from === from && r.to === to) return p;
  }
  return null;
}

/** The last `count` whole weeks ending with the week containing `today`,
 * oldest first -- empty weeks included, because a week with no sales is a
 * finding rather than a gap to skip.
 *
 * Weekly rather than daily on the dashboard: a day is too fine a grain for a
 * shop of this size, where most days are zero and the chart reads as noise
 * with a few spikes. The daily view still exists on the statistics page for
 * anyone who wants it. */
export function salesByWeek(
  lines: SalesLine[], today: string, count = 12
): PeriodTotals[] {
  const byWeek = new Map<string, SalesLine[]>();
  for (const l of lines) {
    if (!l.date) continue;
    const k = weekStart(l.date);
    const arr = byWeek.get(k); if (arr) arr.push(l); else byWeek.set(k, [l]);
  }

  const current = weekStart(today);
  const out: PeriodTotals[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = shiftIso(current, -i * 7);
    // Labelled by the day the week begins ("14/06"), which is what a manager
    // actually says out loud -- "week of the 14th" -- unlike "W24".
    out.push(periodTotals(byWeek.get(start) || [], start, start.slice(8) + "/" + start.slice(5, 7)));
  }
  return out;
}

/** The last `count` days ending at `today`, oldest first -- including days
 * with no sales, because a gap in the series is itself the finding. */
export function salesByDay(lines: SalesLine[], today: string, count = 30): PeriodTotals[] {
  const byKey = new Map<string, SalesLine[]>();
  for (const l of lines) {
    const arr = byKey.get(l.date); if (arr) arr.push(l); else byKey.set(l.date, [l]);
  }
  const out: PeriodTotals[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = shiftIso(today, -i);
    out.push(periodTotals(byKey.get(d) || [], d, d.slice(8) + "/" + d.slice(5, 7)));
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Sections 5-10, 16, 18, 19 -- group-bys. One generic, five projections.
 * ------------------------------------------------------------------------ */

export interface GroupTotals extends Totals {
  key: string;
  label: string;
  /** Share of the filtered set's revenue, 0..1. */
  share: number;
  meta?: string;
}

function groupBy(
  lines: SalesLine[],
  keyOf: (l: SalesLine) => string,
  labelOf: (l: SalesLine) => string,
  fallbackLabel: string
): GroupTotals[] {
  const buckets = new Map<string, { label: string; lines: SalesLine[] }>();
  for (const l of lines) {
    const k = keyOf(l);
    let b = buckets.get(k);
    if (!b) { b = { label: labelOf(l) || fallbackLabel, lines: [] }; buckets.set(k, b); }
    b.lines.push(l);
  }
  const all = totals(lines);
  return [...buckets.entries()]
    .map(([key, b]) => {
      const t = totals(b.lines);
      return { ...t, key, label: b.label, share: all.revenue ? t.revenue / all.revenue : 0 };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function salesByProduct(lines: SalesLine[]): GroupTotals[] {
  return groupBy(lines, (l) => l.productId, (l) => l.productName, "—");
}
export function salesByCategory(lines: SalesLine[]): GroupTotals[] {
  return groupBy(lines, (l) => l.categoryId || "none", (l) => l.categoryName, "Uncategorised");
}
export function salesByCustomer(lines: SalesLine[]): GroupTotals[] {
  return groupBy(lines, (l) => l.customerPhone || "unknown", (l) => l.customerName, "—");
}
export function salesBySeller(lines: SalesLine[]): GroupTotals[] {
  return groupBy(lines, (l) => l.sellerId || "platform", (l) => l.sellerName, "Store's own");
}
export function salesByMunicipality(lines: SalesLine[]): GroupTotals[] {
  return groupBy(lines, (l) => l.municipality || "unknown", (l) => l.municipality, "Not recorded");
}

export type RankBy = "revenue" | "qty" | "profit" | "margin" | "orders";

/** Re-rank an existing group list. Groups with an unknown margin sort last
 * whichever direction is asked for -- an unknown is not a zero, and letting
 * it sort as one would put every uncosted product at the bottom of a
 * "worst margin" list and the top of nothing. */
export function rank(rows: GroupTotals[], by: RankBy): GroupTotals[] {
  const value = (r: GroupTotals): number | null => {
    switch (by) {
      case "revenue": return r.revenue;
      case "qty": return r.qty;
      case "orders": return r.orders;
      case "profit": return r.grossProfit;
      case "margin": return r.margin;
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va;
  });
}

/* ---------------------------------------------------------------------------
 * Section 7 -- customer analysis.
 * ------------------------------------------------------------------------ */

export interface CustomerRow extends GroupTotals {
  phone: string;
  orders: number;
  lastPurchase: string;
  firstPurchase: string;
  daysSincePurchase: number;
  isNew: boolean;
  isInactive: boolean;
  /** Revenue in the recent half of the window vs the earlier half, when both
   * halves have data. Negative means buying less than they used to. */
  trend: number | null;
  outstandingOrders: number;
  outstandingValue: number;
}

export interface CustomerOptions {
  today: string;
  inactiveDays?: number;
  priorLines?: SalesLine[];
}

export function customerAnalysis(lines: SalesLine[], opts: CustomerOptions): CustomerRow[] {
  const { today, inactiveDays = 90, priorLines = [] } = opts;
  const priorCustomers = new Set(priorLines.filter(isLive).map((l) => l.customerPhone));
  const live = lines.filter(isLive);
  const byPhone = new Map<string, SalesLine[]>();
  for (const l of live) {
    if (!l.customerPhone) continue;
    const arr = byPhone.get(l.customerPhone);
    if (arr) arr.push(l); else byPhone.set(l.customerPhone, [l]);
  }

  const all = totals(live);
  const rows: CustomerRow[] = [];
  for (const [phone, ls] of byPhone) {
    const t = totals(ls);
    const dates = ls.map((l) => l.date).filter(Boolean).sort();
    const first = dates[0] || "";
    const last = dates[dates.length - 1] || "";
    const outstanding = groupOrders(ls).filter((o) =>
      (PENDING_STATUSES as readonly string[]).includes(o.status));

    rows.push({
      ...t,
      key: phone,
      phone,
      label: ls[ls.length - 1].customerName || phone,
      share: all.revenue ? t.revenue / all.revenue : 0,
      lastPurchase: last,
      firstPurchase: first,
      daysSincePurchase: last ? daysBetween(last, today) : 0,
      isNew: !priorCustomers.has(phone),
      isInactive: last ? daysBetween(last, today) > inactiveDays : false,
      trend: halfOverHalf(ls, first, last),
      outstandingOrders: outstanding.length,
      outstandingValue: outstanding.reduce((a, o) => a + o.revenue, 0),
    });
  }
  return rows.sort((a, b) => b.revenue - a.revenue);
}

/** Split a customer's history down the middle by date and compare the two
 * halves. Crude on purpose: it needs no target, no seasonality model and no
 * minimum history, and it answers the only question section 7 asks -- is
 * this customer buying less than they were. */
function halfOverHalf(ls: SalesLine[], first: string, last: string): number | null {
  if (!first || !last || first === last) return null;
  const mid = shiftIso(first, Math.floor(daysBetween(first, last) / 2));
  const earlier = ls.filter((l) => l.date <= mid).reduce((a, l) => a + l.netSales, 0);
  const later = ls.filter((l) => l.date > mid).reduce((a, l) => a + l.netSales, 0);
  if (!earlier) return null;
  return (later - earlier) / earlier;
}

/* ---------------------------------------------------------------------------
 * Section 11 -- order status.
 * ------------------------------------------------------------------------ */

export interface StatusBucket {
  status: OrderStatus;
  count: number;
  qty: number;
  value: number;
}

export function statusBreakdown(lines: SalesLine[]): StatusBucket[] {
  const orders = groupOrders(lines);
  return SALES_STATUSES.map((status) => {
    const inStatus = orders.filter((o) => o.status === status);
    return {
      status,
      count: inStatus.length,
      qty: inStatus.reduce((a, o) => a + o.qty, 0),
      value: inStatus.reduce((a, o) => a + o.revenue, 0),
    };
  });
}

/* ---------------------------------------------------------------------------
 * Payments. "What did we sell" and "have we been paid" are different
 * questions, and this store answers the second one differently per method:
 * a card order is settled by the gateway, a bank transfer or `fiar` (credit)
 * order only when the owner says so. Outstanding money is therefore real
 * operational information, not a rounding detail.
 * ------------------------------------------------------------------------ */

export interface PaymentBucket { key: string; count: number; value: number }

export interface PaymentSummary {
  byMethod: PaymentBucket[];
  byStatus: PaymentBucket[];
  /** Revenue of non-cancelled orders not yet fully paid. */
  outstanding: number;
  outstandingOrders: number;
  collected: number;
}

export function paymentSummary(lines: SalesLine[]): PaymentSummary {
  // Per ORDER, not per line: payment status belongs to the order, and
  // summing lines would count a three-item order's balance three times.
  const orders = groupOrders(lines).filter((o) => o.status !== "cancelled");

  const bucket = (pick: (o: OrderRollup) => string): PaymentBucket[] => {
    const m = new Map<string, PaymentBucket>();
    for (const o of orders) {
      const key = pick(o);
      let b = m.get(key);
      if (!b) { b = { key, count: 0, value: 0 }; m.set(key, b); }
      b.count++;
      b.value += o.revenue;
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  };

  // "deposit" is a part payment, so the order still owes something. Treating
  // it as collected would understate what is out there.
  const owing = orders.filter((o) => o.payStatus === "unpaid" || o.payStatus === "deposit");

  return {
    byMethod: bucket((o) => o.payMethod),
    byStatus: bucket((o) => o.payStatus),
    outstanding: owing.reduce((a, o) => a + o.revenue, 0),
    outstandingOrders: owing.length,
    collected: orders.filter((o) => o.payStatus === "paid").reduce((a, o) => a + o.revenue, 0),
  };
}

/* ---------------------------------------------------------------------------
 * Section 19 -- products that are not working.
 * ------------------------------------------------------------------------ */

export interface LowPerformer extends GroupTotals {
  reasons: Array<"low_volume" | "low_revenue" | "low_margin" | "declining" | "no_sales">;
}

export interface LowPerformerOptions {
  /** Below this share of median revenue, a product counts as low-revenue. */
  revenueFloorRatio?: number;
  marginFloor?: number;
  /** Products in the catalog that sold nothing at all in the window. */
  unsoldProducts?: Array<{ id: string; name: string }>;
}

export function lowPerformers(
  lines: SalesLine[],
  opts: LowPerformerOptions = {}
): LowPerformer[] {
  const { revenueFloorRatio = 0.25, marginFloor = 0.1, unsoldProducts = [] } = opts;
  const rows = salesByProduct(lines.filter(isLive));

  // Median, not mean: one runaway best-seller drags a mean so far up that
  // most of the catalog looks like it is failing.
  const sorted = rows.map((r) => r.revenue).sort((a, b) => a - b);
  const median = sorted.length
    ? sorted[Math.floor(sorted.length / 2)]
    : 0;
  const qtySorted = rows.map((r) => r.qty).sort((a, b) => a - b);
  const qtyMedian = qtySorted.length ? qtySorted[Math.floor(qtySorted.length / 2)] : 0;

  const out: LowPerformer[] = [];
  for (const r of rows) {
    const reasons: LowPerformer["reasons"] = [];
    if (median > 0 && r.revenue < median * revenueFloorRatio) reasons.push("low_revenue");
    if (qtyMedian > 0 && r.qty < qtyMedian * revenueFloorRatio) reasons.push("low_volume");
    if (r.margin != null && r.margin < marginFloor) reasons.push("low_margin");
    if (reasons.length) out.push({ ...r, reasons });
  }

  for (const p of unsoldProducts) {
    out.push({
      ...emptyTotals(), key: p.id, label: p.name, share: 0, reasons: ["no_sales"],
    });
  }
  return out.sort((a, b) => a.revenue - b.revenue);
}

/* ---------------------------------------------------------------------------
 * Section 21 -- targets.
 * ------------------------------------------------------------------------ */

export interface SalesTarget {
  id: string;
  period: string;
  scope: "global" | "category" | "seller" | "municipality";
  scope_id: string;
  amount: number;
  created_at: string;
}

export interface TargetProgress {
  period: string;
  target: number;
  actual: number;
  difference: number;
  /** actual / target, 0..n. Null when no target was set for the period. */
  achievement: number | null;
  remaining: number;
}

export function targetProgress(
  targets: SalesTarget[], period: string, actual: number,
  scope: SalesTarget["scope"] = "global", scopeId = ""
): TargetProgress {
  const t = targets.find(
    (x) => x.period === period && x.scope === scope && x.scope_id === scopeId
  );
  const target = t ? Number(t.amount) : 0;
  return {
    period, target, actual,
    difference: actual - target,
    achievement: target > 0 ? actual / target : null,
    remaining: Math.max(0, target - actual),
  };
}

/* ---------------------------------------------------------------------------
 * Section 20 -- alerts. Things a manager should look at today.
 * ------------------------------------------------------------------------ */

export type SalesAlertKind =
  | "below_target" | "sales_declining" | "delayed_deliveries" | "large_pending"
  | "low_margin_products" | "customers_declining" | "inactive_customers"
  | "high_discounts" | "cancellations" | "no_cost_data";

export interface SalesAlert {
  kind: SalesAlertKind;
  /** Matches the .alert-* classes already in globals.css, so a sales alert
   * and a procurement alert of the same weight look identical. */
  severity: "high" | "medium" | "low";
  count: number;
  value?: number;
  label?: string;
}

export interface AlertOptions {
  today: string;
  targets?: SalesTarget[];
  period?: string;
  /** Revenue in the period immediately before the one being reported. */
  previousRevenue?: number;
  marginFloor?: number;
  discountCeiling?: number;
  largePendingValue?: number;
  inactiveDays?: number;
}

export function buildSalesAlerts(lines: SalesLine[], opts: AlertOptions): SalesAlert[] {
  const {
    today, targets = [], period, previousRevenue,
    marginFloor = 0.1, discountCeiling = 0.3,
    largePendingValue = 500, inactiveDays = 90,
  } = opts;

  const alerts: SalesAlert[] = [];
  const t = totals(lines);
  const orders = groupOrders(lines);

  if (period) {
    const prog = targetProgress(targets, period, t.revenue);
    if (prog.achievement != null && prog.achievement < 1) {
      alerts.push({
        kind: "below_target", severity: prog.achievement < 0.75 ? "high" : "medium",
        count: 1, value: prog.remaining,
      });
    }
  }

  if (previousRevenue != null) {
    const g = growth(t.revenue, previousRevenue);
    if (g != null && g < -0.1) {
      alerts.push({ kind: "sales_declining", severity: g < -0.25 ? "high" : "medium", count: 1, value: g });
    }
  }

  const delayed = orders.filter((o) => deliveryState(o, today) === "delayed");
  if (delayed.length) {
    alerts.push({
      kind: "delayed_deliveries", severity: "high", count: delayed.length,
      value: delayed.reduce((a, o) => a + o.revenue, 0),
    });
  }

  const bigPending = orders.filter(
    (o) => (PENDING_STATUSES as readonly string[]).includes(o.status) && o.revenue >= largePendingValue
  );
  if (bigPending.length) {
    alerts.push({
      kind: "large_pending", severity: "medium", count: bigPending.length,
      value: bigPending.reduce((a, o) => a + o.revenue, 0),
    });
  }

  const lowMargin = salesByProduct(lines.filter(isLive))
    .filter((p) => p.margin != null && p.margin < marginFloor);
  if (lowMargin.length) {
    alerts.push({ kind: "low_margin_products", severity: "medium", count: lowMargin.length });
  }

  const customers = customerAnalysis(lines, { today, inactiveDays });
  const declining = customers.filter((c) => c.trend != null && c.trend < -0.25);
  if (declining.length) {
    alerts.push({ kind: "customers_declining", severity: "medium", count: declining.length });
  }
  const inactive = customers.filter((c) => c.isInactive);
  if (inactive.length) {
    alerts.push({ kind: "inactive_customers", severity: "low", count: inactive.length });
  }

  if (t.revenue > 0 && t.discount / (t.revenue + t.discount) > discountCeiling) {
    alerts.push({
      kind: "high_discounts", severity: "medium", count: 1,
      value: t.discount / (t.revenue + t.discount),
    });
  }

  const cancelled = groupOrders(lines).filter((o) => o.status === "cancelled");
  if (cancelled.length && cancelled.length / Math.max(1, orders.length) > 0.1) {
    alerts.push({
      kind: "cancellations", severity: "medium", count: cancelled.length,
      value: cancelled.reduce((a, o) => a + o.revenue, 0),
    });
  }

  // Not a business problem but a reporting one, and it explains every blank
  // margin on the page -- so it belongs here rather than in a footnote.
  if (t.revenue > 0 && t.costCoverage < 0.5) {
    alerts.push({ kind: "no_cost_data", severity: "low", count: 1, value: t.costCoverage });
  }

  return alerts;
}

/* ---------------------------------------------------------------------------
 * Section 26 -- insights. The dashboard saying what it noticed, in words.
 * ------------------------------------------------------------------------ */

export type InsightKind =
  | "best_product" | "most_profitable_product" | "best_customer"
  | "best_seller" | "best_municipality" | "best_month" | "worst_month"
  | "yoy_growth" | "revenue_concentration" | "pending_value" | "declining_product";

export interface Insight {
  kind: InsightKind;
  label: string;
  value: number;
  /** How to render `value`: money, a percentage, or a plain count. */
  format: "money" | "percent" | "number";
}

export function buildInsights(lines: SalesLine[], today: string): Insight[] {
  const live = lines.filter(isLive);
  const out: Insight[] = [];
  if (!live.length) return out;

  const push = (kind: InsightKind, row: GroupTotals | undefined, value?: number, format: Insight["format"] = "money") => {
    if (!row) return;
    out.push({ kind, label: row.label, value: value ?? row.revenue, format });
  };

  const products = salesByProduct(live);
  push("best_product", products[0]);

  const byProfit = rank(products, "profit").filter((p) => p.grossProfit != null);
  if (byProfit[0]) {
    out.push({
      kind: "most_profitable_product", label: byProfit[0].label,
      value: byProfit[0].grossProfit as number, format: "money",
    });
  }

  push("best_customer", salesByCustomer(live)[0]);
  push("best_seller", salesBySeller(live)[0]);
  push("best_municipality", salesByMunicipality(live)[0]);

  const months = salesByMonth(live, [...new Set(live.map((l) => l.date.slice(0, 7)))].sort());
  const withSales = months.filter((m) => m.revenue > 0);
  if (withSales.length) {
    const best = withSales.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    const worst = withSales.reduce((a, b) => (b.revenue < a.revenue ? b : a));
    out.push({ kind: "best_month", label: best.key, value: best.revenue, format: "money" });
    if (withSales.length > 1) {
      out.push({ kind: "worst_month", label: worst.key, value: worst.revenue, format: "money" });
    }
  }

  const year = today.slice(0, 4);
  const prevYear = String(Number(year) - 1);
  const thisYearRevenue = live.filter((l) => l.date.startsWith(year)).reduce((a, l) => a + l.netSales, 0);
  const prevYearRevenue = live.filter((l) => l.date.startsWith(prevYear)).reduce((a, l) => a + l.netSales, 0);
  const g = growth(thisYearRevenue, prevYearRevenue);
  if (g != null) out.push({ kind: "yoy_growth", label: `${year} vs ${prevYear}`, value: g, format: "percent" });

  // How much of the business rests on its biggest customers. High
  // concentration is not automatically bad, but it is always worth knowing.
  const customers = salesByCustomer(live);
  const allRevenue = customers.reduce((a, c) => a + c.revenue, 0);
  if (allRevenue > 0 && customers.length >= 3) {
    const top3 = customers.slice(0, 3).reduce((a, c) => a + c.revenue, 0);
    out.push({
      kind: "revenue_concentration", label: String(Math.min(3, customers.length)),
      value: top3 / allRevenue, format: "percent",
    });
  }

  const pending = groupOrders(lines).filter((o) =>
    (PENDING_STATUSES as readonly string[]).includes(o.status));
  if (pending.length) {
    out.push({
      kind: "pending_value", label: String(pending.length),
      value: pending.reduce((a, o) => a + o.revenue, 0), format: "money",
    });
  }

  return out;
}

/* ---------------------------------------------------------------------------
 * Section 24 -- global filters. One filter object, applied once, feeding
 * every panel: a filter that reaches some panels and not others is worse
 * than no filter at all.
 * ------------------------------------------------------------------------ */

export interface SalesFilter {
  from?: string;
  to?: string;
  q?: string;
  customer?: string;
  municipality?: string;
  productId?: string;
  categoryId?: string;
  sellerId?: string;
  status?: OrderStatus | "";
  payStatus?: string;
  deliveryState?: DeliveryState | "";
}

export function filterSalesLines(
  lines: SalesLine[], f: SalesFilter, today: string
): SalesLine[] {
  const q = (f.q || "").trim().toLowerCase();
  let byOrderState: Map<string, DeliveryState> | null = null;
  if (f.deliveryState) {
    byOrderState = new Map(groupOrders(lines).map((o) => [o.orderId, deliveryState(o, today)]));
  }

  return lines.filter((l) => {
    if (f.from && l.date < f.from) return false;
    if (f.to && l.date > f.to) return false;
    if (f.customer && l.customerPhone !== f.customer) return false;
    if (f.municipality && l.municipality !== f.municipality) return false;
    if (f.productId && l.productId !== f.productId) return false;
    if (f.categoryId && (l.categoryId || "none") !== f.categoryId) return false;
    if (f.sellerId && (l.sellerId || "platform") !== f.sellerId) return false;
    if (f.status && l.status !== f.status) return false;
    if (f.payStatus && l.payStatus !== f.payStatus) return false;
    if (byOrderState && byOrderState.get(l.orderId) !== f.deliveryState) return false;
    if (q) {
      const hay = `${l.ref} ${l.productName} ${l.customerName} ${l.customerPhone} ${l.municipality} ${l.sellerName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function filterIsActive(f: SalesFilter): boolean {
  return Object.values(f).some((v) => v !== undefined && v !== "");
}

/* ---------------------------------------------------------------------------
 * Section 22 -- CSV export. Written here rather than in the component so the
 * exported columns and the on-screen columns cannot drift apart.
 * ------------------------------------------------------------------------ */

export const EXPORT_COLUMNS = [
  "ref", "date", "customer", "phone", "municipality", "seller",
  "product", "category", "qty", "unit_price", "discount", "net_sales",
  "cost", "gross_profit", "margin_pct", "status", "pay_status",
  "expected_delivery", "delivered_at", "invoiced_at",
] as const;

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
  // Prefixing an apostrophe is the standard defence; without it a product
  // named "=cmd|..." is a live formula in whoever opens the file.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Columns that describe what the goods COST the marketplace. Dropped for a
 * seller's own export: their lines carry no cost (see lib/data/sellerSales.ts),
 * and three permanently empty columns headed "cost", "gross_profit" and
 * "margin_pct" invite the reader to think the figures are missing rather
 * than that they were never theirs. */
const COST_COLUMNS: ReadonlySet<string> = new Set(["cost", "gross_profit", "margin_pct"]);

export function exportColumns(includeCost = true): string[] {
  return EXPORT_COLUMNS.filter((c) => includeCost || !COST_COLUMNS.has(c));
}

export function linesToCsv(lines: SalesLine[], includeCost = true): string {
  const rows = [exportColumns(includeCost).join(",")];
  for (const l of lines) {
    const cells: Array<string | number | null> = [
      l.ref, l.date, l.customerName, l.customerPhone, l.municipality, l.sellerName,
      l.productName, l.categoryName, l.qty, l.unitPrice.toFixed(2),
      l.discount.toFixed(2), l.netSales.toFixed(2),
    ];
    if (includeCost) {
      cells.push(
        l.cost == null ? "" : l.cost.toFixed(2),
        l.grossProfit == null ? "" : l.grossProfit.toFixed(2),
        l.margin == null ? "" : (l.margin * 100).toFixed(1),
      );
    }
    cells.push(
      l.status, l.payStatus,
      l.expectedDelivery || "", l.deliveredAt || "", l.invoicedAt || "",
    );
    rows.push(cells.map(csvCell).join(","));
  }
  return rows.join("\n");
}
