import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SalesLine } from "@/lib/sales";
import type { Category, Seller } from "@/lib/types";

/* READING THE DASHBOARD'S ARITHMETIC INSTEAD OF RE-DOING IT.
 *
 * sales_daily is one row per shop-day, status, seller and category, netted
 * for returns -- see supabase/sales-rollup.sql for why, and
 * tests/rls/salesRollup.test.ts for the proof that it agrees, figure for
 * figure, with buildSalesLines() over the same data.
 *
 * Everything here returns an EMPTY, UNREADY answer rather than throwing. A
 * shop that has not run the migration has no view, and the dashboard it
 * already had must keep working exactly as it did -- this is an addition,
 * not a replacement, and it has to behave like one on the day the code
 * ships and the SQL has not been pasted yet.
 */

export interface RollupRow {
  day: string;
  status: string;
  sellerId: string | null;
  categoryId: string | null;
  /** False when nothing behind this row had a cost. Its `cost` is then
   * meaningless and must not be counted as zero -- see the view. */
  hasCost: boolean;
  orders: number;
  qty: number;
  netSales: number;
  cost: number;
  discount: number;
  /** Lines with no cost on either side. A margin computed over lines that
   * are half-costed is a lie with a decimal point, so the figure travels
   * with the count of what it could not see. */
  linesWithoutCost: number;
  lines: number;
}

export interface DayOrders {
  day: string;
  status: string;
  orders: number;
}

export interface Rollup {
  /** False until supabase/sales-rollup.sql has been run. Every caller has
   * to branch on this rather than on `rows.length`: no rows is a real
   * answer for a shop with no sales, and "the view is not there" is not. */
  ready: boolean;
  rows: RollupRow[];
  /** Distinct orders per day and status, from its own view.
   *
   * NOT summed out of `rows`: that grain counts an order once per seller
   * per category, so an order holding a shirt and a football is two. Money
   * is additive across the grain and a count of orders is not. */
  orders: DayOrders[];
}

const EMPTY: Rollup = { ready: false, rows: [], orders: [] };

/** How many grouped rows one read will take.
 *
 * The grain is day x status x seller x category, so a shop with five
 * sellers and eight categories makes up to 200 rows a day. Two years of
 * that is well inside this; a shop that exceeds it has outgrown reading
 * the whole thing at once and wants a narrower range, which is what the
 * arguments are for. */
const MAX_ROWS = 20_000;

/** The rollup between two shop-days, inclusive. Both YYYY-MM-DD. */
export async function salesRollup(from: string, to: string): Promise<Rollup> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("sales_daily")
      .select("day, status, seller_id, category_id, has_cost, orders, qty, net_sales, cost, discount, lines_without_cost, lines")
      .gte("day", from).lte("day", to)
      .order("day", { ascending: true })
      .limit(MAX_ROWS);
    // A missing view and a failed read are the same thing to a caller: no
    // figures from here, use the ones you already had.
    if (error || !data) return EMPTY;

    /* Read after the rows and not in parallel: if the first read says the
       migration has not run, the second would fail the same way and there
       is nothing to learn from watching it. */
    const counts = await sb
      .from("sales_daily_orders")
      .select("day, status, orders")
      .gte("day", from).lte("day", to)
      .limit(MAX_ROWS);

    return {
      ready: true,
      orders: counts.error || !counts.data ? [] :
        (counts.data as Array<Record<string, unknown>>).map((r) => ({
          day: String(r.day), status: String(r.status), orders: Number(r.orders) || 0,
        })),
      rows: (data as Array<Record<string, unknown>>).map((r) => ({
        day: String(r.day),
        status: String(r.status),
        sellerId: (r.seller_id as string | null) ?? null,
        categoryId: (r.category_id as string | null) ?? null,
        hasCost: r.has_cost === true,
        orders: Number(r.orders) || 0,
        qty: Number(r.qty) || 0,
        netSales: Number(r.net_sales) || 0,
        cost: Number(r.cost) || 0,
        discount: Number(r.discount) || 0,
        linesWithoutCost: Number(r.lines_without_cost) || 0,
        lines: Number(r.lines) || 0,
      })),
    };
  } catch {
    return EMPTY;
  }
}

export interface RollupTotals {
  orders: number;
  qty: number;
  netSales: number;
  cost: number;
  discount: number;
  grossProfit: number;
  /** How many of the lines behind these figures had no cost at all. Zero
   * means the margin is whole. */
  linesWithoutCost: number;
}

/** Sums a rollup, optionally over one status filter.
 *
 * `orders` is summed rather than counted distinctly, and that is a real
 * limitation said out loud: an order spanning two categories contributes a
 * row to each, so this over-counts orders for any cut that crosses the
 * grain. Revenue, cost, units and discount are additive and exact. Use
 * this for money, not for "how many orders".
 */
export function rollupTotals(
  rows: RollupRow[], keep?: (r: RollupRow) => boolean
): RollupTotals {
  const out: RollupTotals = {
    orders: 0, qty: 0, netSales: 0, cost: 0, discount: 0,
    grossProfit: 0, linesWithoutCost: 0,
  };
  for (const r of rows) {
    if (keep && !keep(r)) continue;
    out.orders += r.orders;
    out.qty += r.qty;
    out.netSales += r.netSales;
    out.cost += r.cost;
    out.discount += r.discount;
    out.linesWithoutCost += r.linesWithoutCost;
  }
  out.grossProfit = Math.round((out.netSales - out.cost) * 100) / 100;
  out.netSales = Math.round(out.netSales * 100) / 100;
  out.cost = Math.round(out.cost * 100) / 100;
  out.discount = Math.round(out.discount * 100) / 100;
  return out;
}


/* ---------------------------------------------------------------------------
 * Feeding the dashboard's existing arithmetic
 * ------------------------------------------------------------------------ */

/** The fields of a SalesLine that a rollup row can honestly fill.
 *
 * Everything else on a SalesLine is per-line -- an order ref, a buyer's
 * phone, a size, a delivery date -- and a rolled-up row has no business
 * inventing them. This type is what the dashboard's group-and-sum functions
 * actually read, and it is deliberately a SUBSET rather than a SalesLine
 * with blanks in it: a blank ref that flows into a screen prints an empty
 * table cell, where a missing field will not compile.
 */
export type RollupLine = Pick<SalesLine,
  "date" | "createdAt" | "status" | "qty" | "netSales" | "cost" | "discount"
  | "sellerId" | "sellerName" | "categoryId" | "categoryName">;

/** One synthetic line per rollup row.
 *
 * WHY SYNTHESISE RATHER THAN REWRITE THE AGGREGATORS. headlineMetrics,
 * overviewSeries, salesByCategory and profitAndLoss are tested, understood
 * and shared with three other screens. Handing them rows that group and sum
 * to the same totals changes what the dashboard READS without changing what
 * it COMPUTES -- so a disagreement can only come from the view, which is
 * exactly what tests/rls/salesRollup.test.ts pins against a real database.
 *
 * `createdAt` is midday on the day, and that is a real limitation rather
 * than a detail: it is only read to bucket an HOUR chart, and a daily
 * rollup cannot answer one. The caller is responsible for not asking --
 * see adminDashboardSource().
 */
export function rollupLines(
  rows: readonly RollupRow[],
  categories: readonly Category[],
  sellers: readonly Seller[]
): RollupLine[] {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const sellerName = new Map(sellers.map((s) => [s.id, s.store_name]));
  return rows.map((r) => ({
    date: r.day,
    createdAt: `${r.day}T12:00:00.000Z`,
    status: r.status as SalesLine["status"],
    qty: r.qty,
    netSales: r.netSales,
    /* NULL, NOT ZERO, when nothing behind the row had a cost. totals()
       counts a line's revenue toward the margin base only when its cost is
       known, so a zero here would quietly add uncosted revenue to that
       base and report a bigger gross profit than the order book does. */
    cost: r.hasCost ? r.cost : null,
    discount: r.discount,
    sellerId: r.sellerId,
    sellerName: r.sellerId ? sellerName.get(r.sellerId) ?? "" : "",
    categoryId: r.categoryId,
    categoryName: r.categoryId ? catName.get(r.categoryId) ?? "" : "",
  }));
}

/** Distinct orders between two days, over the statuses that count as sales.
 *
 * Summed from the order-count view, where the figure is exact. */
export function rollupOrderCount(
  orders: readonly DayOrders[], from: string, to: string,
  keep: (status: string) => boolean
): number {
  let n = 0;
  for (const o of orders) {
    if (o.day >= from && o.day <= to && keep(o.status)) n += o.orders;
  }
  return n;
}
