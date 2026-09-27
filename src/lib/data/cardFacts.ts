import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { describeColor } from "@/lib/colorName";
import { someSizeStock } from "./sizeStock";
import { cardSizes, MAX_COLORS } from "@/lib/cardFacts";
import type { CardColor } from "@/lib/cardFacts";
import type { CardFacts } from "@/lib/cardFacts";
import type { Product } from "@/lib/types";

/* WHAT A GRID CARD CAN SAY ABOUT A PRODUCT BEYOND ITS NAME AND PRICE.
 *
 * The reference catalogue puts a row of colours and a row of sizes under
 * every card, and both are real questions a shopper answers before they
 * open anything: "do they have it in black", "do they have my size".
 *
 * ONE READ FOR THE WHOLE PAGE, NOT ONE PER CARD. productColors() next door
 * answers for a single product because the product page asks about one.
 * Asking it twenty-four times for a grid is twenty-four round trips, on
 * the connections this shop was built for. Everything here takes the whole
 * page's ids and comes back with a map.
 *
 * ABSENT IS NOT EMPTY, and the card reads the difference. A product with
 * no size-stock rows at all is one the ledger has never been told about --
 * not one whose sizes are all sold out -- so its sizes come back with
 * `inStock: null` and the card prints them plainly rather than striking
 * them through. Every one of these reads degrades to nothing on a database
 * where the migration has not been run, and the card then looks exactly
 * as it did before any of this existed.
 */

export type { CardColor, CardSize, CardFacts } from "@/lib/cardFacts";

/** A shoe range is forty variants; a thousand is a runaway generate. */
const MAX_VARIANTS = 2000;

export async function cardFactsFor(
  products: readonly Product[]
): Promise<Map<string, CardFacts>> {
  const out = new Map<string, CardFacts>();
  if (!products.length) return out;
  const ids = products.map((p) => p.id);

  const [colors, stock] = await Promise.all([
    colorsFor(ids),
    someSizeStock(ids),
  ]);

  for (const p of products) {
    out.set(p.id, {
      colors: colors.get(p.id) ?? [],
      sizes: cardSizes(p.sizes, stock.get(p.id)),
    });
  }
  return out;
}

/** Every product's colours, variants first.
 *
 * The same rule productColors() applies one product at a time: a colour
 * that is a variant of its own is a thing that can be bought, and it wins
 * over the product's single colour answer. A product with neither gets no
 * row, which is what an undescribed listing should look like. */
async function colorsFor(
  ids: readonly string[]
): Promise<Map<string, CardColor[]>> {
  const out = new Map<string, CardColor[]>();
  try {
    const sb = supabaseAdmin();
    const [variants, own] = await Promise.all([
      sb.from("product_variants")
        .select("product_id, status, variant_attribute_values!inner(value, attributes!inner(slug))")
        .in("product_id", ids as string[])
        .eq("variant_attribute_values.attributes.slug", "color")
        .limit(MAX_VARIANTS),
      sb.from("product_attribute_values")
        .select("product_id, value, attributes!inner(slug)")
        .in("product_id", ids as string[])
        .eq("attributes.slug", "color")
        .limit(MAX_VARIANTS),
    ]);

    const seen = new Map<string, Set<string>>();
    const add = (id: string, raw: unknown) => {
      const value = String(raw ?? "").trim();
      if (!value) return;
      // Case-folded: "Navy" and "navy" are one colour, and two dots of it
      // is a row that looks broken.
      const key = value.toLowerCase();
      const keys = seen.get(id) ?? new Set<string>();
      if (keys.has(key)) return;
      keys.add(key); seen.set(id, keys);
      const list = out.get(id) ?? [];
      if (list.length >= MAX_COLORS) return;
      const c = describeColor(value);
      list.push({ value, name: c?.name ?? value, swatch: c?.swatch ?? null });
      out.set(id, list);
    };

    for (const row of (variants.data ?? []) as Array<{
      product_id: string; status: string | null;
      variant_attribute_values: Array<{ value: string }>;
    }>) {
      // A hidden variant is not for sale, and drawing its colour would
      // offer something nobody can buy.
      if (row.status === "hidden") continue;
      for (const v of row.variant_attribute_values ?? []) add(row.product_id, v.value);
    }

    for (const row of (own.data ?? []) as Array<{ product_id: string; value: string }>) {
      // Only where variants said nothing -- see above.
      if (out.has(row.product_id)) continue;
      add(row.product_id, row.value);
    }
  } catch {
    // The migration window: no variant or attribute tables. A card with no
    // colour row is the card as it has always been.
  }
  return out;
}
