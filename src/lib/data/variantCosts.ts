import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* WHAT EACH SKU COST AND WHAT IT SELLS FOR.
 *
 * The unit cost screen is one row per PRODUCT, and for a shirt bought in
 * three sizes at three prices that one row is an average of three facts it
 * does not show. The purchase order already recorded each of them: one row
 * per size, its own cost price and its own selling price, which receiving
 * wrote onto the variant (ensureVariant in lib/receiving.ts).
 *
 * So this reads them back, per product, for the breakdown under each row.
 * Colour and size come from the variant's own answers rather than from
 * parsing its label -- a label is for reading, and "Black / XL" and
 * "XL / Black" are the same SKU written two ways.
 *
 * ADMIN ONLY, and it carries cost_price, which is the shop's margin. There
 * is no anon path to this file and there must not be one.
 *
 * EMPTY, NEVER THROWING, on a database without the variant tables: the
 * cost screen then looks exactly as it did before, one row per product.
 */

export interface VariantCostRow {
  id: string;
  /** "Black / XL" as generated. Kept as the fallback label for a variant
   * whose axes this cannot name. */
  label: string;
  sku: string | null;
  /** attribute slug -> the answer. "size" and "color" are the two this
   * screen shows; anything else the product type varies by is carried so
   * the caller can decide. */
  axes: Record<string, string>;
  /** What it sells for. Null means "same as the product". */
  price: number | null;
  /** The landed cost the receipt recorded. Null when nothing has landed
   * yet, which is different from zero. */
  costPrice: number | null;
  status: string;
}

/** How many variant rows one page may read. The cost screen lists a whole
 * catalogue, and a shop with 200 products averaging 6 SKUs is 1,200 rows;
 * 5,000 is a generous ceiling that still cannot run away. */
const MAX_ROWS = 5000;

/** Every product's SKUs, keyed by product id.
 *
 * One read for the whole catalogue rather than one per product, for the
 * same reason allSizeStock() takes that shape: a query per product is how
 * a catalogue of two hundred becomes a page that times out. */
export async function allVariantCosts(): Promise<Map<string, VariantCostRow[]>> {
  const out = new Map<string, VariantCostRow[]>();
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("product_variants")
      .select("id,product_id,label,sku,price,cost_price,status,display_order,"
        + "variant_attribute_values(value, attributes(slug))")
      .order("display_order")
      .limit(MAX_ROWS);
    if (error || !data) return out;

    for (const row of data as unknown as Array<{
      id: string; product_id: string; label: string; sku: string | null;
      price: number | null; cost_price: number | null; status: string;
      variant_attribute_values: Array<{ value: string; attributes: { slug: string } | null }> | null;
    }>) {
      const axes: Record<string, string> = {};
      for (const v of row.variant_attribute_values ?? []) {
        const slug = v.attributes?.slug;
        if (slug) axes[slug] = String(v.value ?? "");
      }
      const list = out.get(row.product_id) ?? [];
      list.push({
        id: row.id,
        label: row.label,
        sku: row.sku,
        axes,
        price: row.price == null ? null : Number(row.price),
        costPrice: row.cost_price == null ? null : Number(row.cost_price),
        status: row.status,
      });
      out.set(row.product_id, list);
    }
  } catch { /* no variant tables yet */ }
  return out;
}
