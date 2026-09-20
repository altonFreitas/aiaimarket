import { normalizeSizeQty, receiptMovements, NO_SIZE, type SizeQty } from "@/lib/sizeStock";

/* WHAT A PURCHASE ORDER LINE PUTS INTO THE LEDGER.
 *
 * A line can be bought three ways, and receiving has to produce the right
 * movements for each without the caller having to know which it is
 * looking at:
 *
 *   1. by VARIANT  -- {"<uuid>": 20, "<uuid>": 30}, the new one;
 *   2. by SIZE     -- {"S": 5, "M": 10}, which is how it works today;
 *   3. by NEITHER  -- a fridge: one movement for the line's whole qty.
 *
 * ONE OR THE OTHER, NEVER BOTH. A line that names variants ignores its
 * size map entirely, and that is deliberate rather than a simplification:
 * a variant already carries its size (that is what "Black / M" means), so
 * honouring both would count the same shirts twice -- once under M and
 * once under Black/M -- and the shop would receive fifty and believe it
 * had a hundred.
 *
 * WHY THE SIZE IS STILL WRITTEN ON A VARIANT MOVEMENT. Every movement
 * carries both columns, because `size` has not retired: the per-size views
 * and the reorder report still read it, and a variant receipt that left it
 * empty would quietly move that stock into the "no size recorded" pool.
 * The variant's own size is passed in by the caller, which is the only
 * thing that knows how to read it out of the variant's attributes.
 */

export interface ReceiptMovement {
  size: string;
  variantId: string | null;
  qty: number;
}

/** A variant map as stored: variant id -> how many. */
export type VariantQty = Record<string, number>;

/** Whatever the column holds, as a clean map of positive whole numbers.
 *
 * Mirrors normalizeSizeQty. jsonb from the database arrives as `unknown`,
 * and a half-typed form can put a string, a negative or a fraction in it;
 * none of those may reach the ledger, where they would become stock. */
export function normalizeVariantQty(value: unknown): VariantQty {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: VariantQty = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = Math.floor(Number(raw));
    if (!id.trim() || !Number.isFinite(n) || n <= 0) continue;
    out[id] = n;
  }
  return out;
}

/** The total a variant map buys -- what `qty` on the line must equal. */
export function variantQtyTotal(m: VariantQty): number {
  return Object.values(m).reduce((n, v) => n + v, 0);
}

/** The ledger rows one purchase-order line produces.
 *
 * @param sizeQty     the line's size map
 * @param variantQty  the line's variant map, which wins when it has anything
 * @param fallbackQty the line's total, used when neither map says anything
 * @param sizeOf      the size a given variant is, for the column that has
 *                    not retired. Returns '' when the variant has no size.
 */
export function receiptMovementsFor(
  sizeQty: SizeQty,
  variantQty: VariantQty,
  fallbackQty: number,
  sizeOf: (variantId: string) => string = () => NO_SIZE,
): ReceiptMovement[] {
  const byVariant = Object.entries(variantQty).filter(([, v]) => v > 0);

  if (byVariant.length) {
    return byVariant.map(([variantId, qty]) => ({
      variantId,
      size: sizeOf(variantId) || NO_SIZE,
      qty,
    }));
  }

  // No variants: exactly what receiving did before this file existed.
  return receiptMovements(normalizeSizeQty(sizeQty), fallbackQty)
    .map((m) => ({ ...m, variantId: null }));
}
