/* WHAT A GRID CARD SAYS ABOUT COLOURS AND SIZES -- the shapes, and the
 * one rule that is easy to get wrong.
 *
 * The reading lives here rather than beside the queries so it can be
 * tested without a database: it is arithmetic on two lists, and the
 * arithmetic is where the bug would be. See lib/data/cardFacts.ts for
 * where the lists come from.
 */

export interface CardColor {
  /** The value as stored, which is what a filter link would carry. */
  value: string;
  /** What to print: the typed word, or the nearest name for a hex. */
  name: string;
  /** A CSS colour for the dot, or null when the value names nothing
   * drawable -- then no dot is drawn rather than a black one meaning
   * "not understood". */
  swatch: string | null;
}

export interface CardSize {
  size: string;
  /** true in stock, false sold out, null when nothing is known.
   *
   * THREE STATES, AND THAT IS THE POINT. Two would make "we never counted
   * this" look like "there are none of these", and the card would strike
   * through every size of a product the ledger has simply never been told
   * about -- a full shelf drawn as sold out. */
  inStock: boolean | null;
}

export interface CardFacts {
  colors: CardColor[];
  sizes: CardSize[];
}

/** A card is a label, not a picker. Six chips is what fits on a 2-up phone
 *  card without the body growing taller than the photo; the rest are one
 *  tap away on the product page. */
export const MAX_SIZES = 6;
/** Same reasoning, and five dots is already a wide row at 12px each. */
export const MAX_COLORS = 5;

/** One product's size row.
 *
 * @param sizes  the sizes the LISTING offers, in the order it lists them.
 * @param rows   that product's ledger balances, or undefined when the
 *               ledger has no rows for it at all -- which is not the same
 *               as rows that all read zero.
 */
export function cardSizes(
  sizes: readonly string[] | null | undefined,
  rows: readonly { size: string; qty: number }[] | undefined,
): CardSize[] {
  /* The ledger is keyed on the size as the shelf spells it; the listing is
     keyed on the size as the seller typed it. Fold both before comparing,
     or "M " and "m" are two different sizes and one of them is always out
     of stock. */
  const bySize = new Map<string, number>();
  for (const r of rows ?? []) {
    const k = String(r.size ?? "").trim().toLowerCase();
    bySize.set(k, (bySize.get(k) ?? 0) + (Number(r.qty) || 0));
  }
  return (sizes ?? []).slice(0, MAX_SIZES).map((s) => ({
    size: s,
    inStock: rows == null ? null : (bySize.get(s.trim().toLowerCase()) ?? 0) > 0,
  }));
}
