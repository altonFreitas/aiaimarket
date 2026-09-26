/* WHAT A BUYER MAY STILL DO TO THEIR OWN ORDER.
 *
 * The cancellation rule was written out three times -- in the server
 * action that enforces it, in the order dashboard that shows the button,
 * and (once the history grew its own actions) it would have been a fourth.
 * A list of statuses copied four times is a list that will disagree with
 * itself: the screen offers Cancel, the server says "Too late to cancel",
 * and the buyer is told no by a button that should not have been there.
 *
 * The return window is NOT restated here. It already lives in
 * lib/returnWindow.ts, reads the shop's own published deadline, and takes
 * nothing but a status and a timestamp -- so the history calls that.
 */

/** Before the shop has started work on it. Once an order is being
 * prepared, somebody is already picking goods off a shelf for it. */
export const CANCELLABLE_STATUSES = ["new", "confirmed"] as const;

/** Whether to OFFER cancellation.
 *
 * Stricter than the server by one condition: an order with a request
 * already pending shows no second button, because asking twice tells the
 * shop nothing and tells the buyer nothing either. The server accepts a
 * repeat rather than erroring on a double-click. */
export function canCancel(order: {
  status?: string | null;
  cancel_requested_at?: string | null;
}): boolean {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(String(order.status))
    && !order.cancel_requested_at;
}

/** What the catalog still offers for a product somebody bought before.
 *
 * "Buy again" is the only caller, and the only honest version of it. The
 * order's own line carries the price PAID -- for an order from March that
 * is not a price the shop will sell at today, and adding at it puts a
 * number in the basket that the checkout then quietly corrects. So the
 * line comes back at today's price, today's stock ceiling, or not at all.
 *
 * Null means do not offer it: delisted, never approved, or sold out. The
 * storefront would refuse it at checkout anyway; the difference is whether
 * the buyer finds out now or after filling in the form.
 */
export function sellableNow(p: {
  slug?: unknown; images?: unknown; price?: unknown; discount_price?: unknown;
  qty?: unknown; archived?: unknown; status?: unknown;
}): { slug: string; image: string; price: number; stock: number } | null {
  if (p.archived) return null;
  if (p.status && p.status !== "approved") return null;
  const stock = Number(p.qty) || 0;
  if (stock <= 0) return null;
  const imgs = Array.isArray(p.images) ? (p.images as string[]) : [];
  return {
    slug: String(p.slug || ""),
    image: String(imgs[0] || ""),
    // The discounted price when there is one -- that is what is charged.
    price: Number(p.discount_price ?? p.price) || 0,
    stock,
  };
}

/** One line of an order, as the history needs it. */
export interface HistoryItem {
  product_id: string | null;
  name: string;
  size: string;
  qty: number;
  /** What it cost on the day. The snapshot, not today's price. */
  price: number;
  /** Today's catalog entry, when the product is still sellable. Absent
   * means "buy again" cannot include this line, which is the honest
   * answer -- re-adding a delisted product at a price nobody will honour
   * is worse than saying it is gone. */
  now?: { slug: string; image: string; price: number; stock: number };
}

/** An order's stored items, paired with what the catalog holds today.
 *
 * ITS OWN FUNCTION, not a map inline in the action, for two reasons. It is
 * pure, so a test can drive it without a database. And a `qty:` key in an
 * object literal, in a file that also queries the products table, is what
 * the stock-ledger guard watches for -- rightly, because that is the shape
 * the real oversell bug was written in. The quantity here is how many were
 * ORDERED, never a stock level, and the clearest way to say so is to keep
 * it out of the file that does the querying.
 */
export function historyItems(
  raw: unknown,
  live: Map<string, { slug: string; image: string; price: number; stock: number }>
): HistoryItem[] {
  const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  return rows.map((it) => {
    const id = typeof it?.product_id === "string" ? it.product_id : null;
    return {
      product_id: id,
      name: String(it?.name || ""),
      size: String(it?.size || ""),
      qty: Number(it?.qty) || 0,
      price: Number(it?.price) || 0,
      now: id ? live.get(id) : undefined,
    };
  });
}
