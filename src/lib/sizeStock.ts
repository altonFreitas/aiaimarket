/* STOCK, PER SIZE.
 *
 * products.sizes has always been a list of labels and products.qty a single
 * number for all of them together, so the shop could say it had thirty
 * t-shirts and not how many were Medium. A shopper was offered Large on a
 * product with none left in Large; the shelf ran out of one size while the
 * reorder alert stayed quiet because the total still looked healthy.
 *
 * The balances come from the ledger, grouped one column further -- see
 * supabase/size-stock.sql. Everything here is pure: given rows, it returns
 * figures, so every rule below is testable without a database.
 *
 * THE UNSIZED POOL. A balance under the empty size is not stock of no size;
 * it is stock whose size nobody recorded -- either goods that genuinely have
 * none (a fridge) or shelves counted before any of this existed. It backs
 * every size, because some of those thirty shirts ARE Medium, and a shop
 * that has never tracked sizes therefore behaves exactly as it did before.
 * That is the property that makes this safe to turn on mid-trading.
 */

/** The size a row carries when nobody has said. Not null: one value that
 * groups and compares like any other, so a forgotten check cannot split a
 * product's stock into two piles. */
export const NO_SIZE = "";

export interface SizeBalance {
  size: string;
  qty: number;
}

/** One product's stock, per size, as the screens want it. */
export interface SizedStock {
  /** Balance for each size the shop has recorded, biggest label order
   * preserved from the product rather than sorted alphabetically -- S, M, L
   * is a sequence and "L, M, S" is not. */
  sizes: SizeBalance[];
  /** Stock whose size was never recorded. Shown separately, never folded
   * into a size: saying it is Medium would be inventing inventory. */
  unsized: number;
  /** Every unit, sized or not. Equals products.qty. */
  total: number;
  /** True once ANY size has been counted. Until then the shop is running
   * the way it always did and no screen should imply otherwise. */
  tracked: boolean;
}

/** What a shopper may take of one size.
 *
 * The size's own balance plus the unsized pool -- the rule the database
 * enforces in size_available(), restated here so the storefront can decide
 * what to offer without a round trip. The two must agree; see the test.
 */
export function availableInSize(stock: SizedStock, size: string): number {
  if (!size) return stock.total;
  const own = stock.sizes.find((s) => s.size === size)?.qty ?? 0;
  return Math.max(0, own + stock.unsized);
}

/** Build one product's picture from the ledger's grouped rows.
 *
 * `order` is the product's own sizes list, which is what keeps S, M, L in
 * that order. A size that has a balance but is no longer on the product --
 * it was dropped from the list while units remained -- is appended rather
 * than hidden: those units exist and somebody has to be able to see them.
 */
export function sizedStock(
  rows: readonly SizeBalance[], order: readonly string[] = []
): SizedStock {
  const by = new Map<string, number>();
  for (const r of rows) {
    const k = (r.size ?? "").trim();
    by.set(k, (by.get(k) ?? 0) + (Number(r.qty) || 0));
  }
  const unsized = by.get(NO_SIZE) ?? 0;
  by.delete(NO_SIZE);

  /* TRACKED IS DECIDED BY THE LEDGER, NOT BY THE PRODUCT'S LABELS.
   *
   * It used to be `sizes.length > 0` after the padding below, which is
   * true for any product that merely LISTS S, M, L -- so a shop with
   * thirty unsized shirts was reported as tracking three sizes of zero,
   * and every screen that reads this flag would have shown a full shelf
   * as sold out in every size. That is the exact failure this flag exists
   * to prevent, and it was the flag causing it.
   *
   * Taken from the rows instead: product_size_stock returns a row for
   * every size the ledger has ever moved, so a size received and then
   * sold down to nothing still appears -- at zero, which is a real answer
   * and stays tracked -- while a size never received has no row at all. */
  const tracked = rows.some((r) => (r.size ?? "").trim() !== NO_SIZE);

  const sizes: SizeBalance[] = [];
  for (const s of order) {
    const k = s.trim();
    if (!k) continue;
    sizes.push({ size: k, qty: by.get(k) ?? 0 });
    by.delete(k);
  }
  // Whatever is left has stock but is off the product's list.
  for (const [size, qty] of by) sizes.push({ size, qty });

  return {
    sizes,
    unsized,
    total: unsized + sizes.reduce((n, s) => n + s.qty, 0),
    tracked,
  };
}

/* ---------------------------------------------------------------------------
 * Buying by size
 * ------------------------------------------------------------------------ */

/** {"S": 5, "M": 10, "L": 15} as stored on a purchase order line. */
export type SizeQty = Record<string, number>;

/** Clean whatever came out of the database or a form into a usable map.
 *
 * Drops anything that is not a positive whole number of units. A line
 * claiming -3 Medium or 2.5 Large is not a quantity somebody meant, and
 * carrying it forward would put it into the ledger. */
export function normalizeSizeQty(value: unknown): SizeQty {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SizeQty = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const size = String(k).trim();
    const n = Math.floor(Number(v));
    if (!size || !Number.isFinite(n) || n <= 0) continue;
    out[size] = n;
  }
  return out;
}

/** The line's total, added up from its sizes.
 *
 * THE LINE'S qty IS WRITTEN FROM THIS, never typed beside it. Two fields
 * that have to agree are two fields that will not, and this one decides the
 * money as well as the stock. */
export function sizeQtyTotal(m: SizeQty): number {
  return Object.values(m).reduce((n, v) => n + (Number(v) || 0), 0);
}

/** Split a line's arrival into one ledger movement per size.
 *
 * A line with no breakdown yields a single unsized movement, which is what
 * every purchase before this feature did and what a fridge still does.
 */
export function receiptMovements(
  sizeQty: SizeQty, fallbackQty: number
): Array<{ size: string; qty: number }> {
  const entries = Object.entries(sizeQty).filter(([, v]) => v > 0);
  if (!entries.length) {
    const q = Math.floor(Number(fallbackQty) || 0);
    return q > 0 ? [{ size: NO_SIZE, qty: q }] : [];
  }
  return entries.map(([size, qty]) => ({ size, qty }));
}

/* THERE IS NO SIZE PARSER HERE, DELIBERATELY.
 *
 * One lived here briefly and split on "|" where lib/procurement.ts's
 * parseSizes() -- the function that actually writes products.sizes at
 * receipt -- splits on commas, slashes and newlines only. The purchase
 * order form would have offered a quantity box for "38" and "39" while
 * receiving created one product size called "38|39", so the counts typed
 * into those boxes would have landed under sizes the product never had.
 *
 * parseSizes() is not server-only, so everything uses it directly. Two
 * parsers for one field is one parser too many.
 */

/* ---------------------------------------------------------------------------
 * When one size is running out
 * ------------------------------------------------------------------------ */

export interface LowSize {
  productId: string;
  productName: string;
  size: string;
  qty: number;
}

/** Sizes at or below `threshold` on products that HAVE a size breakdown.
 *
 * The alert the total could never give: thirty shirts is a healthy number
 * and is no comfort at all to the shopper who wants Medium, of which there
 * are two.
 *
 * Untracked products are skipped entirely rather than reported at zero.
 * Every size of every product would otherwise show as out of stock on the
 * day this ships, which is a hundred alerts that mean nothing and the end
 * of anybody reading them.
 *
 * A size at zero on a product that HAS been counted is real and is
 * included -- that is precisely the case worth knowing about.
 */
export function lowSizes(
  products: ReadonlyArray<{
    id: string; name: string; stock: SizedStock;
  }>,
  threshold = 2
): LowSize[] {
  const out: LowSize[] = [];
  for (const p of products) {
    if (!p.stock.tracked) continue;
    for (const s of p.stock.sizes) {
      if (s.qty <= threshold) {
        out.push({ productId: p.id, productName: p.name, size: s.size, qty: s.qty });
      }
    }
  }
  // Emptiest first: the shelf that is already bare needs ordering before the
  // one with two left.
  return out.sort((a, b) => a.qty - b.qty || a.productName.localeCompare(b.productName));
}
