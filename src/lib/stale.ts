/* WHAT IS SITTING ON THE SHELF NOT SELLING.
 *
 * A shop's worst stock is not the stock it has run out of -- that one is
 * loud, and the to-do list already shouts about it. It is the stock nobody
 * has bought for two months, which says nothing at all: the money is spent,
 * the shelf is full, and the only sign is a number that never moves.
 *
 * So this finds it, and the shop decides what to do -- usually a discount,
 * which is why the notice links to the catalogue with these products
 * already filtered.
 *
 * NEVER SOLD IS MEASURED FROM THE DAY IT WAS LISTED, not treated as
 * infinitely old. A product listed yesterday has not sold either, and
 * reporting it beside one that has sat there since March would bury the
 * March one. It becomes stale on the same terms as everything else, once
 * the days have actually passed.
 *
 * Pure, so every rule below is testable without a database. What it is
 * given comes from lib/data/stale.ts.
 */

export const DEFAULT_STALE_DAYS = 30;
const DAY_MS = 86_400_000;

/** A number of days the shop typed, as a number of days this can use.
 *
 * Refuses anything outside 1-365 by falling back to the default: a shop
 * that fat-fingers 3000 must not silently turn the notice off for eight
 * years, and zero would report the entire catalogue every morning. */
export function normalizeStaleDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_STALE_DAYS;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 365) return DEFAULT_STALE_DAYS;
  return rounded;
}

export interface StaleCandidate {
  id: string;
  name: string;
  /** When the product was listed. The clock for one that has never sold. */
  createdAt: string;
  /** The last time one was sold, or null if never. */
  lastSoldAt: string | null;
}

export interface StaleProduct {
  id: string;
  name: string;
  /** Whole days since the last sale, or since listing when there has been
   * no sale at all. What the shop is actually being told. */
  days: number;
  /** True when nobody has ever bought one. Worth saying: a product that
   * sold well until March is a different problem from one that has never
   * interested anybody, and the second is usually the pricing. */
  neverSold: boolean;
}

/** The products that have not sold for `days` or more, longest first.
 *
 * Ties break on the name so the list is stable between renders -- a to-do
 * list that reshuffles itself is one nobody trusts.
 */
export function staleProducts(
  candidates: readonly StaleCandidate[], days: number, nowMs: number
): StaleProduct[] {
  const limit = normalizeStaleDays(days);
  const out: StaleProduct[] = [];

  for (const c of candidates) {
    const since = c.lastSoldAt ?? c.createdAt;
    const ms = Date.parse(since);
    // A row with no usable date says nothing, and inventing one would put
    // it at the top of the list for ever.
    if (!Number.isFinite(ms)) continue;
    const idle = Math.floor((nowMs - ms) / DAY_MS);
    if (idle < limit) continue;
    out.push({ id: c.id, name: c.name, days: idle, neverSold: c.lastSoldAt == null });
  }

  return out.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}
