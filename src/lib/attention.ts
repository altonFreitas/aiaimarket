import type { Order, Product, PurchaseOrder } from "./types";
import type { ReplenishmentRow } from "./replenishment";

/* What needs doing today.
 *
 * The admin has six screens, each answering its own question well, and no
 * screen that answers "what should I do first". Opening the admin landed on
 * the product catalog -- a list of everything, sorted by nothing in
 * particular, which is the one view that never tells you to act.
 *
 * This is deliberately a to-do list and NOT a second dashboard. Every
 * number here is a count of things waiting, each linking to the screen
 * where the work happens. Revenue, margin and trends live on the sales
 * dashboard and are not repeated: the whole reason Statistics was rebuilt
 * was that two screens were saying the same thing in different words. */

export type AttentionKind =
  | "orders_to_confirm"
  | "messages_to_send"
  | "products_to_approve"
  | "reorder_now"
  | "out_of_stock_selling"
  | "po_overdue"
  | "po_arriving"
  | "po_unpaid"
  | "preorders_waiting"
  | "stock_drift";

export interface AttentionItem {
  kind: AttentionKind;
  /** How many things are waiting. Never zero: an item with nothing behind
   * it is not shown at all, because a wall of zeroes is how a to-do list
   * stops being read. */
  count: number;
  severity: "urgent" | "warn" | "info";
  href: string;
  /** i18n key for the headline, which receives {n}. */
  labelKey: string;
  /** i18n key for the line underneath. */
  hintKey: string;
}

export interface AttentionInput {
  orders: Order[];
  products: Product[];
  purchaseOrders: PurchaseOrder[];
  replenishment: ReplenishmentRow[];
  /** Notifications queued but not yet sent. */
  pendingMessages: number;
  /** Products whose balance disagrees with their ledger. Should be empty. */
  driftCount: number;
  nowMs?: number;
}

const DAY_MS = 86_400_000;

/** An order that has taken stock but not reached the buyer. */
const OPEN_ORDER: ReadonlySet<string> = new Set([
  "new", "confirmed", "preparing", "out", "arrived",
]);

/** Sorted by what happens if it is ignored. Urgent means someone is already
 * waiting or money is already late; warn means it becomes urgent shortly. */
const RANK = { urgent: 0, warn: 1, info: 2 } as const;

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const nowMs = input.nowMs ?? Date.now();
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const inAWeek = new Date(nowMs + 7 * DAY_MS).toISOString().slice(0, 10);

  const items: AttentionItem[] = [];
  const add = (
    kind: AttentionKind, count: number, severity: AttentionItem["severity"],
    href: string, labelKey: string, hintKey: string
  ) => { if (count > 0) items.push({ kind, count, severity, href, labelKey, hintKey }); };

  // --- someone is waiting on a person ---
  const toConfirm = input.orders.filter((o) => o.status === "new");
  add("orders_to_confirm", toConfirm.length, "urgent",
    "/admin/orders", "attnOrdersToConfirm", "attnOrdersToConfirmHint");

  add("messages_to_send", input.pendingMessages, "urgent",
    "/admin/notifications", "attnMessagesToSend", "attnMessagesToSendHint");

  const preorders = input.orders.filter(
    (o) => o.is_preorder && OPEN_ORDER.has(o.status));
  add("preorders_waiting", preorders.length, "warn",
    "/admin/orders", "attnPreorders", "attnPreordersHint");

  const toApprove = input.products.filter(
    (p) => p.status === "pending" && !p.archived);
  add("products_to_approve", toApprove.length, "warn",
    "/admin", "attnProductsToApprove", "attnProductsToApproveHint");

  // --- buying ---
  const reorderNow = input.replenishment.filter(
    (r) => (r.urgency === "out" || r.urgency === "urgent") && r.suggestedQty > 0);
  add("reorder_now", reorderNow.length, "urgent",
    "/admin/procurement/reorder", "attnReorderNow", "attnReorderNowHint");

  // Empty AND still selling. A listing nobody orders being at zero is not a
  // problem to solve today; one that people are still trying to buy is.
  const outAndSelling = input.replenishment.filter(
    (r) => r.position <= 0 && r.dailyRate > 0);
  add("out_of_stock_selling", outAndSelling.length, "urgent",
    "/admin/stock", "attnOutSelling", "attnOutSellingHint");

  const open = input.purchaseOrders.filter(
    (po) => po.status !== "received" && po.status !== "cancelled");

  const overdue = open.filter(
    (po) => po.expected_arrival && po.expected_arrival < today);
  add("po_overdue", overdue.length, "urgent",
    "/admin/procurement", "attnPoOverdue", "attnPoOverdueHint");

  const arriving = open.filter(
    (po) => po.expected_arrival && po.expected_arrival >= today && po.expected_arrival <= inAWeek);
  add("po_arriving", arriving.length, "info",
    "/admin/procurement", "attnPoArriving", "attnPoArrivingHint");

  // Overdue payment is money already late; unpaid on a received order is
  // money owed. Both are the supplier's view of the same shelf.
  const owed = input.purchaseOrders.filter(
    (po) => po.payment_status === "overdue"
      || (po.payment_status === "unpaid" && po.status === "received"));
  add("po_unpaid", owed.length, "warn",
    "/admin/procurement", "attnPoUnpaid", "attnPoUnpaidHint");

  // --- the ledger disagreeing with itself ---
  add("stock_drift", input.driftCount, "urgent",
    "/admin/stock", "attnStockDrift", "attnStockDriftHint");

  return items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
}
