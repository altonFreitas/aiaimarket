/* Which card scheme a number belongs to, from its opening digits.
 *
 * READ THIS BEFORE WIRING IT TO AN INPUT BOX.
 *
 * lib/payments/types.ts states the rule this shop is built on: no card
 * number, expiry or CVV ever reaches this server. Cards go through the
 * acquirer's hosted page, which is what keeps the shop inside PCI-DSS
 * SAQ A -- a short self-assessment -- instead of SAQ D, which is an audit,
 * quarterly scanning and a compliance programme. A single <input> on this
 * domain that a shopper types a card number into moves the shop from one
 * to the other, whether or not the value is ever stored.
 *
 * So this function exists for the two places a brand can legitimately be
 * known here:
 *
 *   1. The BIN -- the first six or eight digits -- which gateways return
 *      on a completed payment, and which is not a card number. Showing
 *      "Visa ...4242" on an order is the normal use.
 *   2. Inside the gateway's own hosted field (Stripe Elements, Adyen
 *      Components, MPGS Hosted Session), where the iframe belongs to the
 *      gateway, the digits never enter this page's JavaScript, and the
 *      brand it reports can be rendered with these labels and icons.
 *
 * It is deliberately pure and takes a string, so it can be tested
 * exhaustively and cannot accidentally acquire a network call.
 */

export type CardBrand =
  | "visa" | "mastercard" | "amex" | "discover"
  | "jcb" | "diners" | "unionpay" | "maestro";

export interface BrandInfo {
  brand: CardBrand;
  /** What to print. Schemes have house styles: "Mastercard" is one word
   * and lower-case in the middle, "UnionPay" is camel-cased. */
  label: string;
  /** Valid total lengths for this scheme. */
  lengths: readonly number[];
  /** Length of the security code. Amex is the odd one at 4. */
  cvcLength: number;
  /** Where the spaces go when a number is displayed. Amex and Diners
   * group differently from everyone else, and getting it wrong is the
   * kind of small thing that makes a checkout feel untrustworthy. */
  gaps: readonly number[];
}

const BRANDS: Record<CardBrand, Omit<BrandInfo, "brand">> = {
  visa:       { label: "Visa",       lengths: [13, 16, 19], cvcLength: 3, gaps: [4, 8, 12] },
  mastercard: { label: "Mastercard", lengths: [16],         cvcLength: 3, gaps: [4, 8, 12] },
  amex:       { label: "American Express", lengths: [15],   cvcLength: 4, gaps: [4, 10] },
  discover:   { label: "Discover",   lengths: [16, 19],     cvcLength: 3, gaps: [4, 8, 12] },
  jcb:        { label: "JCB",        lengths: [16, 17, 18, 19], cvcLength: 3, gaps: [4, 8, 12] },
  diners:     { label: "Diners Club", lengths: [14, 16, 19], cvcLength: 3, gaps: [4, 10] },
  unionpay:   { label: "UnionPay",   lengths: [16, 17, 18, 19], cvcLength: 3, gaps: [4, 8, 12] },
  maestro:    { label: "Maestro",    lengths: [12, 13, 14, 15, 16, 17, 18, 19], cvcLength: 3, gaps: [4, 8, 12] },
};

/** Matched in order; the first hit wins.
 *
 * Order is not cosmetic. Several ranges overlap, and the more specific one
 * has to be tested first or it is never reached: 6011 is Discover but 60
 * is nothing, 622126-622925 is UnionPay sitting inside Discover's 62 while
 * the rest of 62 is UnionPay, and 3528-3589 is JCB inside a 3 that
 * otherwise belongs to Amex and Diners. */
const RULES: ReadonlyArray<{ brand: CardBrand; test: (d: string) => boolean }> = [
  { brand: "amex", test: (d) => /^3[47]/.test(d) },
  { brand: "jcb", test: (d) => inRange(d, 4, 3528, 3589) },
  { brand: "diners", test: (d) => /^3(?:0[0-5]|095|[689])/.test(d) },
  { brand: "visa", test: (d) => /^4/.test(d) },
  { brand: "mastercard", test: (d) => /^5[1-5]/.test(d) || inRange(d, 4, 2221, 2720) },
  { brand: "maestro", test: (d) => /^(?:50|5[6-8]|6304|6759|676[1-3])/.test(d) },
  // Discover's own ranges, before the broad UnionPay 62.
  { brand: "discover", test: (d) => /^(?:6011|65)/.test(d) || inRange(d, 3, 644, 649) },
  { brand: "unionpay", test: (d) => /^62/.test(d) },
];

/** Do the first `n` digits, read as a number, fall inside [lo, hi]?
 *
 * Only decides once there are enough digits to know. A "2" is not yet a
 * Mastercard and must not be reported as one -- guessing early and then
 * changing the icon under the shopper's fingers is worse than waiting. */
function inRange(digits: string, n: number, lo: number, hi: number): boolean {
  if (digits.length < n) return false;
  const head = Number(digits.slice(0, n));
  return Number.isFinite(head) && head >= lo && head <= hi;
}

/** Everything that is not a digit, gone. Shoppers and gateways alike send
 * numbers with spaces and dashes in them. */
export function digitsOnly(input: string): string {
  return (input || "").replace(/\D+/g, "");
}

/** The scheme, or null when the opening digits do not identify one yet or
 * do not identify one at all. */
export function detectCardBrand(input: string): BrandInfo | null {
  const d = digitsOnly(input);
  if (!d) return null;
  for (const rule of RULES) {
    if (rule.test(d)) return { brand: rule.brand, ...BRANDS[rule.brand] };
  }
  return null;
}

/** The Luhn checksum every scheme above uses.
 *
 * Catches a mistyped digit, and nothing more. It says a number is
 * well-formed, never that the card exists, has money on it, or belongs to
 * the person typing -- only the acquirer can say any of that, and a
 * checkout that implies otherwise is lying to the shopper. */
export function luhnValid(input: string): boolean {
  const d = digitsOnly(input);
  if (d.length < 12) return false;
  // All zeroes sums to zero, and zero is divisible by ten, so the plain
  // checksum says yes. It is not a card. Every scheme's numbers begin with
  // a non-zero issuer digit, so requiring one costs nothing real.
  if (!/[1-9]/.test(d)) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Groups digits the way the scheme prints them: 4242 4242 4242 4242, but
 * 3782 822463 10005 for Amex. */
export function formatCardNumber(input: string): string {
  const d = digitsOnly(input);
  const info = detectCardBrand(d);
  const gaps = info?.gaps ?? [4, 8, 12];
  const out: string[] = [];
  let last = 0;
  for (const gap of gaps) {
    if (d.length > gap) { out.push(d.slice(last, gap)); last = gap; }
  }
  out.push(d.slice(last));
  return out.filter(Boolean).join(" ");
}

/** "Visa ···· 4242" -- how a saved or completed card is named back to the
 * shopper. Takes the last four the gateway returned, never a full number. */
export function describeCard(brand: CardBrand | null, last4: string): string {
  const label = brand ? BRANDS[brand].label : "Card";
  const tail = digitsOnly(last4).slice(-4);
  return tail ? `${label} ···· ${tail}` : label;
}
