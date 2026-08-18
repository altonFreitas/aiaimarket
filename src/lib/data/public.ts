import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Category, HeroSlide, OrderItem, Product, Settings } from "@/lib/types";

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
export const getSettings = cache(getSettingsUncached);
export const getCategories = cache(getCategoriesUncached);
export const getLiveProducts = cache(getLiveProductsUncached);
export const getApprovedSellersById = cache(getApprovedSellersByIdUncached);
export const getHeroSlides = cache(getHeroSlidesUncached);

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
    const sb = await supabaseServer();
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
    const sb = await supabaseServer();
    const { data } = await sb.from("categories").select("*").order("sort_order");
    return (data as Category[]) || [];
  } catch { return []; }
}

async function getLiveProductsUncached(): Promise<Product[]> {
  try {
    const sb = await supabaseServer();
    const { data } = await sb
      .from("products")
      .select("*")
      .eq("archived", false)
      .eq("status", "approved") // Phase 1: a pending seller listing never shows publicly
      .order("created_at", { ascending: false });
    return (data as Product[]) || [];
  } catch { return []; }
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const sb = await supabaseServer();
  const { data } = await sb
    .from("products")
    .select("*")
    .eq("slug", slug)
    .eq("archived", false)
    .eq("status", "approved") // same rule for a direct/shared link, not just the catalog
    .maybeSingle();
  return (data as Product) || null;
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const sb = await supabaseServer();
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
    const { data: orders } = await admin.from("orders").select("items").eq("status", "completed");

    const qtySold = new Map<string, number>();
    for (const o of orders || []) {
      for (const item of (o.items as OrderItem[]) || []) {
        qtySold.set(item.product_id, (qtySold.get(item.product_id) || 0) + item.qty);
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
 * a counter without getting general UPDATE rights on products. */
export async function bumpView(productId: string) {
  const sb = await supabaseServer();
  await sb.rpc("increment_views", { p_id: productId });
}
export async function bumpWaClick(productId: string) {
  const sb = await supabaseServer();
  await sb.rpc("increment_wa_clicks", { p_id: productId });
}

/** Homepage hero carousel slides. Deliberately isolated from getSettings()
 * and its own try/catch: if the hero_slides table hasn't been created yet
 * (see supabase/migration_hero_slides.sql), this just returns an empty
 * list and the homepage falls back to the default hero — it must never
 * take down the rest of the site's settings/data. */
async function getHeroSlidesUncached(): Promise<HeroSlide[]> {
  try {
    const sb = await supabaseServer();
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
    const sb = await supabaseServer();
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
    const sb = await supabaseServer();
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
    const sb = await supabaseServer();
    const { data } = await sb
      .from("seller_ratings")
      .select("id, rating, comment, created_at")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });
    const reviews = (data as SellerReview[]) || [];
    const count = reviews.length;
    const average = count ? reviews.reduce((a, r) => a + r.rating, 0) / count : 0;
    return { average, count, reviews: reviews.slice(0, 10) };
  } catch {
    return { average: 0, count: 0, reviews: [] };
  }
}
