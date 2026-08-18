import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Category, HeroSlide, Order, Product, Seller } from "@/lib/types";

export async function adminProducts(): Promise<Product[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("products").select("*").order("created_at", { ascending: false });
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
export async function adminOrders(): Promise<Order[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("orders").select("*").order("created_at", { ascending: false });
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
