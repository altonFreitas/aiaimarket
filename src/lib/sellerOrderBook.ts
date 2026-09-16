import type { SellerOrderView } from "./data/seller";
import type { OrderStatus, PayStatus } from "./types";

/* THE SELLER'S ORDER BOOK, FILTERED AND COUNTED.
 *
 * The same shape of screen as the owner's -- a period across the top, the
 * figures for that period, the filters, then the list -- because it answers
 * the same shape of question and two screens in one shop should not be
 * operated differently.
 *
 * IT IS NOT THE SAME ARITHMETIC, and that is the whole reason this file
 * exists rather than the seller page importing lib/orderBook.ts.
 *
 * An order is not a seller's order. It is a basket that may carry other
 * sellers' lines and a delivery fee, and `orders.total` is the sum of all
 * of it. Feeding that through the owner's orderKpis() would tell a seller
 * their revenue was money that mostly belonged to somebody else -- a figure
 * that is wrong in the flattering direction, which is the worst kind to put
 * on a payouts screen.
 *
 * So every figure here is computed from mySubtotal and myCommission, the
 * two fields getSellerOrders() already reduced down to this seller's own
 * lines, and the tiles are named for what a seller actually has: gross,
 * commission, earnings. "Owed to us" has no seller equivalent at all -- the
 * buyer does not owe the seller anything, the marketplace does -- so it is
 * not here.
 *
 * Everything is PURE. Given the rows and a filter it returns rows and
 * figures, so the rules are testable without a database and the screen
 * cannot quietly disagree with its own totals.
 */

export interface SellerOrderFilter {
  /** Inclusive, on the order date, as YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Reference, buyer name, phone, municipality, address, product name. */
  q?: string;
  status?: OrderStatus | "";
  payStatus?: PayStatus | "";
  mode?: "delivery" | "pickup" | "";
  flag?: SellerOrderFlag | "";
}

export type SellerOrderFlag =
  | "pending" | "unpaid" | "late" | "cancelRequested" | "preorder" | "unfulfilled";

/** The same six the owner's screen offers, in the same order, so somebody
 * who runs both does not have to re-learn the row. */
export const SELLER_ORDER_FLAGS: readonly SellerOrderFlag[] = [
  "pending", "unpaid", "late", "cancelRequested", "preorder", "unfulfilled",
];

export const SELLER_PAY_STATUSES: readonly PayStatus[] = [
  "unpaid", "deposit", "paid", "refunded",
];

/** Statuses where something is still owed to the buyer. `cancelled` is not
 * open -- nothing more will happen to it -- and neither is `completed`. */
const OPEN_STATUSES: readonly OrderStatus[] = [
  "new", "confirmed", "preparing", "out", "arrived",
];

export function isOpen(o: SellerOrderView): boolean {
  return OPEN_STATUSES.includes(o.status);
}

/** The calendar day the order was placed, in the shop's terms.
 *
 * Sliced rather than parsed, for the same reason as orderBook.orderDay: the
 * stored value is already ISO, and re-reading it in the VIEWER's timezone
 * would file an order placed at 23:00 in Dili under the previous day for
 * anybody reading from Europe. */
export function sellerOrderDay(o: Pick<SellerOrderView, "created_at">): string {
  return (o.created_at || "").slice(0, 10);
}

/** Promised a date, that date has passed, and it has not arrived.
 *
 * An order with no expected_delivery is never late: nothing was promised,
 * and inventing a deadline the buyer never got would turn a quiet seller
 * into a failing one on their own dashboard. */
export function isLate(o: SellerOrderView, today: string): boolean {
  if (o.status === "cancelled" || o.status === "completed") return false;
  const due = o.expected_delivery;
  return !!due && due < today;
}

export function hasFlag(
  o: SellerOrderView, flag: SellerOrderFlag, today: string
): boolean {
  switch (flag) {
    case "unpaid": return o.pay_status === "unpaid" && o.status !== "cancelled";
    case "pending": return o.status === "new";
    case "late": return isLate(o, today);
    case "cancelRequested":
      return !!o.cancel_requested_at && o.status !== "cancelled";
    case "preorder": return !!o.is_preorder && o.status !== "cancelled";
    case "unfulfilled": return isOpen(o);
  }
}

export function filterSellerOrders(
  orders: readonly SellerOrderView[], f: SellerOrderFilter, today: string
): SellerOrderView[] {
  const q = (f.q || "").trim().toLowerCase();

  return orders.filter((o) => {
    const day = sellerOrderDay(o);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.payStatus && o.pay_status !== f.payStatus) return false;
    if (f.mode && o.mode !== f.mode) return false;
    if (f.flag && !hasFlag(o, f.flag, today)) return false;
    if (q) {
      /* THE SELLER'S OWN PRODUCT NAMES ARE IN THE HAYSTACK, and the
         owner's equivalent has no such thing. A seller looks for "the red
         tais order" far more often than for a reference number, because
         they know their stock and not the shop's numbering.

         Only myItems -- searching another seller's lines would let one
         seller find an order by guessing at what a rival sells. */
      const hay = [
        o.ref, o.buyer_name, o.buyer_phone, o.municipality, o.address_line,
        o.suku, o.aldeia, o.landmark,
        ...o.myItems.map((i) => i.name),
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sellerFilterIsActive(f: SellerOrderFilter): boolean {
  return Object.values(f).some((v) => v !== undefined && v !== "");
}

/* ---------------------------------------------------------------------------
 * The figures above the list
 * ------------------------------------------------------------------------ */

export interface SellerOrderKpis {
  count: number;
  /** This seller's lines only, cancelled orders excluded: nothing was sold,
   * so counting it would report money that never existed. */
  grossSales: number;
  /** What the marketplace keeps, on the same rows as grossSales. */
  commission: number;
  /** grossSales - commission. What the seller is actually owed. */
  earnings: number;
  /** Per order, over the same rows. Null with nothing to average, rather
   * than 0, which would read as "my orders are worth nothing". */
  avgOrderValue: number | null;
  /** Distinct buyers, by phone. There are no buyer accounts, so the phone
   * is the customer. */
  customers: number;
  unfulfilled: number;
  late: number;
  /** Of the orders that reached an end, how many completed rather than
   * cancelled. Null while none has ended: a seller whose only order is
   * still being packed has not failed anything, and 0% would say they had. */
  fulfilmentRate: number | null;
}

export function sellerOrderKpis(
  orders: readonly SellerOrderView[], today: string
): SellerOrderKpis {
  const sold = orders.filter((o) => o.status !== "cancelled");
  const grossSales = sold.reduce((a, o) => a + o.mySubtotal, 0);
  const commission = sold.reduce((a, o) => a + o.myCommission, 0);

  const ended = orders.filter(
    (o) => o.status === "completed" || o.status === "cancelled");
  const completed = ended.filter((o) => o.status === "completed").length;

  return {
    count: orders.length,
    grossSales,
    commission,
    earnings: grossSales - commission,
    avgOrderValue: sold.length ? grossSales / sold.length : null,
    customers: new Set(orders.map((o) => o.buyer_phone).filter(Boolean)).size,
    unfulfilled: orders.filter(isOpen).length,
    late: orders.filter((o) => isLate(o, today)).length,
    fulfilmentRate: ended.length ? completed / ended.length : null,
  };
}

/** How many rows each flag would show, counted over the date window BEFORE
 * the flag itself is applied.
 *
 * Otherwise clicking one chip collapses every other chip's count to nothing,
 * and the row stops being a summary of what needs doing the moment it is
 * used for the thing it is for. */
export function sellerFlagCounts(
  orders: readonly SellerOrderView[], today: string
): Record<SellerOrderFlag, number> {
  const out = {} as Record<SellerOrderFlag, number>;
  for (const flag of SELLER_ORDER_FLAGS) {
    out[flag] = orders.filter((o) => hasFlag(o, flag, today)).length;
  }
  return out;
}
