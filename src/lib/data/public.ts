import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Category, HeroSlide, OrderItem, Product, Settings } from "@/lib/types";

const DEFAULT_SETTINGS: Settings = {
  id: 0, // 0 signals "not configured yet"
  store_name: "Loja",
  tagline_tet: "", tagline_pt: "", tagline_en: "",
  wa_number: "", hours: "",
  municipality: "", post: "", suku: "", landmark: "",
  pickup: true, banks: [], wallets: [], zones: [],
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
export async function getSettings(): Promise<Settings> {
  try {
    const sb = await supabaseServer();
    const { data, error } = await sb
      .from("settings")
      .select("id, store_name, tagline_tet, tagline_pt, tagline_en, wa_number, hours, municipality, post, suku, landmark, pickup, banks, wallets, zones")
      .eq("id", 1)
      .single();
    if (error || !data) return DEFAULT_SETTINGS;
    return data as Settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function getCategories(): Promise<Category[]> {
  try {
    const sb = await supabaseServer();
    const { data } = await sb.from("categories").select("*").order("sort_order");
    return (data as Category[]) || [];
  } catch { return []; }
}

export async function getLiveProducts(): Promise<Product[]> {
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
    const [admin, products] = [supabaseAdmin(), await getLiveProducts()];
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
export async function getHeroSlides(): Promise<HeroSlide[]> {
  try {
    const sb = await supabaseServer();
    const { data, error } = await sb.from("hero_slides").select("*").order("sort_order");
    if (error) return [];
    return (data as HeroSlide[]) || [];
  } catch {
    return [];
  }
}
