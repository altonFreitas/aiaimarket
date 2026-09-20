/* TURNING CHOSEN VALUES INTO COMBINATIONS.
 *
 * Colour [Black, White] and Size [S, M, L] become six variants: Black/S,
 * Black/M, Black/L, White/S, White/M, White/L. That is all this does, and
 * it is pure, because the interesting parts are the edges rather than the
 * multiplication.
 *
 * THE CAP IS THE POINT. Three axes with ten values each is a thousand
 * variants, and a shop that ticks a few boxes without thinking can ask for
 * that by accident -- then wait for a thousand rows to be written, and be
 * left with a picker nobody can use and a stock report nobody can read.
 * Refusing is kinder than obeying: the shop almost certainly meant
 * something smaller, and finding out afterwards is expensive.
 *
 * ORDER IS THE AXES' ORDER, and the last axis varies fastest -- the same
 * way a size chart reads. Black/S, Black/M, Black/L, then White. A stable,
 * predictable order matters because these labels end up on order lines and
 * in the ledger, and a shop reading a stock report should find them
 * grouped the way it thinks about them.
 */

export interface VariantAxis {
  attributeId: string;
  name: string;
  /** The values chosen for this axis. An axis with none is ignored. */
  values: string[];
}

export interface GeneratedVariant {
  /** "Black / M" -- what the shopper and the order line see. */
  label: string;
  /** What distinguishes it, one entry per axis. */
  values: { attributeId: string; value: string }[];
}

/** The most combinations one product may have. */
export const MAX_VARIANTS = 200;

export class TooManyVariants extends Error {
  constructor(public readonly wanted: number) {
    super(`That would make ${wanted} variants, and the limit is ${MAX_VARIANTS}. ` +
          `Use fewer values, or split this into more than one product.`);
    this.name = "TooManyVariants";
  }
}

/** How many combinations these axes would produce. */
export function matrixSize(axes: readonly VariantAxis[]): number {
  const used = usable(axes);
  if (!used.length) return 0;
  return used.reduce((n, a) => n * a.values.length, 1);
}

/** Every combination of the given axes.
 *
 * @throws TooManyVariants above MAX_VARIANTS.
 */
export function buildMatrix(axes: readonly VariantAxis[]): GeneratedVariant[] {
  const used = usable(axes);
  if (!used.length) return [];

  const size = matrixSize(used);
  if (size > MAX_VARIANTS) throw new TooManyVariants(size);

  let out: GeneratedVariant[] = [{ label: "", values: [] }];
  for (const axis of used) {
    const next: GeneratedVariant[] = [];
    for (const so_far of out) {
      for (const value of axis.values) {
        next.push({
          label: so_far.label ? `${so_far.label} / ${value}` : value,
          values: [...so_far.values, { attributeId: axis.attributeId, value }],
        });
      }
    }
    out = next;
  }
  return out;
}

/** Which of these combinations are new, given what the product already has.
 *
 * REGENERATING MUST NOT DESTROY. A shop that adds a fourth size to a shirt
 * already selling three wants one more variant, not twelve replacements --
 * the existing ones carry SKUs, prices, barcodes and, most of all, stock.
 * So the matrix is compared against what is there by label, and only the
 * genuinely new ones come back. */
export function newVariantsOnly(
  generated: readonly GeneratedVariant[], existingLabels: readonly string[]
): GeneratedVariant[] {
  const have = new Set(existingLabels);
  return generated.filter((v) => !have.has(v.label));
}

/** Labels the product has that the axes no longer produce.
 *
 * Reported rather than deleted, for the same reason: they may hold stock a
 * shop still has on a shelf. Removing "White / XL" from the axes should
 * tell somebody that six of them are still in the stockroom, not silently
 * erase the row that says so. */
export function orphanedLabels(
  generated: readonly GeneratedVariant[], existingLabels: readonly string[]
): string[] {
  const made = new Set(generated.map((v) => v.label));
  return existingLabels.filter((l) => !made.has(l));
}

/** Axes that actually contribute: one with no values chosen is not an axis,
 * and multiplying by it would produce nothing at all. */
function usable(axes: readonly VariantAxis[]): VariantAxis[] {
  return axes
    .filter((a) => a.attributeId && a.values.length > 0)
    .map((a) => ({
      ...a,
      // Duplicates would produce two variants with the same label, which
      // the unique index refuses -- better to collapse them here than to
      // fail the whole save over a double-click.
      values: [...new Set(a.values.map((v) => v.trim()).filter(Boolean))],
    }))
    .filter((a) => a.values.length > 0);
}
