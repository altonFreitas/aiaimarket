import { taxOn, type TaxLine } from "@/lib/money";

/* TAX, WHEN NOT EVERYTHING IS TAXED THE SAME.
 *
 * One rate for a whole shop is the simple case, not the usual one. Most tax
 * codes charge food, books, medicine and electronics differently, and a shop
 * selling two of those cannot describe itself with one number -- it either
 * overcharges on one and pockets the difference, or undercharges and owes it.
 *
 * So the rate belongs to the CATEGORY, and the shop's rate is the default
 * for categories that have not said otherwise.
 */

/** A rate a category may carry.
 *
 * `null`/`undefined` means the category has not been given one and is taxed
 * at the shop's rate. `0` means somebody decided these goods are not taxed,
 * and that decision has to survive the shop-wide rate being raised later --
 * which is exactly why the two cannot be the same value. */
export type CategoryRate = number | null | undefined;

/** The rate that actually applies to a line.
 *
 * The one function that knows what "no rate" means, so nothing else has to
 * remember which of null and 0 is which. */
export function rateFor(categoryRate: CategoryRate, shopRate: number): number {
  const shop = Number.isFinite(Number(shopRate)) && Number(shopRate) > 0
    ? Number(shopRate) : 0;
  if (categoryRate == null) return shop;          // never answered -> shop's
  const own = Number(categoryRate);
  if (!Number.isFinite(own) || own < 0 || own > 1) return shop;  // junk -> shop's
  return own;                                     // answered, including 0
}

export interface TaxableLine {
  /** Money this line is worth, quantity already applied. */
  value: number;
  /** The rate this line's category carries, if any. */
  categoryRate?: CategoryRate;
}

export interface MixedTax extends TaxLine {
  /** Each line's tax, in the order the lines came in. Sums to `tax`
   * exactly, or to `includedTax` when prices are tax-inclusive. */
  perLine: number[];
  /** The one rate that describes this whole order -- every line AND the
   * delivery fee -- or null when no single number does.
   *
   * The checkout prints "Tax (10%)" only when this is set. An earlier
   * version asked only whether the LINES agreed, which said "Tax (10%)"
   * over an order of zero-rated food whose only tax was ten cents on the
   * delivery: true of the fee, false of everything the customer was
   * looking at, and printed as if it described the order. */
  uniformRate: number | null;
}

/** Tax on an order whose lines may be taxed differently.
 *
 * Each line is taxed at its own rate and the results are added, rather than
 * one rate being applied to the subtotal. With a $100 line at 10% and a $100
 * line at 0%, an average rate of 5% would charge $10 -- the right total by
 * accident here, and wrong the moment the two lines are not equal.
 *
 * THE DELIVERY FEE IS TAXED AT THE SHOP'S RATE. It is not goods and belongs
 * to no category, so there is nothing else it could honestly take. A shop
 * whose tax code says otherwise should read this paragraph and change it.
 *
 * TAX-INCLUSIVE IS NOT THE SAME SUM BACKWARDS: on $100 at 10%, tax added on
 * is $10 and tax already inside is $9.09. taxOn() handles that; this
 * function calls it per line so both directions stay in one place.
 *
 * ROUNDING: each line is rounded to the cent and the total is the sum of the
 * rounded lines, so what the order says and what its lines say are the same
 * number. Apportioning a rounded total backwards is what leaves a cent the
 * books cannot explain.
 */
export function taxOnLines(
  lines: readonly TaxableLine[], fee: number, shopRate: number, included: boolean
): MixedTax {
  const shop = rateFor(null, shopRate);
  const rates = lines.map((l) => rateFor(l.categoryRate, shop));
  const round = (n: number) => Math.round(n * 100) / 100;

  const parts = lines.map((l, i) =>
    taxOn(Math.max(0, Number(l.value) || 0), 0, rates[i], included));
  const feePart = taxOn(0, Math.max(0, Number(fee) || 0), shop, included);

  const perLine = parts.map((p) => (included ? p.includedTax : p.tax));
  const sum = (ns: number[]) => round(ns.reduce((a, n) => a + n, 0));

  const goodsTax = sum(perLine);
  const tax = included ? 0 : round(goodsTax + feePart.tax);
  const includedTax = included ? round(goodsTax + feePart.includedTax) : 0;
  const gross = round(
    lines.reduce((a, l) => a + Math.max(0, Number(l.value) || 0), 0)
    + Math.max(0, Number(fee) || 0));

  /* The fee counts only when there IS a fee: a collected order whose lines
     are all zero-rated is honestly described as 0%, and dragging the shop's
     rate in for a delivery that is not happening would suppress a true
     statement. */
  const relevant = Number(fee) > 0 ? [...rates, shop] : rates;
  const uniformRate = relevant.length > 0 && relevant.every((r) => r === relevant[0])
    ? relevant[0] : null;

  return {
    tax,
    net: included ? round(gross - includedTax) : gross,
    total: included ? gross : round(gross + tax),
    includedTax,
    perLine,
    uniformRate,
  };
}

/** The category-id -> rate map the checkout prices lines with.
 *
 * Only categories that actually carry a rate are included. An absent entry
 * means "not answered", which rateFor() reads as the shop's rate -- so a
 * shop that has never touched this feature sends an empty object and every
 * line is taxed exactly as it was before per-category tax existed.
 *
 * A category whose rate is 0 IS included, because zero is an answer. */
export function categoryTaxRates(
  categories: readonly { id: string; tax_rate?: number | null }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of categories) {
    if (c.tax_rate == null) continue;
    const n = Number(c.tax_rate);
    if (Number.isFinite(n) && n >= 0 && n <= 1) out[c.id] = n;
  }
  return out;
}
