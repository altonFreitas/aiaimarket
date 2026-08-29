import type { Category, Order, Product } from "@/lib/types";

/* ===========================================================================
 * demand.ts — the pre-sale funnel.
 *
 * The sales dashboard starts at the order. Everything before it -- who
 * looked, who reached out, who never bought -- is invisible there. This
 * module answers that half.
 *
 * ONE CONSTRAINT SHAPES EVERYTHING HERE, so it is stated once, loudly.
 *
 * products.views and products.wa_clicks are LIFETIME COUNTERS on the product
 * row (see increment_views / increment_wa_clicks in schema.sql). They carry
 * no timestamps, and there is no per-day view table. So:
 *
 *   - Every rate below is all-time, and the UI says so.
 *   - Orders are counted all-time too, deliberately. Dividing all-time views
 *     by one month of orders would produce a conversion rate that is simply
 *     wrong, and wrong in the flattering direction as history accumulates.
 *   - This page therefore has NO date filter. That is not an omission; a
 *     date filter here could only lie.
 *
 * Adding a timestamped product_views table later is what would unlock a real
 * time series. Until then, all-time and honest beats filtered and false.
 * ======================================================================== */

export interface ProductDemand {
  productId: string;
  name: string;
  ref: string;
  categoryId: string | null;
  categoryName: string;
  views: number;
  waClicks: number;
  /** Distinct orders containing this product, all time, cancelled excluded. */
  orders: number;
  units: number;
  revenue: number;
  /** wa_clicks / views. Null when nobody has looked yet. */
  viewToClick: number | null;
  /** orders / wa_clicks. Null when nobody has clicked. */
  clickToOrder: number | null;
  /** orders / views -- the headline conversion. Null when no views. */
  viewToOrder: number | null;
  stockStatus: Product["stock_status"];
  archived: boolean;
  status: Product["status"];
  hasImage: boolean;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** One row per live catalog product, joined to its all-time order history.
 *
 * Archived products are kept out: they cannot be bought, so their conversion
 * rate is a fact about the past that no decision depends on. */
export function buildProductDemand(
  products: Product[], orders: Order[], categories: Category[]
): ProductDemand[] {
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  // Accumulate order-side facts per product id in one pass over the book.
  const sold = new Map<string, { orders: Set<string>; units: number; revenue: number }>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const item of o.items || []) {
      let s = sold.get(item.product_id);
      if (!s) { s = { orders: new Set(), units: 0, revenue: 0 }; sold.set(item.product_id, s); }
      s.orders.add(o.id);
      s.units += Number(item.qty) || 0;
      s.revenue += (Number(item.price) || 0) * (Number(item.qty) || 0);
    }
  }

  return products
    .filter((p) => !p.archived)
    .map((p) => {
      const s = sold.get(p.id);
      const views = p.views || 0;
      const waClicks = p.wa_clicks || 0;
      const orderCount = s ? s.orders.size : 0;
      const category = p.category_id ? categoryById.get(p.category_id) : undefined;

      return {
        productId: p.id,
        name: p.name,
        ref: p.ref,
        categoryId: p.category_id,
        categoryName: category?.name || "",
        views,
        waClicks,
        orders: orderCount,
        units: s ? s.units : 0,
        revenue: s ? s.revenue : 0,
        viewToClick: rate(waClicks, views),
        clickToOrder: rate(orderCount, waClicks),
        viewToOrder: rate(orderCount, views),
        stockStatus: p.stock_status,
        archived: p.archived,
        status: p.status,
        hasImage: (p.images || []).length > 0,
      };
    })
    .sort((a, b) => b.views - a.views);
}

/* ---------------------------------------------------------------------------
 * The funnel, in total.
 * ------------------------------------------------------------------------ */

export interface Funnel {
  views: number;
  waClicks: number;
  orders: number;
  units: number;
  viewToClick: number | null;
  clickToOrder: number | null;
  viewToOrder: number | null;
}

export function computeFunnel(rows: ProductDemand[]): Funnel {
  const views = rows.reduce((a, r) => a + r.views, 0);
  const waClicks = rows.reduce((a, r) => a + r.waClicks, 0);
  // Summing per-product order counts double-counts an order holding two
  // products. That is correct HERE: the funnel measures product interest,
  // and a two-product order is two products that were wanted.
  const orders = rows.reduce((a, r) => a + r.orders, 0);
  return {
    views, waClicks, orders,
    units: rows.reduce((a, r) => a + r.units, 0),
    viewToClick: rate(waClicks, views),
    clickToOrder: rate(orders, waClicks),
    viewToOrder: rate(orders, views),
  };
}

/** Median, not mean: one runaway product drags a mean so far up that most of
 * the catalog looks like it is failing. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/* ---------------------------------------------------------------------------
 * Signals. Each is a different decision, which is why they are separate
 * lists rather than one "attention" score that blurs them together.
 * ------------------------------------------------------------------------ */

export type DemandSignal =
  /** People want it and we cannot sell it. Restock first. */
  | "lost_sales"
  /** Plenty of interest, nobody buys. The listing or the price is wrong. */
  | "views_no_sales"
  /** Sells despite barely being seen. Promote it. */
  | "underexposed"
  /** Nobody looks and nobody buys. Consider retiring it. */
  | "ignored";

export interface DemandFinding extends ProductDemand {
  signal: DemandSignal;
}

export interface SignalOptions {
  /** A product needs at least this many views before a zero-sales verdict
   * is meaningful. Three views and no sale is noise, not a finding. */
  minViews?: number;
}

export function findDemandSignals(
  rows: ProductDemand[], opts: SignalOptions = {}
): DemandFinding[] {
  const { minViews = 10 } = opts;
  const viewMedian = median(rows.map((r) => r.views));
  const orderMedian = median(rows.map((r) => r.orders));
  const out: DemandFinding[] = [];

  for (const r of rows) {
    // Order matters: a product can look like several of these at once, and
    // the most actionable verdict should win. Restocking beats re-pricing.
    if (r.stockStatus === "out" && r.views >= Math.max(minViews, viewMedian)) {
      out.push({ ...r, signal: "lost_sales" });
    } else if (r.views >= Math.max(minViews, viewMedian) && r.orders === 0) {
      out.push({ ...r, signal: "views_no_sales" });
    } else if (r.orders > orderMedian && r.views < viewMedian) {
      out.push({ ...r, signal: "underexposed" });
    } else if (r.views < minViews && r.orders === 0) {
      out.push({ ...r, signal: "ignored" });
    }
  }
  return out;
}

export function signalsOf(findings: DemandFinding[], signal: DemandSignal): DemandFinding[] {
  return findings.filter((f) => f.signal === signal);
}

/* ---------------------------------------------------------------------------
 * Demand by category -- where attention goes, and where it converts.
 * ------------------------------------------------------------------------ */

export interface CategoryDemand {
  key: string;
  label: string;
  products: number;
  views: number;
  waClicks: number;
  orders: number;
  revenue: number;
  viewToOrder: number | null;
  /** Share of all views, 0..1 -- attention, not money. */
  viewShare: number;
}

export function demandByCategory(rows: ProductDemand[]): CategoryDemand[] {
  const buckets = new Map<string, ProductDemand[]>();
  for (const r of rows) {
    const k = r.categoryId || "none";
    const arr = buckets.get(k); if (arr) arr.push(r); else buckets.set(k, [r]);
  }
  const totalViews = rows.reduce((a, r) => a + r.views, 0);

  return [...buckets.entries()]
    .map(([key, rs]) => {
      const views = rs.reduce((a, r) => a + r.views, 0);
      const orders = rs.reduce((a, r) => a + r.orders, 0);
      return {
        key,
        label: rs[0].categoryName || "Uncategorised",
        products: rs.length,
        views,
        waClicks: rs.reduce((a, r) => a + r.waClicks, 0),
        orders,
        revenue: rs.reduce((a, r) => a + r.revenue, 0),
        viewToOrder: rate(orders, views),
        viewShare: totalViews > 0 ? views / totalViews : 0,
      };
    })
    .sort((a, b) => b.views - a.views);
}

/* ---------------------------------------------------------------------------
 * Catalog health -- the listing problems that suppress demand before any
 * shopper is involved.
 * ------------------------------------------------------------------------ */

export interface CatalogHealth {
  live: number;
  outOfStock: number;
  lowStock: number;
  pendingApproval: number;
  noImage: number;
  uncategorised: number;
  neverViewed: number;
}

export function computeCatalogHealth(rows: ProductDemand[]): CatalogHealth {
  return {
    live: rows.length,
    outOfStock: rows.filter((r) => r.stockStatus === "out").length,
    lowStock: rows.filter((r) => r.stockStatus === "low").length,
    pendingApproval: rows.filter((r) => r.status === "pending").length,
    noImage: rows.filter((r) => !r.hasImage).length,
    uncategorised: rows.filter((r) => !r.categoryId).length,
    neverViewed: rows.filter((r) => r.views === 0).length,
  };
}
