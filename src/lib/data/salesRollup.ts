import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

export interface Rollup {
  /** False until supabase/sales-rollup.sql has been run. Every caller has
   * to branch on this rather than on `rows.length`: no rows is a real
   * answer for a shop with no sales, and "the view is not there" is not. */
  ready: boolean;
  rows: RollupRow[];
}

const EMPTY: Rollup = { ready: false, rows: [] };

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
      .select("day, status, seller_id, category_id, orders, qty, net_sales, cost, discount, lines_without_cost, lines")
      .gte("day", from).lte("day", to)
      .order("day", { ascending: true })
      .limit(MAX_ROWS);
    // A missing view and a failed read are the same thing to a caller: no
    // figures from here, use the ones you already had.
    if (error || !data) return EMPTY;
    return {
      ready: true,
      rows: (data as Array<Record<string, unknown>>).map((r) => ({
        day: String(r.day),
        status: String(r.status),
        sellerId: (r.seller_id as string | null) ?? null,
        categoryId: (r.category_id as string | null) ?? null,
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
