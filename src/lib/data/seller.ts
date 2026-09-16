import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasSellerTotpSession } from "@/lib/sellerTotpSession";
import { readCapped, type Capped } from "./capped";
import type { Order, OrderItem, PayMethod, PayStatus, Product, Seller, SellerPayout } from "@/lib/types";

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
  /** This seller's commission on their own lines, in currency, using the
   * rate each line captured when it was placed (OrderItem.commission_rate)
   * and falling back to the rate in force now for lines that predate it. */
  myCommission: number;

  /* WHAT THE ORDER BOOK FILTERS ON, and nothing beyond it.
   *
   * Carried straight off the order because the filters and the flag chips
   * cannot ask a question the row cannot answer: without expected_delivery
   * there is no "late", without pay_status there is no "unpaid".
   *
   * `total` is deliberately NOT here. It is the whole basket -- other
   * sellers' lines and the delivery fee included -- and a seller reading it
   * as theirs would be reading somebody else's money. mySubtotal is the
   * only figure on this row that belongs to them. */
  pay_status: PayStatus;
  pay_method: PayMethod;
  expected_delivery?: string | null;
  cancel_requested_at: string | null;
  is_preorder?: boolean;
}

/** This seller's order ids, newest first, straight off the index.
 *
 * Returns null -- not an empty array -- when the database has not run
 * supabase/order-items.sql. The difference matters: null means "ask the
 * old way", empty means "this seller genuinely has no orders", and
 * conflating them would show a working seller an empty dashboard.
 */
async function sellerOrderIdsFromIndex(sellerId: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("order_items")
      .select("order_id, created_at")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false })
      .limit(MAX_SELLER_ORDER_SCAN * 4);   // lines, not orders: a basket is several
    if (error) return null;
    const seen = new Set<string>();
    for (const row of data || []) seen.add(row.order_id as string);
    return [...seen];
  } catch { return null; }
}

/** Earnings computed by the database over an index, or null when it cannot.
 *
 * The aggregate in supabase/order-items.sql is the same arithmetic
 * computeSellerEarnings() does, over every completed order this seller has
 * ever had rather than over whatever fitted in the scan. When it answers,
 * the truncation caveat does not apply -- there is nothing truncated. */
export async function getSellerEarningsIndexed(
  sellerId: string,
): Promise<Omit<SellerEarnings, "commissionRatePercent"> | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .rpc("seller_earnings", { p_seller_id: sellerId });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      completedOrderCount: Number(row.completed_order_count) || 0,
      grossSales: Number(row.gross_sales) || 0,
      commission: Number(row.commission) || 0,
      earnings: Number(row.earnings) || 0,
    };
  } catch { return null; }
}

/** Every order that contains at least one of this seller's products,
 * reduced down to just their own items + the buyer/delivery info needed
 * to fulfil their part — never another seller's items, and never the
 * full unrelated order total. Small dataset (a local marketplace), so a
 * full scan + in-memory filter is fine, same "no pagination needed yet"
 * approach used elsewhere in this app (e.g. category product counts). */
/** The same read, and whether it saw everything.
 *
 * WHY THE TRUNCATION FLAG MATTERS MORE HERE THAN ANYWHERE ELSE. A seller's
 * items live inside `orders.items` as JSONB, so there is no index to query
 * "orders belonging to seller X" -- this scans the most recent slice of the
 * WHOLE marketplace and filters in memory. Payouts, by contrast, are read
 * unbounded. The moment total orders pass the cap, a seller's older
 * completed orders drop out of the window and stop counting towards gross
 * sales, while every dollar already paid to them still counts: `outstanding
 * = earnings - paidOut` drifts steadily negative, the platform believes it
 * has overpaid people it in fact owes, and nothing on any screen says why.
 *
 * The cap stays -- an unbounded scan of every order is not the answer
 * either. What changes is that it is no longer silent. The real fix is an
 * order_items table indexed on (seller_id, created_at); until that lands,
 * a figure that might be wrong is refused rather than shown.
 */
export async function getSellerOrdersCapped(
  sellerId: string,
  /** The rate to use for lines placed before rates were recorded on them.
   * Zero for the screens that do not show commission at all; the seller's
   * own current rate for the ones that do. */
  fallbackRatePercent = 0
): Promise<Capped<SellerOrderView>> {
  // THE INDEXED PATH, when the database has one. order_items is indexed on
  // (seller_id, created_at), so this asks for this seller's orders instead
  // of asking for the marketplace's and throwing most of them away.
  const indexed = await sellerOrderIdsFromIndex(sellerId);

  const sb = supabaseAdmin();
  const capped = indexed
    ? await readCapped<Order>(MAX_SELLER_ORDER_SCAN, async (limit) => {
        if (!indexed.length) return [];
        const { data } = await sb.from("orders").select("*")
          .in("id", indexed.slice(0, limit))
          .order("created_at", { ascending: false });
        return (data as Order[]) || [];
      })
    // THE OLD SCAN, for a database that has not run
    // supabase/order-items.sql. Reads the newest slice of the WHOLE
    // marketplace and filters in memory, and says so when it truncates --
    // which is why the truncation flag was added and why it stays.
    : await readCapped<Order>(MAX_SELLER_ORDER_SCAN, async (limit) => {
        const { data } = await sb.from("orders").select("*")
          .order("created_at", { ascending: false }).limit(limit);
        return (data as Order[]) || [];
      });
  const orders = capped.rows;

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
      pay_status: o.pay_status, pay_method: o.pay_method,
      expected_delivery: o.expected_delivery,
      cancel_requested_at: o.cancel_requested_at,
      is_preorder: o.is_preorder,
      myItems: myItems.map(stripCost),
      mySubtotal: myItems.reduce((a, i) => a + i.price * i.qty, 0),
      myCommission: myItems.reduce((a, i) => a + lineCommission(i, fallbackRatePercent), 0),
      allItemsMine: allItems.every((i) => i.seller_id === sellerId),
    });
  }
  // Same cap and the same truth about it, carrying the reduced views.
  return { ...capped, rows: views };
}

/** The list on its own, for the screens that only show orders. Whether the
 * scan was complete matters to a MONEY figure; it does not change what a
 * seller should see in their order list, which is their recent orders. */
export async function getSellerOrders(
  sellerId: string, fallbackRatePercent = 0
): Promise<SellerOrderView[]> {
  return (await getSellerOrdersCapped(sellerId, fallbackRatePercent)).rows;
}

/** Commission on one line, in currency.
 *
 * The rate the line captured wins. Falling back to "whatever is set now"
 * for a line that has no rate is not ideal -- it is the old behaviour --
 * but it is right for exactly the rows it applies to: orders placed before
 * the rate was ever recorded, whose commission was only ever computed that
 * way. New lines carry their own. */
function lineCommission(item: OrderItem, currentRatePercent = 0): number {
  const pct = item.commission_rate ?? currentRatePercent;
  return item.price * item.qty * (Number(pct) || 0) / 100;
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
  // The rate a NEW order would be placed at. Shown on screen as "your
  // rate", and applied to the historical lines that never recorded one.
  const commissionRatePercent = seller.commission_rate ?? platformCommissionRate;
  const completed = orders.filter((o) => o.status === "completed");
  const grossSales = completed.reduce((a, o) => a + o.mySubtotal, 0);

  /* SUMMED FROM THE LINES, not recomputed from today's rate.
   *
   * This used to be `grossSales * (rate / 100)` with the CURRENT rate --
   * so negotiating a store from 10% to 8% retroactively increased
   * everything the platform appeared to owe them, across their entire
   * history, and every payout and statement already issued stopped
   * agreeing with the dashboard. There was no authoritative record left to
   * settle the argument with.
   *
   * Each line now carries the rate that was in force when it was placed
   * (OrderItem.commission_rate). Lines older than that carry none and fall
   * back to the current rate, which is the behaviour they were always
   * computed under -- so nothing about the past changes on the day this
   * ships, and nothing about it changes again afterwards. */
  const commission = completed.reduce((a, o) => a + o.myCommission, 0);

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
