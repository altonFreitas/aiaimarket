import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Product, Seller } from "@/lib/types";

/** Used at the top of every /seller/* page (except login/register):
 * resolves the logged-in seller's own row, or sends them back to login.
 * proxy.ts already keeps a logged-out visitor away from /seller/*; this
 * covers the edge case of a valid Supabase session with no matching
 * sellers row. */
export async function getCurrentSellerOrRedirect(): Promise<Seller> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/seller/login");

  const admin = supabaseAdmin();
  const { data: seller } = await admin.from("sellers").select("*").eq("user_id", user.id).maybeSingle();
  if (!seller) redirect("/seller/login");
  return seller as Seller;
}

export async function getSellerProducts(sellerId: string): Promise<Product[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("products")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });
  return (data as Product[]) || [];
}

/** Ownership-checked single-product fetch for the seller's own edit page
 * -- returns null (not the product) if it belongs to someone else, so
 * the page can 404/redirect instead of ever rendering another seller's
 * data into a form. */
export async function getOwnSellerProduct(sellerId: string, productId: string): Promise<Product | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("products").select("*").eq("id", productId).maybeSingle();
  if (!data || data.seller_id !== sellerId) return null;
  return data as Product;
}
