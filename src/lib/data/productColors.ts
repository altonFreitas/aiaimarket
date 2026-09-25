import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { describeColor } from "@/lib/colorName";

/* WHICH COLOURS THIS PRODUCT IS SOLD IN.
 *
 * The same shape as sizePricesOf next door, and for the same reason:
 * `color` is a variant axis (is_variant = true in the attribute seed), so
 * a shirt stocked in brown and navy is two variants, and the buy panel
 * can offer a real choice between them.
 *
 * ONE COLOUR IS NOT A CHOICE, and this says so by returning it anyway.
 * A product with a single colour still has a colour worth naming -- the
 * reference draws "Color: Brown" above the swatches whether there are
 * five or one -- and the caller decides whether a row of one swatch is a
 * picker or a label. Telling those apart here would be deciding a layout
 * question in a data file.
 *
 * FALLS BACK TO THE PRODUCT'S OWN ANSWER. Most of this catalogue predates
 * variants: the colour is an attribute value on the product, not a
 * variant axis, which is what the specification table has always shown.
 * Read that when there are no colour variants, so a listing filled in the
 * ordinary way still names its colour instead of looking like a product
 * nobody described.
 *
 * Empty -- never a guess -- when neither exists, and the panel then draws
 * no colour row at all.
 */

export interface ProductColor {
  /** The value as stored, which is what an order would record. */
  value: string;
  /** What to print: the typed word, or the nearest name for a hex. */
  name: string;
  /** A CSS colour for the swatch, or null when the value names nothing
   * drawable -- then the chip carries the word alone rather than a black
   * square meaning "not understood". */
  swatch: string | null;
  /** Whether this came from a variant of its own (so it is a thing that
   * can be chosen) or from the product's single colour answer. */
  fromVariant: boolean;
}

/** Same bound as sizePricesOf: a shoe range is forty variants, a thousand
 *  is a runaway generate rather than a product. */
const MAX_VARIANTS = 500;

export async function productColors(productId: string): Promise<ProductColor[]> {
  if (!productId) return [];
  try {
    const sb = supabaseAdmin();

    /* variant -> its answers -> the attribute, filtered to the colour axis
       by SLUG. !inner so a variant with no colour answer is left out
       rather than arriving as a null to guard against. */
    const { data, error } = await sb
      .from("product_variants")
      .select("status, variant_attribute_values!inner(value, attributes!inner(slug))")
      .eq("product_id", productId)
      .eq("variant_attribute_values.attributes.slug", "color")
      .limit(MAX_VARIANTS);

    if (!error && data) {
      const seen = new Map<string, ProductColor>();
      for (const row of data as Array<{
        status: string | null;
        variant_attribute_values: Array<{ value: string }>;
      }>) {
        // A hidden variant is not for sale, and offering its colour would
        // be offering something nobody can buy.
        if (row.status === "hidden") continue;
        for (const v of row.variant_attribute_values ?? []) {
          const value = String(v.value ?? "").trim();
          if (!value) continue;
          // Case-folded, because "Navy" and "navy" are one colour and two
          // swatches of it is a picker that looks broken.
          const key = value.toLowerCase();
          if (seen.has(key)) continue;
          seen.set(key, { ...named(value), fromVariant: true });
        }
      }
      if (seen.size) return [...seen.values()];
    }

    /* NO COLOUR VARIANTS. Fall back to the product's own answer -- the
       way every listing made before variants existed records its colour,
       and the way the specification table has always read it. */
    const { data: own } = await sb
      .from("product_attribute_values")
      .select("value, attributes!inner(slug)")
      .eq("product_id", productId)
      .eq("attributes.slug", "color")
      .limit(8);

    const out: ProductColor[] = [];
    const seen = new Set<string>();
    for (const r of (own ?? []) as Array<{ value: string }>) {
      const value = String(r.value ?? "").trim();
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      out.push({ ...named(value), fromVariant: false });
    }
    return out;
  } catch {
    // The migration window: no variant or attribute tables yet. A product
    // page without a colour row is the page as it has always been.
    return [];
  }
}

function named(value: string): Omit<ProductColor, "fromVariant"> {
  const c = describeColor(value);
  return { value, name: c?.name ?? value, swatch: c?.swatch ?? null };
}
