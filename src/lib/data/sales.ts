import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  Category, Order, Product, ProductCost, SalesTargetRow, Seller,
} from "@/lib/types";

/* Same reasoning as the caps in lib/data/admin.ts and data/procurement.ts:
 * the dashboard genuinely wants the whole book so it can compute
 * year-on-year trends, but an unbounded read is one busy year away from
 * timing out the page that reports on it. */
const MAX_ORDERS = 20_000;
const MAX_PRODUCTS = 5_000;

/** True once supabase/sales.sql has been run. Every reader below returns
 * empty rather than throwing, so the dashboard can say "cost tracking is not
 * set up yet" and still show revenue, instead of rendering a crash. */
export async function salesReady(): Promise<boolean> {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from("product_costs").select("product_id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function adminProductCosts(): Promise<ProductCost[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("product_costs").select("*").limit(MAX_PRODUCTS);
    if (error) return [];
    return (data as ProductCost[]) || [];
  } catch { return []; }
}

export async function adminSalesTargets(): Promise<SalesTargetRow[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("sales_targets").select("*").order("period");
    if (error) return [];
    return (data as SalesTargetRow[]) || [];
  } catch { return []; }
}

export interface SalesData {
  /** False until supabase/sales.sql has run. Revenue still works; profit,
   * targets and delivery dates do not. */
  ready: boolean;
  orders: Order[];
  products: Product[];
  categories: Category[];
  sellers: Seller[];
  costs: ProductCost[];
  targets: SalesTargetRow[];
}

/** Everything the dashboard needs, in one pass.
 *
 * Six parallel reads rather than one join: the aggregation happens in
 * lib/sales.ts over plain arrays, which is what makes every number on the
 * page testable without a database. A store's history is small enough that
 * this is cheaper than it looks, and it is one round trip instead of one
 * per panel. */
export async function adminSalesData(): Promise<SalesData> {
  const sb = supabaseAdmin();
  const ready = await salesReady();

  const [orders, products, categories, sellers, costs, targets] = await Promise.all([
    sb.from("orders").select("*").order("created_at", { ascending: false })
      .limit(MAX_ORDERS).then((r) => (r.data as Order[]) || []),
    sb.from("products").select("*").limit(MAX_PRODUCTS)
      .then((r) => (r.data as Product[]) || []),
    sb.from("categories").select("*").order("sort_order")
      .then((r) => (r.data as Category[]) || []),
    sb.from("sellers").select("*").then((r) => (r.data as Seller[]) || []),
    ready ? adminProductCosts() : Promise.resolve([] as ProductCost[]),
    ready ? adminSalesTargets() : Promise.resolve([] as SalesTargetRow[]),
  ]);

  return { ready, orders, products, categories, sellers, costs, targets };
}

/** product_id -> unit cost, the shape lib/sales.ts wants. */
export function costMap(costs: ProductCost[]): Map<string, number> {
  return new Map(costs.map((c) => [c.product_id, Number(c.cost_price)]));
}

/** Units handed back, keyed the way buildSalesLines expects.
 *
 * Empty when supabase/returns.sql has not been run, so the dashboard reads
 * exactly as it did before rather than failing. */
export async function returnedUnits(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const { returnKey } = await import("@/lib/sales");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("order_return_items")
      .select("product_id, qty, ret:order_returns(order_id)")
      .limit(20_000);
    if (error || !data) return out;
    for (const r of data as unknown as Array<{
      product_id: string | null; qty: number; ret: { order_id: string } | null;
    }>) {
      if (!r.product_id || !r.ret) continue;
      const key = returnKey(r.ret.order_id, r.product_id);
      out.set(key, (out.get(key) || 0) + (Number(r.qty) || 0));
    }
  } catch { /* returns.sql not run: nothing has been returned */ }
  return out;
}
