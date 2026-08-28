import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasSellerTotpSession } from "@/lib/sellerTotpSession";
import type { Order, OrderItem, Product, Seller, SellerPayout } from "@/lib/types";

const MAX_SELLER_ORDER_SCAN = 5000;

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
  // There is no orders->seller index to query on: a seller's items live
  // inside the order's `items` JSONB, so finding "orders containing this
  // seller" means scanning and filtering in memory. Bounded to the most
  // recent slice rather than the whole table; the real fix is an
  // order_items table (or a GIN index on items) when this becomes the
  // bottleneck.
  const { data } = await sb.from("orders").select("*")
    .order("created_at", { ascending: false }).limit(MAX_SELLER_ORDER_SCAN);
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
      myItems: myItems.map(stripCost),
      mySubtotal: myItems.reduce((a, i) => a + i.price * i.qty, 0),
      allItemsMine: allItems.every((i) => i.seller_id === sellerId),
    });
  }
  return views;
}

/** Drop the platform's purchase cost from a line before it leaves the
 * server for a seller's screen. The order row carries it (see
 * OrderItem.cost) and every other field here is legitimately the seller's,
 * so the safe move is to remove the one field that is not -- at the single
 * point where seller-facing data is assembled, rather than trusting each
 * component not to render it. */
function stripCost(item: OrderItem): OrderItem {
  if (item.cost == null) return item;
  const { cost: _cost, ...rest } = item;
  return rest;
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

/** Payouts already made to one seller, newest first. Returns [] rather than
 * throwing when supabase/marketplace-v2.sql hasn't been run — the dashboard
 * then simply shows nothing paid out yet, which is the truth for a store
 * that has no payout table. */
export async function getSellerPayouts(sellerId: string): Promise<SellerPayout[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("seller_payouts")
      .select("*")
      .eq("seller_id", sellerId)
      .order("paid_at", { ascending: false });
    if (error) return [];
    return (data as SellerPayout[]) || [];
  } catch {
    return [];
  }
}

export interface SellerLedger extends SellerEarnings {
  /** Sum of every payout recorded against this seller. */
  paidOut: number;
  /** What the platform still owes: net earnings minus payouts. Derived, never
   * stored — see the note on seller_payouts in marketplace-v2.sql. */
  outstanding: number;
}

/** Earnings and payouts reconciled into the one number a seller and the
 * platform actually argue about: what is still owed.
 *
 * `outstanding` is allowed to go negative, and deliberately isn't clamped to
 * zero. A negative balance means more has been paid out than completed orders
 * justify — an advance, a double payment, or a mistake. Hiding it behind a
 * max(0, …) would make exactly the error worth noticing invisible. */
export function computeSellerLedger(
  earnings: SellerEarnings,
  payouts: SellerPayout[]
): SellerLedger {
  const paidOut = payouts.reduce((a, p) => a + Number(p.amount), 0);
  return { ...earnings, paidOut, outstanding: earnings.earnings - paidOut };
}
