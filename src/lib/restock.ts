/* "This shelf is emptying" -- an alert before it is empty.
 *
 * The shop already gets told two things about stock: a product has run
 * out (out_of_stock_selling), and a product is below its reorder point
 * (reorder_now, from lib/replenishment.ts, which works from how fast it
 * actually sells and how long the supplier takes).
 *
 * This is a third and simpler question, and it is the one a shopkeeper
 * asks standing in front of the shelf: how much of what I last put out is
 * left? It needs no sales history and no supplier lead time, so it works
 * on the day a product is added -- which is exactly when the other two
 * cannot say anything useful yet.
 *
 * THE REFERENCE IS THE LAST RESTOCK, NOT THE HIGHEST EVER. products
 * .restock_level is written by the same database trigger that moves
 * products.qty, every time a movement adds stock (see
 * supabase/restock-alert.sql). So it is the quantity on hand immediately
 * after the most recent delivery or count-up. A high-water mark would
 * have been wrong in the ordinary case: a shop that once held 500 and now
 * deliberately stocks 20 would sit permanently in alert.
 */

/** Default: alert once a quarter of the last delivery has gone.
 *
 * The shop asked for 75%, meaning "still has three quarters left". That is
 * early, and deliberately so -- it is a heads-up for ordering, not a
 * warning that the shelf is nearly bare, and it is the number they can
 * change in Settings. */
export const DEFAULT_RESTOCK_PCT = 75;

export interface RestockInput {
  id: string;
  name: string;
  qty: number;
  /** Quantity on hand just after the last time stock was added. Absent on
   * a database that has not run supabase/restock-alert.sql, and on any
   * product that has never been restocked since it did. */
  restock_level?: number | null;
  archived?: boolean;
  status?: string;
}

export interface RestockRow {
  id: string;
  name: string;
  qty: number;
  level: number;
  /** How much of the last delivery is still on the shelf, 0-100, rounded.
   * What the alert shows, because "18 of 60 left" is a fact a person can
   * act on and "below threshold" is not. */
  remainingPct: number;
}

/** Clamps a percentage a person typed into something usable.
 *
 * 0 would alert on everything the instant it was delivered; 100 likewise.
 * Anything outside falls back to the default rather than to the nearest
 * edge, because a stored 0 is far more likely to be "never configured"
 * than a deliberate request to be alerted about every product forever. */
export function normalizeRestockPct(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RESTOCK_PCT;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 99) return DEFAULT_RESTOCK_PCT;
  return rounded;
}

/** Has this product fallen to `pct`% or less of its last delivery?
 *
 * Says no when it has run out entirely. That is not this alert being
 * blind: an empty shelf is already reported, more urgently, by
 * out_of_stock_selling, and saying it twice in two different words is how
 * a to-do list stops being read. */
export function needsRestock(
  qty: number, level: number | null | undefined, pct: number
): boolean {
  const have = Number(qty);
  const from = Number(level);
  // No reference means nothing has been delivered since this feature
  // existed, so there is nothing to compare against. Not an alert.
  if (!Number.isFinite(from) || from <= 0) return false;
  if (!Number.isFinite(have) || have <= 0) return false;
  return have <= (from * pct) / 100;
}

/** The products worth mentioning, emptiest first.
 *
 * Archived and unapproved products are skipped: nobody can buy them, so
 * restocking them is not a task. */
export function restockAlerts(
  products: readonly RestockInput[], pct = DEFAULT_RESTOCK_PCT
): RestockRow[] {
  const threshold = normalizeRestockPct(pct);
  const rows: RestockRow[] = [];

  for (const p of products) {
    if (p.archived) continue;
    if (p.status && p.status !== "approved") continue;
    if (!needsRestock(p.qty, p.restock_level, threshold)) continue;
    const level = Number(p.restock_level);
    rows.push({
      id: p.id,
      name: p.name,
      qty: Number(p.qty),
      level,
      remainingPct: Math.round((Number(p.qty) / level) * 100),
    });
  }

  // Emptiest first, then by name so the order does not shuffle between
  // two products sitting at the same percentage.
  rows.sort((a, b) => a.remainingPct - b.remainingPct || a.name.localeCompare(b.name));
  return rows;
}
