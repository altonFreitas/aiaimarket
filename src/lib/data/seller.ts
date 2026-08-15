import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasSellerTotpSession } from "@/lib/sellerTotpSession";
import type { Order, OrderItem, Product, Seller } from "@/lib/types";

/** Used at the top of every /seller/* page (except register): resolves
 * the logged-in seller's own row, or sends them back to the unified
 * /account entry point (see app/account/page.tsx — logging in there as
 * a seller redirects straight back to the dashboard, so this is a
 * clean round trip, not a dead end). proxy.ts already keeps a logged-
 * out visitor away from /seller/*; this covers the edge case of a
 * valid Supabase session with no matching sellers row.
 *
 * Also enforces 2FA at the page level, same rule as requireSeller() in
 * lib/actions/guard.ts for server actions — without this, a seller with
 * 2FA enabled could still load their dashboard/products/orders pages
 * (just not successfully submit anything on them) despite never having
 * entered a TOTP code. */
export async function getCurrentSellerOrRedirect(): Promise<Seller> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/account");

  const admin = supabaseAdmin();
  const { data: seller } = await admin.from("sellers").select("*").eq("user_id", user.id).maybeSingle();
  if (!seller) redirect("/account");

  if (seller.totp_enabled) {
    const ok = await hasSellerTotpSession(seller.id);
    if (!ok) redirect("/account");
  }

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

export interface SellerOrderView {
  id: string;
  ref: string;
  buyer_name: string;
  buyer_phone: string;
  mode: "delivery" | "pickup";
  address_line: string | null;
  municipality: string | null;
  post: string | null;
  suku: string | null;
  aldeia: string | null;
  landmark: string | null;
  status: Order["status"];
  created_at: string;
  /** Only this seller's line items — never another seller's, even if
   * the buyer's cart mixed products from several sellers in one order. */
  myItems: OrderItem[];
  mySubtotal: number;
  /** True only when every item in the order (not just myItems) belongs
   * to this seller — the seller can change status only when this is
   * true (see setOrderStatusAsSeller), since order.status is one column
   * shared by the whole order and a mixed-seller order's status isn't
   * this seller's to set alone. */
  allItemsMine: boolean;
}

/** Every order that contains at least one of this seller's products,
 * reduced down to just their own items + the buyer/delivery info needed
 * to fulfil their part — never another seller's items, and never the
 * full unrelated order total. Small dataset (a local marketplace), so a
 * full scan + in-memory filter is fine, same "no pagination needed yet"
 * approach used elsewhere in this app (e.g. category product counts). */
export async function getSellerOrders(sellerId: string): Promise<SellerOrderView[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("orders").select("*").order("created_at", { ascending: false });
  const orders = (data as Order[]) || [];

  const views: SellerOrderView[] = [];
  for (const o of orders) {
    const allItems = o.items || [];
    const myItems = allItems.filter((i) => i.seller_id === sellerId);
    if (!myItems.length) continue;
    views.push({
      id: o.id, ref: o.ref, buyer_name: o.buyer_name, buyer_phone: o.buyer_phone,
      mode: o.mode, address_line: o.address_line, municipality: o.municipality,
      post: o.post, suku: o.suku, aldeia: o.aldeia, landmark: o.landmark,
      status: o.status, created_at: o.created_at,
      myItems, mySubtotal: myItems.reduce((a, i) => a + i.price * i.qty, 0),
      allItemsMine: allItems.every((i) => i.seller_id === sellerId),
    });
  }
  return views;
}

export interface SellerEarnings {
  commissionRatePercent: number;
  completedOrderCount: number;
  grossSales: number;
  commission: number;
  earnings: number;
}

/** A seller's own commission_rate overrides the platform default
 * (settings.commission_rate) when set — same "override falls back to
 * platform default" pattern used for delivery zones elsewhere. Only
 * completed orders count toward realized earnings; a pending/new order
 * is a possible future sale, not yet a real one. */
export function computeSellerEarnings(
  orders: SellerOrderView[],
  seller: Seller,
  platformCommissionRate: number
): SellerEarnings {
  const commissionRatePercent = seller.commission_rate ?? platformCommissionRate;
  const completed = orders.filter((o) => o.status === "completed");
  const grossSales = completed.reduce((a, o) => a + o.mySubtotal, 0);
  const commission = grossSales * (commissionRatePercent / 100);
  return {
    commissionRatePercent,
    completedOrderCount: completed.length,
    grossSales,
    commission,
    earnings: grossSales - commission,
  };
}
