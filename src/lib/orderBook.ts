import type { Order, OrderStatus, PayMethod, PayStatus } from "./types";

/* THE ORDER BOOK, FILTERED AND COUNTED.
 *
 * The orders screen listed every order ever placed behind a single status
 * dropdown. That is fine at nine orders and useless at nine hundred: the
 * questions a shopkeeper actually opens this page with -- what came in
 * today, who has not paid, which parcels are late, what did this customer
 * buy -- were all unanswerable without scrolling.
 *
 * Everything here is PURE. Given the orders and a filter it returns rows
 * and figures, so every rule below is testable without a database and the
 * screen cannot quietly disagree with its own totals.
 *
 * ONE FILTERED SET FEEDS EVERYTHING, the same discipline the sales
 * dashboard follows. A tile counting all orders above a list showing some
 * is two numbers on one screen that disagree, with nothing saying why.
 */

export interface OrderFilter {
  /** Inclusive, on the ORDER DATE (created_at), as YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Reference, customer name, phone, municipality, address, note. */
  q?: string;
  status?: OrderStatus | "";
  payStatus?: PayStatus | "";
  payMethod?: PayMethod | "";
  mode?: "delivery" | "pickup" | "";
  municipality?: string;
  /** Narrow to one buyer, by phone -- the phone is the customer here, since
   * there are no accounts. Set by clicking a name in the list. */
  customer?: string;
  /** The things that need somebody to do something. Deliberately not a
   * status: "late" and "asked to cancel" cut across every status there is. */
  flag?: OrderFlag | "";
}

export type OrderFlag =
  | "unpaid" | "pending" | "late" | "cancelRequested" | "preorder" | "unfulfilled";

export const ORDER_FLAGS: readonly OrderFlag[] = [
  "pending", "unpaid", "late", "cancelRequested", "preorder", "unfulfilled",
];

export const PAY_METHODS: readonly PayMethod[] = [
  "cod", "cop", "bank", "wallet", "fiar", "card",
];
export const PAY_STATUSES: readonly PayStatus[] = [
  "unpaid", "deposit", "paid", "refunded",
];

/** Statuses where the shop still owes the buyer something. `cancelled` is
 * not open -- nothing more will happen to it -- and neither is `completed`. */
const OPEN_STATUSES: readonly OrderStatus[] = [
  "new", "confirmed", "preparing", "out", "arrived",
];

export function isOpen(o: Order): boolean {
  return OPEN_STATUSES.includes(o.status);
}

/** The calendar day an order was placed, in the shop's terms.
 *
 * created_at is a timestamp; every date filter on this screen is a day. The
 * slice is deliberate rather than a Date round-trip: the stored value is
 * already ISO, and parsing it into the VIEWER's timezone would put an order
 * placed at 23:00 in Dili on the previous day for anyone reading from
 * Europe. */
export function orderDay(o: Pick<Order, "created_at">): string {
  return (o.created_at || "").slice(0, 10);
}

/** Promised a date, that date has passed, and it has not arrived.
 *
 * An order with no expected_delivery is never late: nothing was promised,
 * and inventing a deadline the buyer was never given would turn a silent
 * shop into a failing one. */
export function isLate(o: Order, today: string): boolean {
  if (o.status === "cancelled" || o.status === "completed") return false;
  if (o.delivered_at) return false;
  const due = o.expected_delivery;
  return !!due && due < today;
}

export function hasFlag(o: Order, flag: OrderFlag, today: string): boolean {
  switch (flag) {
    case "unpaid": return o.pay_status === "unpaid" && o.status !== "cancelled";
    case "pending": return o.status === "new";
    case "late": return isLate(o, today);
    case "cancelRequested": return !!o.cancel_requested_at && o.status !== "cancelled";
    case "preorder": return !!o.is_preorder && o.status !== "cancelled";
    // Everything still owed: the working queue, and the one flag that
    // answers "what is on my plate" rather than "what went wrong".
    case "unfulfilled": return isOpen(o);
  }
}

export function filterOrders(
  orders: readonly Order[], f: OrderFilter, today: string
): Order[] {
  const q = (f.q || "").trim().toLowerCase();

  return orders.filter((o) => {
    const day = orderDay(o);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.payStatus && o.pay_status !== f.payStatus) return false;
    if (f.payMethod && o.pay_method !== f.payMethod) return false;
    if (f.mode && o.mode !== f.mode) return false;
    if (f.municipality && (o.municipality || "") !== f.municipality) return false;
    if (f.customer && o.buyer_phone !== f.customer) return false;
    if (f.flag && !hasFlag(o, f.flag, today)) return false;
    if (q) {
      // The note and the address are in here on purpose: "the blue house
      // near the school" is how a delivery gets found again, and it is
      // never in any other field.
      const hay = [
        o.ref, o.buyer_name, o.buyer_phone, o.municipality, o.address_line,
        o.suku, o.aldeia, o.landmark, o.note,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function orderFilterIsActive(f: OrderFilter): boolean {
  return Object.values(f).some((v) => v !== undefined && v !== "");
}

/* ---------------------------------------------------------------------------
 * The figures above the list
 * ------------------------------------------------------------------------ */

export interface OrderKpis {
  count: number;
  /** Cancelled orders excluded: nothing was sold, so counting their value
   * as revenue would report money that never existed. */
  revenue: number;
  /** Revenue over non-cancelled orders. Null when there are none -- a
   * division the screen must not perform on an empty window. */
  avgOrderValue: number | null;
  /** Billed and not settled. The shop's actual receivable. */
  unpaidValue: number;
  unpaid: number;
  /** Distinct buyers, by phone. */
  customers: number;
  pending: number;
  unfulfilled: number;
  late: number;
  cancelled: number;
  cancelRequested: number;
  preorders: number;
  delivered: number;
  /** Delivered over (delivered + still open). Null before anything has
   * been delivered or is outstanding. */
  fulfilmentRate: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function orderKpis(orders: readonly Order[], today: string): OrderKpis {
  let revenue = 0, unpaidValue = 0, unpaid = 0, pending = 0, unfulfilled = 0;
  let late = 0, cancelled = 0, cancelRequested = 0, preorders = 0, delivered = 0;
  const buyers = new Set<string>();

  for (const o of orders) {
    if (o.buyer_phone) buyers.add(o.buyer_phone);
    if (o.status === "cancelled") { cancelled += 1; continue; }

    revenue += Number(o.total) || 0;
    if (o.pay_status === "unpaid") { unpaid += 1; unpaidValue += Number(o.total) || 0; }
    if (o.status === "new") pending += 1;
    if (isOpen(o)) unfulfilled += 1;
    if (isLate(o, today)) late += 1;
    if (o.cancel_requested_at) cancelRequested += 1;
    if (o.is_preorder) preorders += 1;
    if (o.status === "completed" || o.delivered_at) delivered += 1;
  }

  const live = orders.length - cancelled;
  const settled = delivered + unfulfilled;
  return {
    count: orders.length,
    revenue: round2(revenue),
    avgOrderValue: live > 0 ? round2(revenue / live) : null,
    unpaidValue: round2(unpaidValue),
    unpaid,
    customers: buyers.size,
    pending,
    unfulfilled,
    late,
    cancelled,
    cancelRequested,
    preorders,
    delivered,
    fulfilmentRate: settled > 0 ? delivered / settled : null,
  };
}

/** How many orders carry each flag, for the chips that filter by them.
 *
 * Counted over the date-filtered set but BEFORE the flag itself is applied,
 * so the numbers do not collapse to "the one you clicked" the moment you
 * click it. */
export function flagCounts(
  orders: readonly Order[], today: string
): Record<OrderFlag, number> {
  const out = {} as Record<OrderFlag, number>;
  for (const flag of ORDER_FLAGS) {
    out[flag] = orders.reduce((a, o) => a + (hasFlag(o, flag, today) ? 1 : 0), 0);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Sorting
 * ------------------------------------------------------------------------ */

export type OrderSort = "newest" | "oldest" | "highest" | "lowest" | "customer" | "status";

export const ORDER_SORTS: readonly OrderSort[] = [
  "newest", "oldest", "highest", "lowest", "customer", "status",
];

/** Where an order sits in the shop's own workflow, so "by status" sorts
 * into the order work actually happens in rather than alphabetically --
 * "arrived" before "confirmed" is not a sequence anybody works to. */
const STATUS_RANK: Record<OrderStatus, number> = {
  new: 0, confirmed: 1, preparing: 2, out: 3, arrived: 4, completed: 5, cancelled: 6,
};

export function sortOrders(orders: readonly Order[], by: OrderSort): Order[] {
  const rows = [...orders];
  switch (by) {
    case "newest": return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "oldest": return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case "highest": return rows.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    case "lowest": return rows.sort((a, b) => (Number(a.total) || 0) - (Number(b.total) || 0));
    case "customer":
      return rows.sort((a, b) =>
        (a.buyer_name || "").localeCompare(b.buyer_name || "")
        || b.created_at.localeCompare(a.created_at));
    case "status":
      return rows.sort((a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status]
        || b.created_at.localeCompare(a.created_at));
  }
}

/** Every municipality that appears in the book, for the filter dropdown.
 *
 * Built from the orders rather than from a fixed list so it only ever
 * offers places the shop has actually delivered to -- a dropdown of
 * thirteen municipalities where twelve return nothing is a dropdown that
 * teaches people not to use it. */
export function municipalitiesIn(orders: readonly Order[]): string[] {
  const seen = new Set<string>();
  for (const o of orders) if (o.municipality) seen.add(o.municipality);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/* ---------------------------------------------------------------------------
 * The daily shape
 * ------------------------------------------------------------------------ */

export interface OrderDayPoint {
  day: string;
  orders: number;
  revenue: number;
}

/** Orders per day across the window, oldest first, empty days included.
 *
 * Empty days are the point: a week with three orders on Monday and nothing
 * after is a different business from one with an order every day, and a
 * chart that skipped the gaps would draw them identically. */
export function ordersByDay(
  orders: readonly Order[], from: string, to: string, maxDays = 92
): OrderDayPoint[] {
  if (!from || !to || from > to) return [];
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const d = orderDay(o);
    const e = byDay.get(d) || { orders: 0, revenue: 0 };
    e.orders += 1;
    e.revenue += Number(o.total) || 0;
    byDay.set(d, e);
  }

  const out: OrderDayPoint[] = [];
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  // Capped so a year-long window does not try to draw 365 bars two pixels
  // wide. Past the cap the chart is not drawn at all rather than drawn
  // misleadingly from a truncated span.
  if ((end - start) / 86_400_000 + 1 > maxDays) return [];

  for (let t = start; t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const e = byDay.get(day);
    out.push({ day, orders: e?.orders || 0, revenue: round2(e?.revenue || 0) });
  }
  return out;
}
