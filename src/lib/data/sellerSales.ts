import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildSalesLines, returnKey, type SalesLine } from "@/lib/sales";
import type { Category, Order, OrderItem, Product, Seller } from "@/lib/types";

/* One store's sales, in the same shape the owner's dashboard runs on.
 *
 * WHY REUSE THE OWNER'S ENGINE RATHER THAN WRITE A SMALLER ONE.
 *
 * The first version of the seller's Sales screen had its own aggregation:
 * four totals and two charts. It was honest and it was thin, and the reason
 * it was thin is that it was a second implementation of something that
 * already existed and was far better. Everything the owner has -- period
 * filters, growth against the previous period, monthly/quarterly/weekly
 * series, sales by category and municipality, top products and customers,
 * status and payment breakdowns, delayed deliveries, new-versus-returning
 * customers -- is pure arithmetic over SalesLine[]. Give it the right
 * lines and it all works, for one store, with nothing rewritten.
 *
 * THE ONE THING THAT MAKES THAT SAFE, AND IT IS NOT OPTIONAL.
 *
 * A SalesLine carries unitCost, cost, grossProfit and margin. That is what
 * the MARKETPLACE paid for the goods, and it must never reach a seller.
 * Passing an empty costs map is NOT enough to stop it: buildSalesLines
 * prefers `item.cost`, a snapshot written onto the order line at checkout,
 * and only falls back to the map. An order placed after supabase/sales.sql
 * ran carries that snapshot, so the naive version of this file would have
 * handed every store the platform's buying prices.
 *
 * It would not even have needed a screen to render them. lib/salesWire.ts
 * sends unitCost as one of its five numeric columns, so the number would
 * have arrived in the browser and sat in the network tab whether or not
 * anything drew it.
 *
 * So the cost is removed HERE, at the single point where seller-facing
 * lines are assembled, before anything else touches them -- the same rule
 * and the same reason as stripCost() in lib/data/seller.ts. Every line
 * this module returns has unitCost null, and tests/sellerSalesLines.test.ts
 * fails if one ever does not.
 */

const MAX_ORDER_SCAN = 5000;

/** An order line with the platform's purchase cost removed.
 *
 * Deletes the key rather than zeroing it. Zero is a cost, and a zero cost
 * reads as 100% margin; absent is the only honest way to say "not yours to
 * see", and it is what buildSalesLines already treats as unknown. */
function withoutCost(item: OrderItem): OrderItem {
  if (item.cost == null) return item;
  const { cost: _cost, ...rest } = item;
  return rest as OrderItem;
}

export interface SellerSalesData {
  lines: SalesLine[];
  products: Product[];
  categories: Category[];
  /** Their own live products that sold nothing in the window. */
  unsold: Array<{ id: string; name: string }>;
}

/** Every sales line belonging to one store, cost removed.
 *
 * Orders are scanned and filtered in memory for the same reason
 * getSellerOrders() does it: a seller's items live inside the order's
 * `items` JSONB and there is no orders->seller index to query on. Bounded
 * to the most recent slice rather than the whole table.
 */
export async function sellerSalesData(seller: Seller): Promise<SellerSalesData> {
  const sb = supabaseAdmin();

  const [ordersRes, productsRes, categoriesRes] = await Promise.all([
    sb.from("orders").select("*")
      .order("created_at", { ascending: false }).limit(MAX_ORDER_SCAN),
    sb.from("products").select("*").eq("seller_id", seller.id),
    sb.from("categories").select("*"),
  ]);

  const products = (productsRes.data as Product[]) || [];
  const categories = (categoriesRes.data as Category[]) || [];

  // Only this store's lines, and only ever this store's. An order that
  // mixed three sellers' goods contributes one seller's items here and
  // nothing else -- not the order total, not the other lines.
  const scoped: Order[] = [];
  for (const o of ((ordersRes.data as Order[]) || [])) {
    const mine = (o.items || []).filter((i) => i.seller_id === seller.id);
    if (!mine.length) continue;
    scoped.push({ ...o, items: mine.map(withoutCost) });
  }

  const returns = await returnedUnitsFor(sb, scoped);

  const lines = buildSalesLines(scoped, {
    products,
    categories,
    sellers: [seller],
    // Empty on purpose, and belt to the braces above: with the snapshot
    // already gone, this is the other door cost could come through.
    costs: new Map(),
    returns,
  });

  const sold = new Set(lines.map((l) => l.productId));
  const unsold = products
    .filter((p) => !p.archived && !sold.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));

  return { lines, products, categories, unsold };
}

/** Units handed back, keyed the way buildSalesLines expects.
 *
 * Only for the orders passed in, so a store's returns are netted off its
 * own lines and nobody else's. Returns an empty map on a database that has
 * not run supabase/returns.sql, which reads exactly as "nothing came
 * back". */
async function returnedUnitsFor(
  sb: ReturnType<typeof supabaseAdmin>, orders: Order[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!orders.length) return out;

  const { data, error } = await sb
    .from("order_returns")
    .select("order_id, order_return_items(product_id, qty)")
    .in("order_id", orders.map((o) => o.id));
  if (error || !data) return out;

  for (const r of data as Array<{
    order_id: string;
    order_return_items: Array<{ product_id: string | null; qty: number }> | null;
  }>) {
    for (const item of r.order_return_items || []) {
      if (!item.product_id) continue;
      const key = returnKey(r.order_id, item.product_id);
      out.set(key, (out.get(key) ?? 0) + Number(item.qty || 0));
    }
  }
  return out;
}
