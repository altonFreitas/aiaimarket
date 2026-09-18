import { taxOn, type TaxLine } from "@/lib/money";

/* TAX, AT THE SHOP'S ONE RATE.
 *
 * A per-category rate was built here and removed at the shop's request: it
 * asked every category to answer a question this shop does not have, and a
 * setting nobody can answer is one that gets answered wrongly. The rate
 * lives in Settings.
 *
 * What survives is the per-LINE arithmetic, which is not the same thing and
 * is still needed: order_items.tax holds each line's share, because a
 * RETURN of one line has to give back the tax on that line -- refunding the
 * net price alone quietly keeps tax on goods the shop no longer sold.
 */

export interface MixedTax extends TaxLine {
  /** Each line's tax, in the order the lines came in. Sums to `tax`, or to
   * `includedTax` when prices are tax-inclusive, exactly. */
  perLine: number[];
}

/** Tax on an order, and each line's share of it.
 *
 * Each line is taxed and rounded on its own, and the total is the sum of the
 * rounded lines -- so what the order says and what its lines say are the
 * same number. Apportioning a rounded total backwards is what leaves a cent
 * the books cannot explain.
 *
 * THE DELIVERY FEE IS TAXED WITH THE GOODS. That is the ordinary treatment,
 * and it is said here so a shop for which it is wrong can find the sentence.
 *
 * TAX-INCLUSIVE IS NOT THE SAME SUM BACKWARDS: on $110 at 10% the tax
 * already inside is $10, not $11. taxOn() handles that; this calls it per
 * line so both directions stay in one place.
 */
export function taxOnLines(
  lineValues: readonly number[], fee: number, rate: number, included: boolean
): MixedTax {
  const round = (n: number) => Math.round(n * 100) / 100;
  const clean = lineValues.map((v) => Math.max(0, Number(v) || 0));
  const feeAmount = Math.max(0, Number(fee) || 0);

  const parts = clean.map((v) => taxOn(v, 0, rate, included));
  const feePart = taxOn(0, feeAmount, rate, included);

  const perLine = parts.map((p) => (included ? p.includedTax : p.tax));
  const sum = (ns: number[]) => round(ns.reduce((a, n) => a + n, 0));

  const goodsTax = sum(perLine);
  const tax = included ? 0 : round(goodsTax + feePart.tax);
  const includedTax = included ? round(goodsTax + feePart.includedTax) : 0;
  const gross = round(clean.reduce((a, v) => a + v, 0) + feeAmount);

  return {
    tax,
    net: included ? round(gross - includedTax) : gross,
    total: included ? gross : round(gross + tax),
    includedTax,
    perLine,
  };
}

/** Whether an order's tax was already inside its prices.
 *
 * Read back from the figures rather than from a column, because there is no
 * column: the order records what tax was charged and what the total was, and
 * the two say which way round it ran.
 *
 *   added on:  total = subtotal + fee + tax
 *   included:  total = subtotal + fee          (the tax is inside them)
 *
 * It matters on a receipt. "Tax $1.30" under a total that already contains
 * it invites the reader to add it again; "of which" does not.
 */
export function taxWasIncluded(o: {
  subtotal?: number | null; fee?: number | null;
  tax?: number | null; total?: number | null;
}): boolean {
  const tax = Number(o.tax) || 0;
  if (tax <= 0) return false;
  const goods = (Number(o.subtotal) || 0) + (Number(o.fee) || 0);
  const total = Number(o.total) || 0;
  return Math.abs(total - goods) < Math.abs(total - (goods + tax));
}
