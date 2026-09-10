import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAnon } from "@/lib/supabase/anon";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CACHE_TAGS, CATALOG_REVALIDATE_SECONDS } from "@/lib/cache";
import type { Category, HeroSlide, OrderItem, Product, ProductReview, Promotion, Settings } from "@/lib/types";
import { shouldCount } from "@/lib/counterGuard";

/* ---------------------------------------------------------------------------
 * Request-level memoization.
 *
 * These reads were repeated several times within a single render:
 *   - getSettings() ran three times on a product page (generateMetadata,
 *     the root layout, and the page itself),
 *   - getLiveProducts() — a full, unbounded catalog scan — ran twice on
 *     /p/[slug]: once for the page and once more just to pick 4 related
 *     products,
 *   - getApprovedSellersById() ran in both the page and CatalogLayout.
 *
 * React's cache() collapses identical calls inside one request into a single
 * query. It is scoped to the request, so an admin edit is still visible on
 * the very next load — this is deduplication, not caching, and it changes no
 * behaviour beyond the number of round trips to Singapore.
 *
 * The uncached implementations below are function DECLARATIONS, which hoist,
 * so these consts may reference them before their definitions appear.
 * ------------------------------------------------------------------------ */
/* Two layers, doing different jobs:
 *
 *   unstable_cache(...)  persists ACROSS requests, keyed + tagged, so the
 *                        storefront stops hitting Postgres in Singapore for
 *                        every visitor. Invalidated by revalidateTag() in
 *                        the admin/seller write actions.
 *   cache(...)           dedupes WITHIN one request, so a page that calls
 *                        getSettings() three times still resolves once.
 *
 * The uncached implementations below are function DECLARATIONS, which hoist,
 * so these consts may reference them before their definitions appear. */
// Signature matches unstable_cache's own `Callback` type, which is
// intentionally loose; the exported consts below re-narrow it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function catalogCache<T extends (...args: any[]) => Promise<any>>(
  fn: T, key: string, tag: string
): T {
  return cache(
    unstable_cache(fn, [key], { tags: [tag], revalidate: CATALOG_REVALIDATE_SECONDS })
  ) as T;
}

export const getSettings = catalogCache(getSettingsUncached, "settings", CACHE_TAGS.settings);
export const getCategories = catalogCache(getCategoriesUncached, "categories", CACHE_TAGS.categories);
export const getLiveProducts = catalogCache(getLiveProductsUncached, "live-products", CACHE_TAGS.products);
export const getApprovedSellersById = catalogCache(getApprovedSellersByIdUncached, "sellers-by-id", CACHE_TAGS.sellers);
export const getHeroSlides = catalogCache(getHeroSlidesUncached, "hero-slides", CACHE_TAGS.hero);
export const getPromotions = catalogCache(getPromotionsUncached, "promotions", CACHE_TAGS.promotions);

/* Hard ceilings on the unbounded reads.
 *
 * None of these are reached by a store of this size today. They exist
 * because "SELECT everything, filter in JavaScript" has no failure mode
 * short of the function running out of memory or timing out -- and it does
 * that suddenly, in production, on the day the store finally gets busy.
 *
 * A cap turns that cliff into a documented, visible limit. The real fix,
 * when the catalog outgrows these, is keyset pagination on the catalog
 * routes and moving the aggregate queries into Postgres views -- both
 * bigger changes than are justified before the numbers demand them. */
const MAX_CATALOG_PRODUCTS = 2000;
const MAX_ORDERS_SCANNED = 5000;
const BEST_SELLER_WINDOW_DAYS = 120;

const DEFAULT_SETTINGS: Settings = {
  id: 0, // 0 signals "not configured yet"
  store_name: "Loja",
  tagline_tet: "", tagline_pt: "", tagline_en: "",
  wa_number: "", hours: "",
  municipality: "", post: "", suku: "", landmark: "",
  pickup: true, commission_rate: 10, seller_registration_enabled: true, banks: [], wallets: [], zones: [],
};

/** Never throws: a missing/unreachable settings row must not take the
 * whole site down. Callers check `settings.id === 0` to show the setup
 * banner (J4 — graceful degradation applies to config too).
 *
 * Explicit column list, not select("*") — the anon key only has grants
 * on these specific columns (totp_secret and friends are deliberately
 * excluded from anon, see supabase/schema.sql). A select("*") here would
 * ask for totp_secret too, get a permission error on the whole query,
 * and this function would wrongly report "not connected". */
async function getSettingsUncached(): Promise<Settings> {
  try {
    const sb = supabaseAnon();
    const { data, error } = await sb
      .from("settings")
      .select("id, store_name, tagline_tet, tagline_pt, tagline_en, wa_number, hours, municipality, post, suku, landmark, pickup, banks, wallets, zones, seller_registration_enabled")
      .eq("id", 1)
      .single();
    if (error || !data) return DEFAULT_SETTINGS;
    return data as Settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function getCategoriesUncached(): Promise<Category[]> {
  try {
    const sb = supabaseAnon();
    const { data } = await sb.from("categories").select("*").order("sort_order");
    return (data as Category[]) || [];
  } catch { return []; }
}

/* HOW MANY RATINGS A STORE PAGE READS, AND HOW MANY IT SHOWS.
 *
 * The average is computed over what comes back, so the cap is set far above
 * the ten that are rendered: a store's score should reflect its history,
 * not its last ten customers. Past this many the average is over the most
 * recent RATINGS_SCAN, which is the honest reading of a bounded query --
 * and the count shown is that same number, never a total the read did not
 * actually see. */
const RATINGS_SCAN = 500;
const RATINGS_SHOWN = 10;

async function getLiveProductsUncached(): Promise<Product[]> {
  try {
    const sb = supabaseAnon();
    const { data } = await sb
      .from("products")
      .select("*")
      .eq("archived", false)
      .eq("status", "approved") // Phase 1: a pending seller listing never shows publicly
      .order("created_at", { ascending: false })
      .limit(MAX_CATALOG_PRODUCTS);
    return (data as Product[]) || [];
  } catch { return []; }
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const sb = supabaseAnon();
  const { data } = await sb
    .from("products")
    .select("*")
    .eq("slug", slug)
    .eq("archived", false)
    .eq("status", "approved") // same rule for a direct/shared link, not just the catalog
    .maybeSingle();
  return (data as Product) || null;
}

/** The four products shown under a product, from the same category.
 *
 * An INDEXED query, not a filter over the catalog. This used to call
 * getLiveProducts() -- a read of up to MAX_CATALOG_PRODUCTS rows, with
 * their descriptions and image arrays -- and then keep four of them, on
 * every product page view. idx_products_live (see
 * supabase/patch-audit-hardening.sql) covers the archived/status half and
 * category_id narrows the rest.
 *
 * Empty rather than throwing: a product with no category, or a category
 * with nothing else in it, has no related products, and neither is an
 * error worth failing a product page over. */
export async function getRelatedProducts(
  categoryId: string | null, excludeId: string, limit = 4,
): Promise<Product[]> {
  if (!categoryId) return [];
  try {
    const sb = supabaseAnon();
    const { data } = await sb
      .from("products")
      .select("*")
      .eq("archived", false)
      .eq("status", "approved")
      .eq("category_id", categoryId)
      .neq("id", excludeId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as Product[]) || [];
  } catch { return []; }
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const sb = supabaseAnon();
  const { data } = await sb.from("categories").select("*").eq("slug", slug).maybeSingle();
  return (data as Category) || null;
}

/** Homepage "Best Sellers" — ranked by real units sold across completed
 * orders (never invented numbers). `orders` has no public SELECT policy
 * (buyer PII lives there), so this reads through the admin client, but
 * only ever returns plain Product rows — no order/buyer data leaves this
 * function. If a store is too new to have completed orders yet, or has
 * fewer than `limit` products with real sales, the list is topped up
 * with the most-viewed products (also a real, tracked signal — see
 * bumpView) so the section still has something to show; those top-up
 * items just aren't "confirmed" sellers for badge purposes. */
export async function getBestSellingProducts(
  limit = 6
): Promise<{ products: Product[]; confirmedIds: Set<string> }> {
  try {
    const [admin, products] = [supabaseAdmin(), await getLiveProductsUncached()];
    // Recent completed orders only. "Best selling" is a merchandising
    // signal, not an accounting figure -- what sold last quarter is a
    // better recommendation than an all-time tally, and it keeps this off
    // a path that grows without bound as the store succeeds.
    const since = new Date(Date.now() - BEST_SELLER_WINDOW_DAYS * 864e5).toISOString();

    /* UNITS PER PRODUCT, off the index where there is one.
     *
     * This used to read the `items` JSONB of every completed order in the
     * window and add the lines up in JavaScript -- a scan of the whole
     * marketplace to rank six products on the homepage. order_items is
     * indexed on product_id, so the same question is now a filtered read
     * of only the rows that can answer it.
     *
     * Still capped, and still a merchandising signal rather than an
     * accounting figure: what sold recently is a better recommendation
     * than an all-time tally, and it keeps this off a path that grows
     * without bound as the store succeeds. */
    const qtySold = new Map<string, number>();
    let counted = false;
    try {
      const { data: lines, error } = await admin
        .from("order_items")
        .select("product_id, qty, orders!inner(status)")
        .eq("orders.status", "completed")
        .gte("created_at", since)
        .limit(MAX_ORDERS_SCANNED * 4);   // lines, not orders
      if (!error) {
        for (const row of lines || []) {
          const id = row.product_id as string | null;
          if (!id) continue;
          qtySold.set(id, (qtySold.get(id) || 0) + (Number(row.qty) || 0));
        }
        counted = true;
      }
    } catch { /* falls through to the scan below */ }

    // The old scan, for a database that has not run
    // supabase/order-items.sql.
    if (!counted) {
      const { data: orders } = await admin
        .from("orders")
        .select("items")
        .eq("status", "completed")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(MAX_ORDERS_SCANNED);
      for (const o of orders || []) {
        for (const item of (o.items as OrderItem[]) || []) {
          qtySold.set(item.product_id, (qtySold.get(item.product_id) || 0) + item.qty);
        }
      }
    }

    const ranked = products
      .filter((p) => qtySold.has(p.id))
      .sort((a, b) => (qtySold.get(b.id) || 0) - (qtySold.get(a.id) || 0));
    const confirmedIds = new Set(ranked.map((p) => p.id));

    if (ranked.length >= limit) return { products: ranked.slice(0, limit), confirmedIds };

    const fillerIds = new Set(ranked.map((p) => p.id));
    const filler = products
      .filter((p) => !fillerIds.has(p.id))
      .sort((a, b) => (b.views || 0) - (a.views || 0));
    return { products: [...ranked, ...filler].slice(0, limit), confirmedIds };
  } catch {
    return { products: [], confirmedIds: new Set() };
  }
}

/** Fire-and-forget counters (Epic E4). These call SECURITY DEFINER
 * Postgres functions (see schema.sql) so an anonymous visitor can bump
 * a counter without getting general UPDATE rights on products.
 *
 * Deduplicated per caller per product -- see lib/counterGuard.ts. These
 * feed the homepage's best-sellers strip and the reorder planning, so
 * "anyone may add to this without limit" was a way to put a product on
 * the front page of the shop. */
export async function bumpView(productId: string) {
  if (!(await shouldCount("view", productId))) return;
  const sb = supabaseAnon();
  await sb.rpc("increment_views", { p_id: productId });
}
export async function bumpWaClick(productId: string) {
  if (!(await shouldCount("wa", productId))) return;
  const sb = supabaseAnon();
  await sb.rpc("increment_wa_clicks", { p_id: productId });
}

/** Homepage hero carousel slides. Deliberately isolated from getSettings()
 * and its own try/catch: if the hero_slides table hasn't been created yet
 * (see supabase/migration_hero_slides.sql), this just returns an empty
 * list and the homepage falls back to the default hero — it must never
 * take down the rest of the site's settings/data. */
/** Isolated with its own try/catch, same reasoning as getHeroSlides — a
 * missing/not-yet-migrated promotions table must never take down the
 * homepage around it. */
async function getPromotionsUncached(): Promise<Promotion[]> {
  try {
    const sb = supabaseAnon();
    const { data, error } = await sb.from("promotions").select("*")
      .eq("active", true).order("sort_order");
    if (error) return [];
    return (data as Promotion[]) || [];
  } catch {
    return [];
  }
}

async function getHeroSlidesUncached(): Promise<HeroSlide[]> {
  try {
    const sb = supabaseAnon();
    const { data, error } = await sb.from("hero_slides").select("*").order("sort_order");
    if (error) return [];
    return (data as HeroSlide[]) || [];
  } catch {
    return [];
  }
}

export interface PublicSeller {
  id: string;
  store_name: string;
  slug: string;
  description: string;
  city: string;
  country: string;
}

/** Map of seller id -> public storefront info, for "Sold by X" on cards
 * and the product detail page. Only approved sellers ever come back (see
 * the sellers_public_read RLS policy) — a product whose seller_id points
 * at the platform owner (no sellers row at all) or a not-yet-approved
 * seller simply won't have an entry, and callers should treat that as
 * "don't show a Sold-by line" rather than an error. Isolated with its
 * own try/catch for the same reason as getHeroSlides() — this must never
 * take down a catalog page. */
async function getApprovedSellersByIdUncached(): Promise<Record<string, PublicSeller>> {
  try {
    const sb = supabaseAnon();
    const { data, error } = await sb
      .from("sellers")
      .select("id, store_name, slug, description, city, country");
    if (error || !data) return {};
    return Object.fromEntries((data as PublicSeller[]).map((s) => [s.id, s]));
  } catch {
    return {};
  }
}

export async function getSellerBySlug(slug: string): Promise<PublicSeller | null> {
  try {
    const sb = supabaseAnon();
    const { data } = await sb
      .from("sellers")
      .select("id, store_name, slug, description, city, country")
      .eq("slug", slug)
      .maybeSingle();
    return (data as PublicSeller) || null;
  } catch {
    return null;
  }
}

export interface SellerReview {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
}

/** Average + count for the star display, and the most recent reviews
 * (comment optional — a plain star rating with no text is common and
 * still counts). Isolated with its own try/catch, same as every other
 * public fetcher here — a ratings hiccup must never take down the
 * storefront page around it. */
export async function getSellerRatings(sellerId: string): Promise<{
  average: number; count: number; reviews: SellerReview[];
}> {
  try {
    const sb = supabaseAnon();
    const { data } = await sb
      .from("seller_ratings")
      .select("id, rating, comment, created_at")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false })
      // Bounded. This read fetched EVERY rating a seller had ever received
      // in order to show ten of them and average the rest -- so a store with
      // a few thousand reviews pulled a few thousand rows, with their
      // comments, on every page load. See RATINGS_SCAN.
      .limit(RATINGS_SCAN);
    const reviews = (data as SellerReview[]) || [];
    const count = reviews.length;
    const average = count ? reviews.reduce((a, r) => a + r.rating, 0) / count : 0;
    return { average, count, reviews: reviews.slice(0, RATINGS_SHOWN) };
  } catch {
    return { average: 0, count: 0, reviews: [] };
  }
}

/** Reviews for one product, newest first. Public by design (that is the
 * point of a review); buyer_phone never leaves the database -- the anon
 * column grant in marketplace-v2.sql excludes it, so it is not even
 * requestable from here.
 *
 * The star average shown next to a product does NOT come from this function:
 * it comes from the denormalised rating_sum/rating_count columns already on
 * the product row, so a grid of 24 cards costs zero extra queries. This is
 * only for the review list on a product page. */
export async function getProductReviews(productId: string, limit = 20): Promise<ProductReview[]> {
  try {
    const sb = supabaseAnon();
    const { data, error } = await sb
      .from("product_reviews")
      .select("id, product_id, order_id, buyer_name, rating, comment, created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data as ProductReview[]) || [];
  } catch {
    return [];
  }
}
