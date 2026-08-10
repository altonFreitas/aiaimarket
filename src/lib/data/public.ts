import { supabaseServer } from "@/lib/supabase/server";
import type { Category, Product, Settings } from "@/lib/types";

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
    .maybeSingle();
  return (data as Product) || null;
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const sb = await supabaseServer();
  const { data } = await sb.from("categories").select("*").eq("slug", slug).maybeSingle();
  return (data as Category) || null;
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
