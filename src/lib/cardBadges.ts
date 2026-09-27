/* WHAT A CATALOGUE CARD IS ALLOWED TO SHOUT.
 *
 * The reference draws NEW, SALE, LOW STOCK and BEST SELLER on its cards,
 * and every one of those is a claim. A shop that flags everything as new
 * has told the shopper nothing, so each one here has to be answerable
 * from the product row itself -- no editor's tick box, no "featured"
 * column nobody maintains.
 *
 *   NEW          the listing is younger than NEW_DAYS.
 *   -N%          there is a discount price genuinely below the price
 *                (discountPercent, lib/utils.ts).
 *   IN/LOW/OUT   the stock status the ledger maintains.
 *   BEST SELLER  passed in, and only for products the sales figures
 *                confirm -- see lib/sales.ts and the homepage.
 */

/** A month. Long enough that a shop posting a few listings a week always
 *  has something flagged, short enough that the flag still means it:
 *  a catalogue where every card says NEW is a catalogue with no new
 *  arrivals in it. */
export const NEW_DAYS = 30;

/** Is this listing new enough to say so?
 *
 * `now` is a parameter rather than a call to Date.now() so the answer can
 * be tested at a fixed instant, and so a page rendering many cards asks
 * the clock once. A missing or unparseable created_at is NOT new: the one
 * thing worse than missing the flag is printing it for everything. */
export function isNewProduct(
  createdAt: string | null | undefined,
  now: Date,
  days: number = NEW_DAYS,
): boolean {
  if (!createdAt) return false;
  const made = Date.parse(createdAt);
  if (!Number.isFinite(made)) return false;
  const age = now.getTime() - made;
  // A listing dated in the future is a clock problem, not a new arrival.
  if (age < 0) return false;
  return age < days * 24 * 60 * 60 * 1000;
}
