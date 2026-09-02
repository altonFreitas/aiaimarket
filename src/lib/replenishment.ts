import type { Order, Product } from "./types";
import { storeDay } from "./tz";

/* What to buy, how much, and by when.
 *
 * The stock screen answers "what is low". Low is not the same question:
 * a product selling forty a week is already too late at two units, and one
 * selling one a month is fine at two for the rest of the year. A single
 * threshold cannot tell those apart, and LOW_STOCK_THRESHOLD -- a global 2
 * -- was the only answer the system had.
 *
 * The rule here is the ordinary one from inventory management, and it is
 * ordinary because it is the smallest thing that works:
 *
 *   reorder when what you have plus what is coming falls to the amount you
 *   will sell while waiting for the next delivery, plus a buffer.
 *
 * Everything below is that sentence, made arithmetic. It deliberately does
 * not model seasonality or demand variance: this shop has months of
 * history, not years, and a forecast built on that would be a confident
 * number with nothing behind it. */

export interface ReplenishmentPolicy {
  /** Days of sales history the rate is measured over. Eight weeks: long
   * enough to survive one quiet fortnight, short enough to notice a product
   * that has started moving. */
  windowDays: number;
  /** Days between placing orders, when the supplier's own lead time is not
   * known. Stock has to cover the wait for the NEXT order too, not only
   * this one -- otherwise every line is reordered at the last moment. */
  reviewDays: number;
  /** Buffer on top of the lead time, for the week the boat is late. */
  safetyDays: number;
  /** Used when a supplier has never delivered and states no lead time. */
  defaultLeadDays: number;
}

export const DEFAULT_POLICY: ReplenishmentPolicy = {
  windowDays: 56, reviewDays: 14, safetyDays: 7, defaultLeadDays: 14,
};

/** The shop's own policy, or the defaults where it has not set one.
 *
 * Every field is validated here rather than trusted: these arrive from a
 * settings row, and a zero window would divide by zero while a negative
 * buffer would quietly suggest ordering less than nothing. The database
 * has its own checks; this is the second lock, for the case where the
 * columns do not exist yet at all. */
export function policyFromSettings(s: {
  reorder_window_days?: number | null;
  reorder_review_days?: number | null;
  reorder_safety_days?: number | null;
  reorder_default_lead_days?: number | null;
} | null | undefined): ReplenishmentPolicy {
  const pick = (v: number | null | undefined, fallback: number, min: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  return {
    windowDays: pick(s?.reorder_window_days, DEFAULT_POLICY.windowDays, 7),
    reviewDays: pick(s?.reorder_review_days, DEFAULT_POLICY.reviewDays, 1),
    safetyDays: pick(s?.reorder_safety_days, DEFAULT_POLICY.safetyDays, 0),
    defaultLeadDays: pick(s?.reorder_default_lead_days, DEFAULT_POLICY.defaultLeadDays, 1),
  };
}

export interface ReplenishmentRow {
  productId: string;
  ref: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  /** Units on the shelf. */
  onHand: number;
  /** Units on purchase orders that have not arrived. */
  onOrder: number;
  /** Units in orders not yet confirmed, so still counted in onHand while
   * already promised to someone. */
  promised: number;
  /** onHand + onOrder - promised. What the shop can actually sell. */
  position: number;
  /** Units per day over the window, measured across the days this product
   * was actually on sale. */
  dailyRate: number;
  /** Days the position lasts at that rate. Null when nothing is selling --
   * "never runs out" and "sells nothing" are the same arithmetic and very
   * different facts, so the caller is made to tell them apart. */
  daysOfCover: number | null;
  /** The day the shelf empties, YYYY-MM-DD. Null when nothing is selling. */
  stockoutOn: string | null;
  /** Lead time used, in days, and whether it was observed or assumed. */
  leadDays: number;
  leadKnown: boolean;
  /** Position at or below this is the moment to order. */
  reorderPoint: number;
  /** How many to order to reach cover through the next cycle. */
  suggestedQty: number;
  /** Ordered by how close the shelf is to empty. */
  urgency: "out" | "urgent" | "soon" | "ok";
}

const DAY_MS = 86_400_000;

/** Statuses whose units have left the shelf or are on their way out. Both
 * count as demand: an order being packed sold just as surely as one already
 * delivered, and only counting completed orders makes every fast-moving
 * product look slower than it is. */
const SOLD: ReadonlySet<string> = new Set([
  "confirmed", "preparing", "out", "arrived", "completed",
]);

export function daysBetween(fromIso: string, toMs: number): number {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (toMs - t) / DAY_MS);
}

/** Units per day, measured over the days the product could actually have
 * sold rather than over the whole window.
 *
 * A product added five days ago that sold ten units is selling two a day,
 * not ten divided by fifty-six. Dividing by the window would tell the shop
 * to order nothing for its fastest-moving new line. */
export function dailyRate(
  soldInWindow: number, createdAtIso: string, nowMs: number, windowDays: number
): number {
  const age = daysBetween(createdAtIso, nowMs);
  // At least a day, so a product listed this morning cannot divide by zero
  // and report an infinite rate.
  const days = Math.max(1, Math.min(windowDays, age));
  return soldInWindow / days;
}

export interface ReplenishmentInput {
  products: Product[];
  orders: Order[];
  /** Units on open purchase orders, by product id. */
  onOrder: Map<string, number>;
  /** Which supplier last sent each product, and their lead time. */
  supplierByProduct: Map<string, { id: string; name: string; leadDays: number | null }>;
  nowMs?: number;
  policy?: Partial<ReplenishmentPolicy>;
}

export function buildReplenishment(input: ReplenishmentInput): ReplenishmentRow[] {
  const policy = { ...DEFAULT_POLICY, ...(input.policy || {}) };
  const nowMs = input.nowMs ?? Date.now();
  const windowStart = nowMs - policy.windowDays * DAY_MS;

  // One pass over orders, as elsewhere: a scan per product turns a
  // 500-product catalog into 500 scans of the orders table.
  const soldInWindow = new Map<string, number>();
  const promised = new Map<string, number>();
  for (const o of input.orders) {
    const at = Date.parse(o.created_at);
    for (const item of o.items || []) {
      if (!item.product_id) continue;
      const qty = Number(item.qty) || 0;
      if (qty <= 0) continue;
      if (o.status === "new") {
        promised.set(item.product_id, (promised.get(item.product_id) || 0) + qty);
      } else if (SOLD.has(o.status) && Number.isFinite(at) && at >= windowStart) {
        soldInWindow.set(item.product_id, (soldInWindow.get(item.product_id) || 0) + qty);
      }
    }
  }

  const rows: ReplenishmentRow[] = [];
  for (const p of input.products) {
    if (p.archived) continue;

    const supplier = input.supplierByProduct.get(p.id) || null;
    const leadKnown = supplier?.leadDays != null && supplier.leadDays > 0;
    const leadDays = leadKnown ? Number(supplier!.leadDays) : policy.defaultLeadDays;

    const onHand = Number(p.qty) || 0;
    const onOrder = input.onOrder.get(p.id) || 0;
    const promisedQty = promised.get(p.id) || 0;
    const position = onHand + onOrder - promisedQty;

    const rate = dailyRate(soldInWindow.get(p.id) || 0, p.created_at, nowMs, policy.windowDays);

    // Cover the wait for this delivery plus the buffer. The review period is
    // in the TARGET but not in the trigger: you order when you would run out
    // before the goods land, and you order enough to last until the order
    // after that.
    const reorderPoint = rate * (leadDays + policy.safetyDays);
    const target = rate * (leadDays + policy.safetyDays + policy.reviewDays);
    const suggestedQty = Math.max(0, Math.ceil(target - position));

    const daysOfCover = rate > 0 ? position / rate : null;
    const stockoutOn = daysOfCover == null ? null
      : storeDay(nowMs + Math.max(0, daysOfCover) * DAY_MS);

    rows.push({
      productId: p.id, ref: p.ref, name: p.name,
      supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? null,
      onHand, onOrder, promised: promisedQty, position,
      dailyRate: rate, daysOfCover, stockoutOn,
      leadDays, leadKnown,
      reorderPoint, suggestedQty,
      urgency: urgencyOf(position, rate, daysOfCover, leadDays, policy),
    });
  }

  return rows;
}

function urgencyOf(
  position: number, rate: number, daysOfCover: number | null,
  leadDays: number, policy: ReplenishmentPolicy
): ReplenishmentRow["urgency"] {
  // Nothing selling is never urgent, whatever the shelf says. An empty
  // listing nobody orders is not a purchasing problem.
  if (rate <= 0) return "ok";
  if (position <= 0) return "out";
  if (daysOfCover == null) return "ok";
  // Already inside the lead time: order today and it still arrives late.
  if (daysOfCover <= leadDays) return "urgent";
  if (daysOfCover <= leadDays + policy.safetyDays + policy.reviewDays) return "soon";
  return "ok";
}

/** Only the lines worth acting on, worst first. */
export function toReorder(rows: ReplenishmentRow[]): ReplenishmentRow[] {
  const RANK: Record<ReplenishmentRow["urgency"], number> = {
    out: 0, urgent: 1, soon: 2, ok: 3,
  };
  return rows
    .filter((r) => r.urgency !== "ok" && r.suggestedQty > 0)
    .sort((a, b) =>
      RANK[a.urgency] - RANK[b.urgency] ||
      (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) ||
      b.dailyRate - a.dailyRate);
}

/** Grouped for the thing that actually happens next: one purchase order per
 * supplier, not one per product. */
export function groupBySupplier(rows: ReplenishmentRow[]): Array<{
  supplierId: string | null; supplierName: string | null;
  rows: ReplenishmentRow[]; units: number;
}> {
  const groups = new Map<string, {
    supplierId: string | null; supplierName: string | null;
    rows: ReplenishmentRow[]; units: number;
  }>();
  for (const r of rows) {
    const key = r.supplierId ?? "";
    const g = groups.get(key) || {
      supplierId: r.supplierId, supplierName: r.supplierName, rows: [], units: 0,
    };
    g.rows.push(r);
    g.units += r.suggestedQty;
    groups.set(key, g);
  }
  // Suppliers first, "not known" last: a group with no supplier cannot
  // become a purchase order without someone choosing one.
  return [...groups.values()].sort((a, b) =>
    (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || b.units - a.units);
}

/** Reads the "lines" parameter the reorder plan puts in a purchase order
 * link: "id:qty,id:qty". Pure and separate from the page so the parsing is
 * testable, and total about what it rejects -- a link is user-editable
 * input, and a malformed one must produce fewer lines, never a line with a
 * NaN quantity that silently becomes an order for nothing. */
export function parsePrefillLines(raw: string | null | undefined): Array<{
  productId: string; qty: number;
}> {
  const seen = new Set<string>();
  const out: Array<{ productId: string; qty: number }> = [];
  for (const part of String(raw || "").split(",")) {
    const [id, qtyRaw] = part.split(":");
    const productId = (id || "").trim();
    const qty = Math.floor(Number(qtyRaw));
    if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);
    out.push({ productId, qty });
  }
  return out;
}
