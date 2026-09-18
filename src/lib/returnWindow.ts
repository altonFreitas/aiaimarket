import type { Order } from "@/lib/types";

/* HOW LONG A RETURN STAYS OPEN.
 *
 * There was no window at all. "Ask to return something" sat on an order
 * that had been paid, collected and finished a month earlier, because the
 * only condition was that the order had arrived -- and an order that has
 * arrived stays arrived for ever.
 *
 * Meanwhile the shop's own Returns page has always said "contact us within
 * N days of receiving your order", with N typed into Settings. The page
 * promised a deadline the app did not keep.
 *
 * So the deadline is the shop's own published number. Not a constant in
 * the source: a shop that publishes 3 days and a button that works on day
 * 30 is the same contradiction the other way round.
 */

/** The fallback when the shop has not filled in its return window.
 *
 * A week: long enough to notice a fault in something delivered, short
 * enough that "it arrived broken" is still a claim about delivery. It
 * applies only until the shop states its own figure, and the Returns page
 * says "FILL IN" until then, so nobody has been promised anything else. */
export const DEFAULT_RETURN_DAYS = 7;

/** Days a buyer has, from the shop's settings. */
export function returnDays(settings?: { legal_return_days?: number | null } | null): number {
  const n = Number(settings?.legal_return_days);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_RETURN_DAYS;
}

/** Whether this order can still be sent back, and why not when it cannot.
 *
 * COUNTED FROM THE ORDER'S OWN TIMESTAMP, not from when the customer says
 * it arrived: the database records when the order was placed, and nothing
 * records the doorstep. Placement is therefore the earliest defensible
 * start, which makes the window slightly generous rather than slightly
 * short -- the right direction to be wrong in on a consumer right.
 */
export function returnWindow(
  order: Pick<Order, "status" | "created_at">,
  settings: { legal_return_days?: number | null } | null | undefined,
  now: number = Date.now()
): { open: boolean; days: number; closedOn: number | null } {
  const days = returnDays(settings);
  // Nothing to send back before it has arrived.
  if (!["arrived", "completed"].includes(String(order.status))) {
    return { open: false, days, closedOn: null };
  }
  const placed = Date.parse(String(order.created_at));
  if (!Number.isFinite(placed)) {
    // No usable timestamp: leave it open rather than refuse a buyer a right
    // because of a missing field. The admin can still decline.
    return { open: true, days, closedOn: null };
  }
  const closedOn = placed + days * 86_400_000;
  return { open: now <= closedOn, days, closedOn };
}
