/* What each seller has been given access to.
 *
 * The owner runs a marketplace and has, for their own business, a set of
 * tools they built for themselves: a sales dashboard, stock alerts,
 * purchasing. A seller renting a shop inside that marketplace starts with
 * the four screens that make them a seller at all, and can be given more
 * -- because they asked, because they pay for it, or because the owner
 * decided their store is big enough to need it.
 *
 * This is the list of what can be given, and the two predicates that
 * answer "may this seller open that". It is deliberately the same shape
 * as lib/adminSections.ts, which does the same job for staff accounts:
 * one map drives the seller's navigation, the checklist on the Sellers
 * screen, and the lock on each page. Three copies of "which pages are
 * Sales" would be three chances to disagree.
 *
 * INCLUDED vs SELLABLE.
 *
 * Four screens are not a feature and never appear as a checkbox:
 * the dashboard, products, orders and store settings. A seller who cannot
 * list a product or see an order is not a seller with fewer features, it
 * is a broken account -- so they are held by everyone, the way `home` is
 * for staff. Everything else is a choice the owner makes per store.
 *
 * No server-only import: the nav is a client component and the page guard
 * is a server one, and both need this. Nothing here reads a session or a
 * database -- it is a map and three predicates. */

export type SellerFeatureKey =
  | "dashboard" | "products" | "orders" | "settings"
  | "sales" | "stock";

export interface SellerFeature {
  key: SellerFeatureKey;
  /** i18n key for the name in the nav and the checklist. */
  labelKey: string;
  /** i18n key for the one line under the checkbox saying what the store
   * actually gets. The owner is selling this; they should not have to
   * open the app as the seller to remember what it is. */
  blurbKey: string;
  /** Every seller route that belongs to this feature, including detail
   * routes that never appear in the navigation. Matched on segment
   * boundaries, longest first -- see featureForPath. */
  paths: string[];
  /** True for the ones that are simply part of being a seller. */
  included?: boolean;
}

/* Order matters only for display: this is the order the nav and the
 * checklist present them in. */
export const SELLER_FEATURES: readonly SellerFeature[] = [
  {
    key: "dashboard", labelKey: "sellerDashboard", blurbKey: "featSellerDashboardBlurb",
    // /seller/no-access is the screen shown to somebody refused elsewhere,
    // so it lives in the one feature every seller holds.
    paths: ["/seller/dashboard", "/seller/no-access"], included: true,
  },
  {
    key: "products", labelKey: "sellerProducts", blurbKey: "featSellerProductsBlurb",
    paths: ["/seller/products"], included: true,
  },
  {
    key: "orders", labelKey: "sellerOrders", blurbKey: "featSellerOrdersBlurb",
    paths: ["/seller/orders"], included: true,
  },
  {
    key: "settings", labelKey: "sellerSettings", blurbKey: "featSellerSettingsBlurb",
    paths: ["/seller/settings"], included: true,
  },
  {
    key: "sales", labelKey: "sellerSales", blurbKey: "featSellerSalesBlurb",
    paths: ["/seller/sales"],
  },
  {
    key: "stock", labelKey: "sellerStock", blurbKey: "featSellerStockBlurb",
    paths: ["/seller/stock"],
  },
] as const;

/** Part of being a seller. Held by every approved store, never a checkbox. */
export const INCLUDED_FEATURES: readonly SellerFeatureKey[] =
  SELLER_FEATURES.filter((f) => f.included).map((f) => f.key);

/** What the owner can actually offer: the checklist on the Sellers screen. */
export const SELLABLE_FEATURES: readonly SellerFeatureKey[] =
  SELLER_FEATURES.filter((f) => !f.included).map((f) => f.key);

export const ALL_FEATURES: readonly SellerFeatureKey[] = SELLER_FEATURES.map((f) => f.key);

/** Does `path` sit inside `base`?
 *
 * Segment-aware on purpose. A plain startsWith would put /seller/salesman
 * inside /seller/sales, and there is no reason to leave that trap lying
 * around for whoever adds the next route. */
function within(path: string, base: string): boolean {
  return path === base || path.startsWith(base + "/");
}

/** Which feature a seller path belongs to, or null if it is not one.
 *
 * Longest match wins, so a future /seller/products/insights would resolve
 * to whichever feature claims the longer prefix rather than to whichever
 * happens to be listed first. */
export function featureForPath(path: string): SellerFeatureKey | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: { key: SellerFeatureKey; length: number } | null = null;
  for (const feature of SELLER_FEATURES) {
    for (const base of feature.paths) {
      if (within(clean, base) && (!best || base.length > best.length)) {
        best = { key: feature.key, length: base.length };
      }
    }
  }
  return best?.key ?? null;
}

/** May this store open that part of the app?
 *
 * The included four are held by everyone. Everything else has to have been
 * ticked for this store specifically -- there is no "all sellers get it"
 * switch, because the whole point is that stores differ. */
export function sellerCanUse(
  features: readonly string[], key: SellerFeatureKey
): boolean {
  if (INCLUDED_FEATURES.includes(key)) return true;
  return features.includes(key);
}

/** Normalises whatever came out of the database into feature keys we
 * recognise.
 *
 * Fails closed twice over. A column that is not there yet -- on a shop
 * with this code and not yet supabase/seller-features.sql -- arrives as
 * undefined and reads as "nothing extra granted", which is exactly right:
 * every sellable feature is a new screen that store never had. And a key
 * left over from a feature the app has since dropped is discarded rather
 * than carried around looking like a granted permission. */
export function normalizeFeatures(value: unknown): SellerFeatureKey[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(SELLABLE_FEATURES);
  const out: SellerFeatureKey[] = [];
  for (const v of value) {
    if (typeof v === "string" && known.has(v) && !out.includes(v as SellerFeatureKey)) {
      out.push(v as SellerFeatureKey);
    }
  }
  // Stored in the order the catalogue lists them, not the order they were
  // clicked, so two stores with the same access read identically on screen
  // and in the database.
  return SELLABLE_FEATURES.filter((k) => out.includes(k));
}

/** "Sales, Stock" / "Nothing extra" -- the one-line version for a row. */
export function featureSummary(
  features: readonly string[], label: (key: string) => string,
  none: string, all: string
): string {
  const granted = SELLER_FEATURES.filter(
    (f) => !f.included && features.includes(f.key)
  );
  if (!granted.length) return none;
  if (granted.length === SELLABLE_FEATURES.length) return all;
  return granted.map((f) => label(f.labelKey)).join(", ");
}
