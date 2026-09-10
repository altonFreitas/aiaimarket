/* WRAPPED IN React cache(): deduped for the length of ONE request.
 *
 * The Home page reads the order book twice -- once for the to-do list and
 * once for the sales-against-purchases overview -- and each of those is a
 * few thousand rows. Without this the page did the work twice on every
 * load. cache() makes the second call return the first one's promise, so
 * the two callers can each ask for what they need without either having to
 * know the other exists. Nothing is held between requests. */
import "server-only";
import { cache } from "react";
import {
  normalizeRole, normalizeSections, type AdminRole, type SectionKey,
} from "@/lib/adminSections";
import { readCapped, type Capped } from "./capped";
import { loveTotals, type LoveTotals } from "@/lib/loves";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Category, HeroSlide, Order, OrderNotification, Product, Promotion, Seller, SellerPayout, OrderReturn } from "@/lib/types";
import { withFreshProofUrl } from "@/lib/paymentProof";

/* Same reasoning as the caps in lib/data/public.ts: the admin statistics
 * and Excel export genuinely want "everything", but an unbounded read is
 * one busy year away from timing out the page that shows you how the busy
 * year went. Raise these when the numbers approach them. */
const MAX_ADMIN_ORDERS = 10000;
const MAX_ADMIN_PRODUCTS = 5000;
const MAX_ADMIN_PAYOUTS = 5000;
const MAX_ADMIN_NOTIFICATIONS = 500;

export const adminProducts = cache(async (): Promise<Product[]> => {
  const sb = supabaseAdmin();
  const { data } = await sb.from("products").select("*")
    .order("created_at", { ascending: false }).limit(MAX_ADMIN_PRODUCTS);
  return (data as Product[]) || [];
});
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
/** The order book, newest first, capped -- and honest about the cap.
 *
 * Callers that only want the rows use adminOrders(); anything that PRESENTS
 * these numbers as a total should use this and say so, because the rows
 * that fall off the end are the oldest ones. */
export const adminOrdersCapped = cache(async (): Promise<Capped<Order>> => {
  const sb = supabaseAdmin();
  return readCapped<Order>(MAX_ADMIN_ORDERS, async (limit) => {
    const { data } = await sb.from("orders").select("*")
      .order("created_at", { ascending: false }).limit(limit);
    return data as Order[] | null;
  });
});

export async function adminOrders(): Promise<Order[]> {
  return (await adminOrdersCapped()).rows;
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
  // Minted for this viewing rather than read off the row -- see
  // lib/paymentProof.ts.
  return await withFreshProofUrl((data as Order) || null);
}
/* THE REVIEWS, FOR SOMEBODY WHO CAN ACT ON THEM.
 *
 * Both tables are public-facing free text written by anyone holding an
 * order ref and the phone it was placed with. That check is a good one --
 * it proves a purchase -- but it says nothing about what somebody then
 * types, and until this existed the only way to take an abusive, mistaken
 * or defamatory review off a product page was to open the SQL editor.
 *
 * Newest first and capped, like every other admin read here: moderation
 * is a "what has come in lately" job, and the page that lists everything
 * ever written is the page nobody opens.
 *
 * Read through the admin client because product_reviews and seller_ratings
 * both revoke plain SELECT from anon (buyer_phone lives in one of them) --
 * and buyer_phone is deliberately NOT selected even here: a moderator
 * decides about a comment, not about a person. */
const MAX_ADMIN_REVIEWS = 500;

export interface AdminProductReview {
  id: string;
  product_id: string;
  order_id: string | null;
  buyer_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

export interface AdminSellerRating {
  id: string;
  seller_id: string;
  order_id: string | null;
  rating: number;
  comment: string;
  created_at: string;
}

export async function adminProductReviews(): Promise<AdminProductReview[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("product_reviews")
      .select("id, product_id, order_id, buyer_name, rating, comment, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_ADMIN_REVIEWS);
    // A shop that has not run supabase/marketplace-v2.sql has no such
    // table. An empty list and a working screen, not a crash.
    if (error) return [];
    return (data as AdminProductReview[]) || [];
  } catch { return []; }
}

export async function adminSellerRatings(): Promise<AdminSellerRating[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("seller_ratings")
      .select("id, seller_id, order_id, rating, comment, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_ADMIN_REVIEWS);
    if (error) return [];
    return (data as AdminSellerRating[]) || [];
  } catch { return []; }
}

export async function adminSettings() {
  const sb = supabaseAdmin();
  const { data } = await sb.from("settings").select("*").eq("id", 1).single();
  return data;
}

export async function adminSellers(): Promise<Seller[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("sellers").select("*").order("created_at", { ascending: false });
  return (data as Seller[]) || [];
}

/** The invitation links, newest first.
 *
 * THE TOKEN IS NOT SELECTED. This feeds a client component, so anything
 * named here is serialized into the page and sits in the browser. The link
 * is handed back once, by the action that mints it, at the moment the
 * owner asks for it -- a list that re-displayed every live token would
 * turn one screenshot of the Sellers screen into every open invitation.
 * Revoking works on the id, which is not a secret. */
export interface SellerInviteRow {
  id: string;
  note: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  used_by: string | null;
}

export async function adminSellerInvites(): Promise<SellerInviteRow[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("seller_invites")
      .select("id, note, created_by, created_at, expires_at, used_at, revoked_at, used_by")
      .order("created_at", { ascending: false })
      .limit(100);
    // Same caution as adminHeroSlides: a shop that has this code and has
    // not run supabase/seller-invites.sql gets an empty list and a working
    // Sellers screen, not a crash.
    if (error) return [];
    return (data as SellerInviteRow[]) || [];
  } catch { return []; }
}

export interface SellerLedgerRow {
  seller: Seller;
  commissionRatePercent: number;
  completedOrderCount: number;
  grossSales: number;
  commission: number;
  earnings: number;
  paidOut: number;
  outstanding: number;
  lastPaidAt: string | null;
}

/** Every seller's earnings reconciled against every payout, for the admin
 * payouts screen.
 *
 * Written as one pass over orders and one pass over payouts rather than
 * calling getSellerOrders() per seller: that helper re-scans the whole orders
 * table each time it is called, so using it here would turn one table scan
 * into one scan per seller — the classic N+1 that only shows up once the
 * marketplace has enough sellers to matter.
 *
 * Returns [] for the payout half rather than throwing when
 * marketplace-v2.sql hasn't been run: the page then shows real earnings with
 * nothing paid out, which is exactly what a store without a payout table
 * knows to be true. */
export async function adminSellerLedgers(): Promise<SellerLedgerRow[]> {
  const [sellers, orders, settings] = await Promise.all([
    adminSellers(), adminOrders(), adminSettings(),
  ]);

  let payouts: SellerPayout[] = [];
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("seller_payouts").select("*");
    if (!error) payouts = (data as SellerPayout[]) || [];
  } catch { /* table not migrated yet — treated as "nothing paid out" */ }

  const grossBySeller = new Map<string, number>();
  const commissionBySeller = new Map<string, number>();
  const ordersBySeller = new Map<string, Set<string>>();
  const rateOf = (id: string) =>
    sellers.find((x) => x.id === id)?.commission_rate
      ?? Number(settings?.commission_rate ?? 10);
  for (const o of orders) {
    if (o.status !== "completed") continue;
    for (const item of o.items || []) {
      if (!item.seller_id) continue; // the platform's own catalog, not a seller's
      const gross = item.price * item.qty;
      grossBySeller.set(item.seller_id, (grossBySeller.get(item.seller_id) || 0) + gross);
      // Accumulated from the rate each LINE captured, falling back to the
      // seller's current rate only for lines older than that column. The
      // multiplication used to happen once at the end against today's rate,
      // which meant a renegotiation rewrote every statement ever issued.
      const rate = item.commission_rate ?? rateOf(item.seller_id);
      commissionBySeller.set(
        item.seller_id,
        (commissionBySeller.get(item.seller_id) || 0) + gross * (Number(rate) || 0) / 100
      );
      // A single order can hold several of one seller's lines; the seller's
      // "completed orders" figure counts orders, not line items.
      if (!ordersBySeller.has(item.seller_id)) ordersBySeller.set(item.seller_id, new Set());
      ordersBySeller.get(item.seller_id)!.add(o.id);
    }
  }

  const paidBySeller = new Map<string, number>();
  const lastPaidBySeller = new Map<string, string>();
  for (const p of payouts) {
    paidBySeller.set(p.seller_id, (paidBySeller.get(p.seller_id) || 0) + Number(p.amount));
    const seen = lastPaidBySeller.get(p.seller_id);
    if (!seen || p.paid_at > seen) lastPaidBySeller.set(p.seller_id, p.paid_at);
  }

  const platformRate = Number(settings?.commission_rate ?? 10);

  return sellers.map((seller) => {
    const commissionRatePercent = seller.commission_rate ?? platformRate;
    const grossSales = grossBySeller.get(seller.id) || 0;
    const commission = commissionBySeller.get(seller.id) || 0;
    const earnings = grossSales - commission;
    const paidOut = paidBySeller.get(seller.id) || 0;
    return {
      seller,
      commissionRatePercent,
      completedOrderCount: ordersBySeller.get(seller.id)?.size || 0,
      grossSales,
      commission,
      earnings,
      paidOut,
      outstanding: earnings - paidOut,
      lastPaidAt: lastPaidBySeller.get(seller.id) || null,
    };
  });
}

/** Full payout history across every seller, newest first — the audit trail
 * behind the balances above. */
export async function adminPayouts(): Promise<SellerPayout[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("seller_payouts").select("*")
      .order("paid_at", { ascending: false }).limit(MAX_ADMIN_PAYOUTS);
    if (error) return [];
    return (data as SellerPayout[]) || [];
  } catch {
    return [];
  }
}

/** Every message queued or sent for one order, oldest first — the order's
 * communication history, shown on its admin page.
 *
 * Returns [] rather than throwing when supabase/notifications.sql has not
 * been run: the panel then shows a short "run the migration" note instead of
 * taking down the order page around it. Same defensive shape as
 * adminHeroSlides() and adminPromotions() above. */
export async function adminOrderNotifications(orderId: string): Promise<OrderNotification[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("notifications")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) return [];
    return (data as OrderNotification[]) || [];
  } catch {
    return [];
  }
}

/** The store's outstanding messages — everything queued or failed, across
 * every order. In manual mode this is the admin's actual to-do list. */
export async function adminPendingNotifications(): Promise<OrderNotification[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("notifications")
      .select("*")
      .in("status", ["queued", "failed"])
      .order("created_at", { ascending: false })
      .limit(MAX_ADMIN_NOTIFICATIONS);
    if (error) return [];
    return (data as OrderNotification[]) || [];
  } catch {
    return [];
  }
}

/** Everything the stock screen needs, in one place.
 *
 * Reuses the existing capped reads rather than adding new ones -- the same
 * products and orders the dashboard and export already load, reconciled by
 * buildStockReport() instead of queried again. */
export async function adminStockReport() {
  const [products, orders, cats, sellers] = await Promise.all([
    adminProducts(), adminOrders(), adminCategories(), adminSellers(),
  ]);
  const { buildStockReport, withPurchaseFacts } = await import("@/lib/stockReport");
  const report = buildStockReport(products, orders, cats, sellers);

  // Purchasing facts are layered on separately and degrade to nothing when
  // supabase/stock-receipt.sql has not been run: the stock screen still
  // works, it just has no purchase columns to show.
  const { adminReceipts, adminOnOrder, adminStockMovements, adminStockDrift } =
    await import("@/lib/data/procurement");
  const [receipts, onOrder, movements, drift] = await Promise.all([
    adminReceipts(), adminOnOrder(), adminStockMovements(), adminStockDrift(),
  ]);
  return {
    ...withPurchaseFacts(report, receipts, onOrder),
    movements,
    // Keyed by product so the screen can flag a row without scanning a list
    // for every one of them.
    drift: new Map(drift.map((d) => [d.product_id, d.drift])),
  };
}

/** The heart on the storefront's product cards, totalled for the shop.
 *
 * Reads the products the rest of the admin has already loaded
 * (adminProducts is cache()d for the request), so the figure costs nothing
 * over opening the page. A database that has not run supabase/loves.sql
 * has no column to read and every row counts as zero, which is why the
 * home page hides the panel entirely rather than showing a confident 0.
 *
 * It is a POPULARITY SIGNAL, not a count of people -- see loves.sql. The
 * label on the screen says "loves", not "customers". */
export async function adminLoveStats(): Promise<LoveTotals> {
  return loveTotals(await adminProducts());
}

/** Everything the reorder plan needs, reusing the same capped reads the
 * stock screen already makes rather than querying again. */
export async function adminReplenishment() {
  const [products, orders] = await Promise.all([adminProducts(), adminOrders()]);
  const { adminOnOrder, supplierByProduct } = await import("@/lib/data/procurement");
  const [onOrderFacts, supplierMap] = await Promise.all([adminOnOrder(), supplierByProduct()]);

  const onOrder = new Map<string, number>();
  for (const f of onOrderFacts) {
    if (!f.product_id) continue;
    onOrder.set(f.product_id, (onOrder.get(f.product_id) || 0) + Number(f.qty || 0));
  }

  const { buildReplenishment, policyFromSettings } = await import("@/lib/replenishment");
  // The shop's own policy where it has set one. Falls back to the same
  // defaults the constants held, so a store that has not run
  // supabase/reorder-policy.sql sees exactly the plan it saw before.
  const settings = await adminSettings().catch(() => null);
  return buildReplenishment({
    products: products.filter((p) => !p.archived),
    orders, onOrder, supplierByProduct: supplierMap,
    policy: policyFromSettings(settings),
  });
}

/** The admin home's to-do list.
 *
 * Reuses the reads every other admin screen already makes; the only cost
 * over opening any one of them is the fan-out, which runs in parallel. Each
 * source degrades to nothing on its own rather than taking the home down
 * with it -- a store that has not run the procurement migrations still gets
 * its orders and its stock. */
export async function adminAttention() {
  const { buildAttention } = await import("@/lib/attention");
  const { adminPurchaseOrders } = await import("@/lib/data/procurement");
  const { adminStockDrift } = await import("@/lib/data/procurement");

  const [orders, products, purchaseOrders, replenishment, pending, drift, settings, sellers, refunds] =
    await Promise.all([
      adminOrders(), adminProducts(),
      adminPurchaseOrders().catch(() => []),
      adminReplenishment().catch(() => []),
      adminPendingNotifications().catch(() => []),
      adminStockDrift().catch(() => []),
      adminSettings().catch(() => null),
      adminSellers().catch(() => []),
      (await import("@/lib/actions/returns")).pendingGatewayRefunds().catch(() => []),
    ]);

  return buildAttention({
    orders, products, purchaseOrders, replenishment,
    pendingSellers: sellers.filter((s) => s.status === "pending").length,
    pendingRefunds: refunds.length,
    pendingMessages: pending.length,
    driftCount: drift.length,
    restockPct: (settings as { restock_alert_pct?: number } | null)?.restock_alert_pct,
  });
}

/** Every return recorded against one order, with its lines.
 *
 * Empty when supabase/returns.sql has not been run, so the order screen
 * shows no returns panel rather than an error. */
export async function adminOrderReturns(orderId: string): Promise<OrderReturn[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("order_returns")
      .select("*, items:order_return_items(*)")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as unknown as OrderReturn[];
  } catch { return []; }
}

/** Staff accounts, newest first. Never returns the password hash.
 *
 * Empty when supabase/admin-users.sql has not been run, so the screen says
 * "no staff accounts yet" rather than failing. */
export async function adminUsers(): Promise<AdminUserRow[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("admin_users")
      .select("id, name, email, active, totp_enabled, created_at, last_login_at, role, sections")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data) return [];
    // Normalised on the way out, so the screen shows what the application
    // would actually enforce rather than what the column happens to say.
    // A row still on the pre-roles default reads as a reader with nothing,
    // which is what it is.
    return (data as Record<string, unknown>[]).map((r) => ({
      ...r,
      role: normalizeRole(r.role),
      sections: normalizeSections(r.sections),
    })) as AdminUserRow[];
  } catch { return []; }
}

export interface AdminUserRow {
  id: string; name: string; email: string; active: boolean;
  totp_enabled: boolean; created_at: string; last_login_at: string | null;
  role: AdminRole; sections: SectionKey[];
}

/** The record of who did what, newest first. */
export async function adminAuditLog(limit = 300): Promise<AuditRow[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("audit_log")
      .select("id, at, actor_kind, actor_label, action, entity, entity_id, summary")
      .order("at", { ascending: false })
      .limit(Math.min(limit, 1000));
    if (error || !data) return [];
    return data as AuditRow[];
  } catch { return []; }
}

export interface AuditRow {
  id: string; at: string; actor_kind: string; actor_label: string;
  action: string; entity: string; entity_id: string | null; summary: string;
}
