import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Category, Order, Product } from "@/lib/types";

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
export async function adminOrders(): Promise<Order[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("orders").select("*").order("created_at", { ascending: false });
  return (data as Order[]) || [];
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
