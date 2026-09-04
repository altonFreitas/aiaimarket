/* A store's own sales, summarised.
 *
 * WHY THIS IS NOT lib/sales.ts.
 *
 * The owner's sales screens are built on SalesLine, which carries the unit
 * COST of every item -- that is what makes margin, markup and profit
 * possible, and it is the platform's own purchasing information. It is
 * deliberately removed before any order data reaches a seller: see
 * stripCost() in lib/data/seller.ts, which exists precisely so a store
 * cannot read what the marketplace paid for goods.
 *
 * So a seller's sales view is a revenue view, not a profit view. Gross,
 * commission, net -- the three numbers that are genuinely theirs. Anything
 * built on cost would either leak the platform's buying prices or quietly
 * report zero margin on everything, and both are worse than not offering
 * it. That is a constraint of the product, not a gap to fill in later.
 *
 * Pure: orders in, rows out. Every number on the seller's Sales screen can
 * therefore be tested without a database or a session.
 */

import type { OrderItem } from "@/lib/types";

/** The slice of SellerOrderView this needs. Structural rather than the
 * imported type, so the aggregation stays testable with plain objects and
 * does not drag lib/data/seller.ts (server-only) into a unit test. */
export interface SellerSaleInput {
  id: string;
  ref: string;
  status: string;
  created_at: string;
  myItems: OrderItem[];
  mySubtotal: number;
}

/** Orders whose money is real: everything except a cancelled one.
 *
 * Matches the rule the earnings ledger already uses, so the Sales screen
 * and the "still owed" figure on the dashboard cannot disagree about what
 * counts -- which is the single most likely way for a seller to lose trust
 * in both of them at once. */
export function counts(status: string): boolean {
  return status !== "cancelled";
}

/** Orders that are finished and paid for. */
export function isCompleted(status: string): boolean {
  return status === "completed";
}

export interface SellerSalesTotals {
  orders: number;
  /** Units across every counted line. */
  units: number;
  gross: number;
  commission: number;
  net: number;
  /** Gross / orders, or 0 with no orders. What a typical basket is worth,
   * which is the number a store can actually act on -- it moves when they
   * bundle or raise prices, and revenue alone does not say why. */
  averageOrder: number;
}

export interface SellerProductSales {
  productId: string;
  name: string;
  units: number;
  gross: number;
}

export interface SellerSalesPeriod {
  /** "2026-09" for a month, "2026-09-04" for a day. */
  period: string;
  orders: number;
  gross: number;
}

export interface SellerSalesReport {
  all: SellerSalesTotals;
  completed: SellerSalesTotals;
  /** Newest last, so a chart reads left to right. Gaps are filled with
   * zero months: a store that sold nothing in August should see the hole,
   * not have August quietly vanish and make a bad month look continuous. */
  byMonth: SellerSalesPeriod[];
  /** Best first, then by name so the order does not shuffle between
   * renders when two products tie. */
  topProducts: SellerProductSales[];
  /** How many orders sit in each status right now. */
  byStatus: { status: string; orders: number }[];
}

function emptyTotals(): SellerSalesTotals {
  return { orders: 0, units: 0, gross: 0, commission: 0, net: 0, averageOrder: 0 };
}

/** Money, to the cent. Floating point addition of prices drifts, and a
 * seller comparing this screen against their own arithmetic will find it. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finish(t: SellerSalesTotals, ratePercent: number): SellerSalesTotals {
  const gross = round2(t.gross);
  const commission = round2((gross * ratePercent) / 100);
  return {
    orders: t.orders,
    units: t.units,
    gross,
    commission,
    net: round2(gross - commission),
    averageOrder: t.orders ? round2(gross / t.orders) : 0,
  };
}

/** The month an ISO timestamp falls in, as "YYYY-MM". */
export function monthOf(iso: string): string {
  return String(iso).slice(0, 7);
}

/** Every month from `first` to `last` inclusive, so a quiet month shows as
 * a zero rather than as an absence. */
export function monthRange(first: string, last: string): string[] {
  if (!first || !last || first > last) return first ? [first] : [];
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  // Bounded: a runaway loop here would spin a serverless function until
  // its timeout. Twenty years of months is far past anything real.
  for (let guard = 0; guard < 240; guard++) {
    const period = `${y}-${String(m).padStart(2, "0")}`;
    out.push(period);
    if (y === ly && m === lm) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Everything the seller's Sales screen shows.
 *
 * `commissionRatePercent` is the rate that applies to THIS store -- their
 * own override if they have one, otherwise the platform default. It is
 * passed in rather than read here so this stays pure, and so the caller
 * cannot accidentally apply the platform rate to a store that negotiated
 * its own. */
export function sellerSalesReport(
  orders: readonly SellerSaleInput[], commissionRatePercent: number
): SellerSalesReport {
  const rate = Number.isFinite(commissionRatePercent) ? Number(commissionRatePercent) : 0;

  const all = emptyTotals();
  const completed = emptyTotals();
  const months = new Map<string, { orders: number; gross: number }>();
  const products = new Map<string, SellerProductSales>();
  const statuses = new Map<string, number>();

  for (const o of orders) {
    statuses.set(o.status, (statuses.get(o.status) ?? 0) + 1);
    if (!counts(o.status)) continue;

    const units = o.myItems.reduce((a, i) => a + Number(i.qty || 0), 0);
    all.orders += 1;
    all.units += units;
    all.gross += Number(o.mySubtotal || 0);

    if (isCompleted(o.status)) {
      completed.orders += 1;
      completed.units += units;
      completed.gross += Number(o.mySubtotal || 0);
    }

    const key = monthOf(o.created_at);
    const month = months.get(key) ?? { orders: 0, gross: 0 };
    month.orders += 1;
    month.gross += Number(o.mySubtotal || 0);
    months.set(key, month);

    for (const i of o.myItems) {
      // A line whose product has since been deleted still sold: it is
      // grouped under its own name rather than dropped, because a store
      // asking "what sells" wants last quarter's answer too.
      const id = i.product_id || `name:${i.name}`;
      const row = products.get(id) ?? { productId: id, name: i.name, units: 0, gross: 0 };
      row.units += Number(i.qty || 0);
      row.gross += Number(i.price || 0) * Number(i.qty || 0);
      products.set(id, row);
    }
  }

  const keys = [...months.keys()].sort();
  const byMonth = keys.length
    ? monthRange(keys[0], keys[keys.length - 1]).map((period) => ({
        period,
        orders: months.get(period)?.orders ?? 0,
        gross: round2(months.get(period)?.gross ?? 0),
      }))
    : [];

  const topProducts = [...products.values()]
    .map((p) => ({ ...p, gross: round2(p.gross) }))
    .sort((a, b) => b.units - a.units || b.gross - a.gross || a.name.localeCompare(b.name));

  const byStatus = [...statuses.entries()]
    .map(([status, count]) => ({ status, orders: count }))
    .sort((a, b) => b.orders - a.orders || a.status.localeCompare(b.status));

  return {
    all: finish(all, rate),
    completed: finish(completed, rate),
    byMonth,
    topProducts,
    byStatus,
  };
}
