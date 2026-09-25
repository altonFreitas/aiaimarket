import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* WHAT EACH SIZE COSTS.
 *
 * A purchase order buys a shirt in three sizes on three rows, each with
 * its own selling price, and receiving turns each row into a variant
 * carrying that price (ensureVariant in lib/receiving.ts). The product
 * page was showing one price for all three.
 *
 * So this reads them back: size -> the price of the variant that is that
 * size. It is the same read the variant editor makes in the admin, from
 * the anon side and carrying only the price -- NOT cost_price, which is
 * the shop's margin and has no business on a page a shopper can open.
 *
 * ITS OWN FILE for the same reason lib/data/sizeStock.ts is: the ledger
 * test flags a `qty:` in a file that also queries products, and keeping
 * these reads out of data/public.ts keeps that scanner sharp.
 *
 * EMPTY, NEVER PARTIAL-LOOKING, on a database without variants. A page
 * that got no prices shows the product's own for every size, which is
 * exactly what it did before any of this -- and is right for the fridge
 * that is not sold by size at all.
 */

/** A size, and what it is sold for. */
export type SizePrices = ReadonlyMap<string, number>;

/** How many variants one product may have. A shirt in six sizes and four
 * colours is twenty-four, a shoe range is forty; a thousand is not a
 * product, it is a runaway generate. Bounded so one bad row cannot make
 * the product page read the whole table. */
const MAX_VARIANTS = 500;

export async function sizePricesOf(productId: string): Promise<SizePrices> {
  const out = new Map<string, number>();
  if (!productId) return out;
  try {
    const sb = supabaseAdmin();
    /* The join is variant -> its answers -> the attribute, filtered to the
       size axis by SLUG. `size` is the slug the ledger has used since
       supabase/size-stock.sql, and nothing else here knows what a size
       is. !inner, so a variant with no size answer is left out rather
       than arriving with a null to guard against. */
    const { data, error } = await sb
      .from("product_variants")
      .select("price, status, variant_attribute_values!inner(value, attributes!inner(slug))")
      .eq("product_id", productId)
      .eq("variant_attribute_values.attributes.slug", "size")
      .limit(MAX_VARIANTS);
    if (error || !data) return out;

    for (const row of data as Array<{
      price: number | null; status: string | null;
      variant_attribute_values: Array<{ value: string }>;
    }>) {
      // A hidden variant is not for sale, and quoting its price would be
      // quoting a price nobody can pay.
      if (row.status === "hidden") continue;
      const price = row.price == null ? null : Number(row.price);
      // Null price means "same as the product", which is what the page
      // already shows -- so there is nothing to record.
      if (price == null || !Number.isFinite(price)) continue;
      for (const v of row.variant_attribute_values ?? []) {
        const size = String(v.value ?? "").trim();
        if (!size) continue;
        /* THE LOWEST ONE WINS when a size has two variants -- the same
           size in two colours, at two prices. The page shows one number
           for the size, and quoting the higher would mean a shopper who
           picked Medium and saw $30 could find the Medium they wanted is
           $25. Wrong in the cheap direction is a discount; wrong in the
           dear direction is a bait. */
        const had = out.get(size);
        if (had == null || price < had) out.set(size, price);
      }
    }
  } catch { /* no variant tables yet -- one price for every size, as before */ }
  return out;
}
