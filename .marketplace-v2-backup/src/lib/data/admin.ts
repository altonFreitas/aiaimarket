import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Category, HeroSlide, Order, Product, Promotion, Seller } from "@/lib/types";

/* Same reasoning as the caps in lib/data/public.ts: the admin statistics
 * and Excel export genuinely want "everything", but an unbounded read is
 * one busy year away from timing out the page that shows you how the busy
 * year went. Raise these when the numbers approach them. */
const MAX_ADMIN_ORDERS = 10000;
const MAX_ADMIN_PRODUCTS = 5000;

export async function adminProducts(): Promise<Product[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("products").select("*")
    .order("created_at", { ascending: false }).limit(MAX_ADMIN_PRODUCTS);
  return (data as Product[]) || [];
}
export async function adminProduct(id: string): Promise<Product | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("products").select("*").eq("id", id).maybeSingle();
  return (data as Product) || null;
}
export async function adminCategories(): Promise<Category[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("categories").select("*").order("sort_order");
  return (data as Category[]) || [];
}
/** Same "never break the admin page" caution as getHeroSlides() in
 * lib/data/public.ts — if the migration hasn't been run yet, show an
 * empty list rather than a crashed admin page. */
export async function adminHeroSlides(): Promise<HeroSlide[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("hero_slides").select("*").order("sort_order");
    if (error) return [];
    return (data as HeroSlide[]) || [];
  } catch {
    return [];
  }
}
/** Same "table might not be migrated yet" caution as adminHeroSlides. */
export async function adminPromotions(): Promise<Promotion[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("promotions").select("*").order("sort_order");
    if (error) return [];
    return (data as Promotion[]) || [];
  } catch {
    return [];
  }
}
export async function adminOrders(): Promise<Order[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("orders").select("*")
    .order("created_at", { ascending: false }).limit(MAX_ADMIN_ORDERS);
  return (data as Order[]) || [];
}
/** Orders plus the "how many arrived today" figure.
 *
 * The count used to be computed inside the OrdersAdmin component with
 * Date.now(). Reading a clock during render makes a component
 * non-deterministic — React may re-render at any moment and get a different
 * answer — and it used the ADMIN'S OWN device clock, so a skewed laptop
 * showed a different "today" than the store's data. Computing it here, in
 * a plain data function on the server, fixes both. */
export async function adminOrdersView(): Promise<{ orders: Order[]; ordersToday: number }> {
  const orders = await adminOrders();
  const dayAgo = Date.now() - 864e5;
  const ordersToday = orders.filter((o) => new Date(o.created_at).getTime() > dayAgo).length;
  return { orders, ordersToday };
}

export async function adminOrder(id: string): Promise<Order | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("orders").select("*, order_log(*)").eq("id", id).maybeSingle();
  if (data?.order_log) data.order_log.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
  return (data as Order) || null;
}
export async function adminSettings() {
  const sb = supabaseAdmin();
  const { data } = await sb.from("settings").select("*").eq("id", 1).single();
  return data;
}

export async function adminStats() {
  const [orders, products] = await Promise.all([adminOrders(), adminProducts()]);
  const { computeAdminStats } = await import("@/lib/stats");
  return computeAdminStats(orders, products);
}

export async function adminSellers(): Promise<Seller[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("sellers").select("*").order("created_at", { ascending: false });
  return (data as Seller[]) || [];
}
