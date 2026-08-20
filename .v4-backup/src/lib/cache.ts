/** Cache tag vocabulary.
 *
 * The catalog reads in lib/data/public.ts are wrapped in `unstable_cache`
 * and tagged with these; the admin/seller write actions call
 * `revalidateTag` with the same constants. Naming them in one place is what
 * stops the classic failure where a write invalidates "products" while the
 * read was tagged "product" and the storefront quietly serves stale data
 * until the next deploy.
 *
 * Why cache at all when React `cache()` was already added: that only
 * deduplicates within ONE request. This layer persists across requests, so
 * a catalog page stops making a round trip to Postgres in Singapore for
 * every visitor. For buyers on mobile data in Timor-Leste that round trip
 * is the single largest component of time-to-first-byte.
 *
 * Deliberately NOT cached: anything order-, payment-, seller-dashboard- or
 * admin-scoped. Those are per-session and must always be live.
 */
export const CACHE_TAGS = {
  products: "catalog:products",
  categories: "catalog:categories",
  settings: "catalog:settings",
  sellers: "catalog:sellers",
  hero: "catalog:hero",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

/** Everything a product/category/settings edit could possibly affect.
 * Admin writes already call revalidatePath("/", "layout"); this adds the
 * data-layer half, which paths alone cannot reach. */
export const ALL_CATALOG_TAGS: CacheTag[] = Object.values(CACHE_TAGS);

/** How long a catalog read may be served from cache before it is refetched
 * even if nothing explicitly invalidated it. A safety net for the case
 * where a write path forgets to revalidate -- five minutes of staleness on
 * a product listing is survivable; permanent staleness is not. */
export const CATALOG_REVALIDATE_SECONDS = 300;
