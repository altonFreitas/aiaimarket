/* WHAT THE SHOP QUOTES IN, AND WHAT IT CHARGES TAX AT.
 *
 * NOT lib/payments/money.ts. That file is about handing a gateway integer
 * minor units, and its SUPPORTED_CURRENCIES is the list the card processor
 * accepts. This one is about what a shopper is shown. They are genuinely
 * different questions: a shop may quote in AUD and still settle in USD,
 * because the bank decides the second and the shop decides the first.
 *
 * TIMOR-LESTE USES THE US DOLLAR, so this changes nothing for the shop it
 * was written for -- USD is the default and needs no rate. What it buys is
 * the ability to be wrong LATER rather than now: the moment a shop quotes in
 * anything else, every historical total has to keep meaning what it meant on
 * the day it was agreed, and that is only possible if the rate was captured
 * on the order. Retrofitting that to a year of orders is not possible at
 * all, which is why it goes in while there are few orders to carry.
 */

export interface CurrencyInfo {
  /** What to print. "$", "A$", "Rp". */
  symbol: string;
  /** Decimal places. Not every currency has two -- IDR and JPY have none,
   * and multiplying by 100 regardless is the bug that bites the day a
   * second currency is added. */
  digits: number;
  /** false when the symbol follows the number, as it does in Portuguese
   * and in most of Europe. */
  symbolFirst: boolean;
}

/* THE DOLLAR, AND ONLY THE DOLLAR.
 *
 * Timor-Leste uses the US dollar. This shop prices in dollars, banks
 * dollars and is handed dollars at the door, so there is one currency here
 * and it is not configurable.
 *
 * A picker offering five was tried and taken out: it was a question with
 * one true answer, and the only thing it could do was be set wrong -- which
 * it was, and which printed euro symbols over dollar figures until it was
 * set back. Converting instead would have meant a live rate on every page
 * and a currency of record that was no longer the currency in the till.
 *
 * The COLUMN stays on settings and orders. Every order already records what
 * it was agreed in, and the day a shop here does quote in something else,
 * the old orders will still say dollars rather than "unknown". */
export const DISPLAY_CURRENCIES: Record<string, CurrencyInfo> = {
  USD: { symbol: "$", digits: 2, symbolFirst: true },
};

export const DEFAULT_CURRENCY = "USD";

/** Anything a row may hold, as the one code this shop prints.
 *
 * Still a function rather than a constant: settings rows and orders written
 * before this simplification may carry EUR or IDR, and a receipt for one of
 * them must print a figure rather than throw. What it cannot do is print a
 * euro symbol over a dollar amount -- the figures were always dollars. */
export function normalizeCurrencyCode(v: unknown): string {
  const code = String(v ?? "").trim().toUpperCase();
  return code in DISPLAY_CURRENCIES ? code : DEFAULT_CURRENCY;
}

export function currencyInfo(code: string): CurrencyInfo {
  return DISPLAY_CURRENCIES[normalizeCurrencyCode(code)];
}

/** A number, as this shop writes money.
 *
 * THE SIGN GOES OUTSIDE THE SYMBOL. "$-586.30" is what you get from
 * concatenating a symbol onto a formatted negative, and on the one figure a
 * profit-and-loss screen exists to produce it reads as a typo. */
export function formatMoney(amount: number | string, code = DEFAULT_CURRENCY): string {
  const info = currencyInfo(code);
  const n = Number(amount) || 0;
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: info.digits, maximumFractionDigits: info.digits,
  });
  const sign = n < 0 ? "-" : "";
  return info.symbolFirst
    ? `${sign}${info.symbol}${body}`
    : `${sign}${body} ${info.symbol}`;
}

/* ---------------------------------------------------------------------------
 * Tax
 * ------------------------------------------------------------------------ */

/** A percentage a person typed, as the fraction the arithmetic wants.
 *
 * 2.5 in the box is 0.025 in the column. Refuses anything outside 0-100 by
 * falling back to zero: a shop that fat-fingers 250 must not start charging
 * two hundred and fifty percent, and charging nothing is the safe direction
 * to fail in -- it is visible on the next invoice rather than silent. */
export function normalizeTaxRate(percent: unknown): number {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 0;
  return Math.round(n * 1e4) / 1e6;   // 2.5 -> 0.025, to four decimals of a %
}

/** The stored fraction, back as the percentage the shop typed. */
export function taxRateAsPercent(rate: unknown): number {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1e6) / 1e4;
}

export interface TaxLine {
  /** What the buyer is charged on top, in currency units. Zero when the
   * shop charges none, and zero when prices already include it. */
  tax: number;
  /** Goods plus fee, before tax. */
  net: number;
  /** What the buyer pays. */
  total: number;
  /** The tax already inside the price, when prices are tax-inclusive. Shown
   * as "of which" rather than added on -- a buyer told a price must pay that
   * price. */
  includedTax: number;
}

/** Tax on an order, computed one way for both directions.
 *
 * TAX-INCLUSIVE IS NOT THE SAME SUM BACKWARDS. On a $100 price at 10%, tax
 * added on is $10 and tax already inside is $9.09 -- because the $100 is the
 * gross, and 100/1.1 is 90.91. Getting that wrong overstates what the shop
 * owes by a tenth, every time, and it is the single most common error in
 * hand-rolled tax code.
 *
 * The DELIVERY FEE is taxed with the goods. Whether it should be is a
 * question for the shop's accountant and not for this function; it is the
 * ordinary treatment, and it is stated here so that a shop for which it is
 * wrong can find the sentence.
 */
export function taxOn(subtotal: number, fee: number, rate: number, included: boolean): TaxLine {
  const base = Math.max(0, (Number(subtotal) || 0) + (Number(fee) || 0));
  const r = Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : 0;
  const round = (n: number) => Math.round(n * 100) / 100;

  if (!r) return { tax: 0, net: round(base), total: round(base), includedTax: 0 };

  if (included) {
    // The price the buyer was quoted is the total. Work the tax back out of it.
    const net = round(base / (1 + r));
    return { tax: 0, net, total: round(base), includedTax: round(base - net) };
  }
  const tax = round(base * r);
  return { tax, net: round(base), total: round(base + tax), includedTax: 0 };
}

/** Converts a figure quoted in `currency` into USD, at the rate captured on
 * the order. The gateway and the shop's own books are both in USD; only the
 * quote is not. */
export function toBase(amount: number, fxRate: number): number {
  const r = Number(fxRate);
  const rate = Number.isFinite(r) && r > 0 ? r : 1;
  return Math.round((Number(amount) || 0) * rate * 100) / 100;
}
