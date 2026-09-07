/* Reading the heart on a product card.
 *
 * The number itself is one integer per product (products.loves, see
 * supabase/loves.sql) and it means one thing: how many times somebody
 * tapped the heart. It is a POPULARITY SIGNAL, not a vote and not a count
 * of people -- there are no accounts in this shop, so there is nobody to
 * count. Everything here is written to that reading, and the labels on
 * both screens say "loves" rather than "customers" for the same reason.
 *
 * Two callers, one place: the homepage's "Most loved" row and the admin
 * home's figure. They are the same question asked twice, and a second copy
 * of "what does a missing column count as" is how the two screens end up
 * disagreeing about a shop's most popular product.
 */
import type { Product } from "./types";

/** What one product's heart is worth, as a number that can be compared.
 *
 * A store that has not run supabase/loves.sql has no column to read, so
 * every row arrives without the field -- and that counts as zero, which is
 * the honest answer: nothing has been recorded. A stray negative or a
 * non-numeric value counts as zero too rather than poisoning a sort. */
export function loveCount(p: Pick<Product, "loves">): number {
  const n = Number(p.loves ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The most-loved products, best first, capped.
 *
 * Products nobody has hearted are LEFT OUT rather than ranked last. A row
 * called "Most loved" topped up with products at zero is a row of
 * recommendations the shop invented, and this file's whole claim is that
 * every number in it was tapped by somebody. The consequence is that the
 * row is empty on the day the feature ships, which is correct. */
export function mostLoved(products: readonly Product[], limit: number): Product[] {
  if (limit <= 0) return [];
  return products
    .filter((p) => loveCount(p) > 0)
    .sort((a, b) => loveCount(b) - loveCount(a))
    .slice(0, limit);
}

export interface LoveTotals {
  /** Every heart in the shop added up. */
  total: number;
  /** The single most-loved product, or null when nothing has been loved. */
  top: { id: string; name: string; loves: number } | null;
}

/** The shop's figure, for the admin home. One pass, because the caller
 * hands us the whole catalogue and there is no reason to walk it twice. */
export function loveTotals(products: readonly Product[]): LoveTotals {
  let total = 0;
  let top: LoveTotals["top"] = null;
  for (const p of products) {
    const n = loveCount(p);
    if (!n) continue;
    total += n;
    if (!top || n > top.loves) top = { id: p.id, name: p.name, loves: n };
  }
  return { total, top };
}
