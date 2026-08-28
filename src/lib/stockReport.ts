import { effectivePrice } from "@/lib/utils";
import type { Category, Order, Product, Seller, StockStatus } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * Stock report: what the products table says, reconciled against what the
 * orders table has already promised.
 *
 * The number that makes this worth a screen is `available`, and it is not a
 * column in the database. Stock is decremented by a trigger when an order
 * moves to `confirmed` (see schema.sql), so between checkout and confirmation
 * the units are spoken for while products.qty still counts them as on hand.
 * A shelf quantity of 3 with 3 unconfirmed orders against it is a shelf
 * quantity of 0, and only this subtraction says so.
 *
 * Everything here is pure -- orders and products in, rows out -- so the
 * arithmetic can be tested exhaustively without a database.
 * ------------------------------------------------------------------------ */

/** Statuses whose units have NOT yet been taken out of products.qty. */
const AWAITING_CONFIRM: ReadonlySet<string> = new Set(["new"]);

/** Statuses whose units are already deducted but not yet in a buyer's hands.
 * Useful on its own: it is the stock currently moving through the shop. */
const IN_FULFILMENT: ReadonlySet<string> = new Set(["confirmed", "preparing", "out", "arrived"]);

/** At or below this many units, a listing is worth restocking before it sells
 * out. Matches the threshold the database trigger uses when it flips
 * stock_status to 'low' (see decrement_stock_on_confirm in schema.sql), so
 * the dashboard and the badge on a product card never disagree. */
export const LOW_STOCK_THRESHOLD = 2;

export interface StockRow {
  id: string;
  ref: string;
  name: string;
  slug: string;
  image: string | null;
  categoryName: string;
  /** Empty for the platform's own catalog; a store name for a real seller. */
  sellerName: string;
  stockStatus: StockStatus;
  archived: boolean;
  /** Units the database currently believes are on the shelf. */
  onHand: number;
  /** Units in orders that have not been confirmed yet, so still counted in
   * onHand even though they are already promised to someone. */
  awaitingConfirm: number;
  /** Units already deducted, in orders on their way to a buyer. */
  inFulfilment: number;
  /** onHand minus awaitingConfirm. Negative means the shop has promised more
   * than it holds -- the single most actionable number on this screen. */
  available: number;
  /** Units across completed orders, all time. */
  unitsSold: number;
  /** The price a buyer pays today: the discount when one is running. */
  unitPrice: number;
  /** onHand x unitPrice. Inventory valued at what it would sell for, not at
   * cost -- this catalog has no cost price to value it at. */
  stockValue: number;
  lastSoldAt: string | null;
  /** Whole days since the last completed sale, or null if never sold. */
  daysSinceLastSale: number | null;
  views: number;
  /** Higher is more urgent. See scoreUrgency for what earns a point. */
  urgency: number;
}

export interface StockSummary {
  skus: number;
  outOfStock: number;
  lowStock: number;
  oversold: number;
  unitsOnHand: number;
  stockValue: number;
  unitsAwaitingConfirm: number;
  neverSold: number;
}

export interface StockReport {
  rows: StockRow[];
  summary: StockSummary;
}

/** Sorts the worst problems to the top, because a stock screen is opened to
 * find them, not to browse.
 *
 *   4  promised more than it holds -- someone is going to be told no
 *   3  out of stock, and it was selling
 *   2  out of stock
 *   1  running low
 *   0  fine
 *
 * "Was selling" deliberately beats plain "out of stock": a listing nobody
 * ever ordered being at zero is not urgent, it is just empty. */
function scoreUrgency(row: Omit<StockRow, "urgency">): number {
  if (row.archived) return 0; // archived listings cannot be sold; never urgent
  if (row.available < 0) return 4;
  if (row.stockStatus === "out" || row.onHand === 0) return row.unitsSold > 0 ? 3 : 2;
  if (row.stockStatus === "low" || row.onHand <= LOW_STOCK_THRESHOLD) return 1;
  return 0;
}

export function buildStockReport(
  products: Product[],
  orders: Order[],
  cats: Category[],
  sellers: Seller[] = []
): StockReport {
  const catById = new Map(cats.map((c) => [c.id, c]));
  const sellerById = new Map(sellers.map((s) => [s.id, s]));

  // One pass over orders rather than one per product: a scan per row turns a
  // 500-product catalog into 500 scans of the whole orders table.
  const awaiting = new Map<string, number>();
  const fulfilling = new Map<string, number>();
  const sold = new Map<string, number>();
  const lastSold = new Map<string, string>();

  const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) || 0) + n);

  for (const o of orders) {
    const target =
      AWAITING_CONFIRM.has(o.status) ? awaiting :
      IN_FULFILMENT.has(o.status) ? fulfilling :
      o.status === "completed" ? sold :
      null; // cancelled: not a claim on stock and not a sale
    if (!target) continue;

    for (const item of o.items || []) {
      if (!item.product_id) continue;
      bump(target, item.product_id, Number(item.qty) || 0);
      if (target === sold) {
        const seen = lastSold.get(item.product_id);
        if (!seen || o.created_at > seen) lastSold.set(item.product_id, o.created_at);
      }
    }
  }

  const now = Date.now();

  const rows: StockRow[] = products.map((p) => {
    const cat = p.category_id ? catById.get(p.category_id) : null;
    const parent = cat?.parent_id ? catById.get(cat.parent_id) : null;
    const onHand = Number(p.qty) || 0;
    const awaitingConfirm = awaiting.get(p.id) || 0;
    const unitPrice = effectivePrice(p);
    const soldAt = lastSold.get(p.id) || null;

    const base = {
      id: p.id,
      ref: p.ref,
      name: p.name,
      slug: p.slug,
      image: p.images?.[0] || null,
      categoryName: cat ? (parent ? `${parent.name} › ${cat.name}` : cat.name) : "",
      sellerName: sellerById.get(p.seller_id)?.store_name || "",
      stockStatus: p.stock_status,
      archived: p.archived,
      onHand,
      awaitingConfirm,
      inFulfilment: fulfilling.get(p.id) || 0,
      available: onHand - awaitingConfirm,
      unitsSold: sold.get(p.id) || 0,
      unitPrice,
      stockValue: onHand * unitPrice,
      lastSoldAt: soldAt,
      daysSinceLastSale: soldAt
        ? Math.max(0, Math.floor((now - new Date(soldAt).getTime()) / 864e5))
        : null,
      views: Number(p.views) || 0,
    };

    return { ...base, urgency: scoreUrgency(base) };
  });

  // Urgency first, then the biggest money at risk within each band, then name
  // so the order is stable between refreshes rather than shuffling.
  rows.sort((a, b) =>
    b.urgency - a.urgency ||
    b.stockValue - a.stockValue ||
    a.name.localeCompare(b.name)
  );

  // Summary counts LIVE listings only. An archived product with zero stock is
  // not a problem to fix, and letting archived rows inflate "out of stock"
  // would make the number that should prompt action unreadable.
  const live = rows.filter((r) => !r.archived);

  return {
    rows,
    summary: {
      skus: live.length,
      outOfStock: live.filter((r) => r.stockStatus === "out" || r.onHand === 0).length,
      lowStock: live.filter((r) => r.urgency === 1).length,
      oversold: live.filter((r) => r.available < 0).length,
      unitsOnHand: live.reduce((a, r) => a + r.onHand, 0),
      stockValue: live.reduce((a, r) => a + r.stockValue, 0),
      unitsAwaitingConfirm: live.reduce((a, r) => a + r.awaitingConfirm, 0),
      neverSold: live.filter((r) => r.unitsSold === 0).length,
    },
  };
}

export type StockSortKey =
  | "urgency" | "name" | "ref" | "onHand" | "available"
  | "unitsSold" | "stockValue" | "views" | "lastSold";

/** Client-side sorting for the table headers. Kept here beside the report so
 * the tie-breaks stay consistent with the default order above. */
export function sortStockRows(rows: StockRow[], key: StockSortKey, desc: boolean): StockRow[] {
  const dir = desc ? -1 : 1;
  const byName = (a: StockRow, b: StockRow) => a.name.localeCompare(b.name);
  const num = (f: (r: StockRow) => number) =>
    (a: StockRow, b: StockRow) => (f(a) - f(b)) * dir || byName(a, b);

  const cmp: Record<StockSortKey, (a: StockRow, b: StockRow) => number> = {
    urgency: num((r) => r.urgency),
    onHand: num((r) => r.onHand),
    available: num((r) => r.available),
    unitsSold: num((r) => r.unitsSold),
    stockValue: num((r) => r.stockValue),
    views: num((r) => r.views),
    // Never-sold rows sort as infinitely stale: "nothing has ever moved" is
    // the extreme of the same axis, not a missing value to drop to one end.
    lastSold: num((r) => (r.daysSinceLastSale == null ? Number.MAX_SAFE_INTEGER : r.daysSinceLastSale)),
    name: (a, b) => byName(a, b) * dir,
    ref: (a, b) => a.ref.localeCompare(b.ref) * dir,
  };

  return rows.slice().sort(cmp[key]);
}
