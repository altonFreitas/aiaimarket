import "server-only";
import { supabaseAnon } from "@/lib/supabase/anon";
import { intersectIds, type AttributeFilters } from "@/lib/attributeFilterParams";

/* THE FILTERS A CATEGORY PAGE OFFERS, AND WHAT THEY MATCH.
 *
 * Section 19: nobody writes these per category. Shoes offer Brand, Size,
 * Colour and Waterproof; sofas offer Material, Number of Seats and Room
 * Type; both lists come out of the same two tables, so adding "Musical
 * Instruments -> Guitars" gets guitar filters without anybody touching
 * this file.
 *
 * ONLY VALUES THAT ARE ACTUALLY IN STOCK-ISH. The options offered are the
 * ones PRODUCTS IN THIS CATEGORY ACTUALLY HAVE, not every option the
 * attribute defines. A colour filter listing eighteen colours where the
 * shop sells three is a filter that mostly returns nothing, and a shopper
 * learns quickly to stop using it.
 *
 * RUNS AS ANON, deliberately. These are the storefront's own reads, and
 * going through the anon client means the row-level policies apply --
 * admin-only attributes are refused by the database as well as filtered
 * here, so a mistake in one is not an exposure.
 */

export interface FilterOption { value: string; count: number }

export interface CatalogFilter {
  slug: string;
  name: string;
  unit: string | null;
  fieldType: string;
  options: FilterOption[];
}

/** The filters worth offering for a set of products.
 *
 * @param productIds the catalogue being filtered, before any attribute
 *   filter is applied -- so the options do not vanish as they are used.
 */
export async function filtersFor(productIds: readonly string[]): Promise<CatalogFilter[]> {
  if (!productIds.length) return [];
  try {
    const sb = supabaseAnon();

    /* Everything those products answer, with the attribute beside it. The
       filterable flag is checked here rather than in a second query
       because it is a property of the attribute, which this join already
       has in hand. */
    const { data, error } = await sb
      .from("product_attribute_values")
      .select(`value, product_id,
               attributes!inner (slug, name, unit, field_type, filterable, admin_only)`)
      .in("product_id", productIds.slice(0, 1000));
    if (error || !data) return [];

    type Row = {
      value: string; product_id: string;
      attributes: {
        slug: string; name: string; unit: string | null;
        field_type: string; filterable: boolean; admin_only: boolean;
      };
    };

    const byAttr = new Map<string, CatalogFilter & { seen: Map<string, number> }>();
    for (const r of (data as unknown as Row[])) {
      const a = r.attributes;
      if (!a || !a.filterable || a.admin_only) continue;

      let g = byAttr.get(a.slug);
      if (!g) {
        g = {
          slug: a.slug, name: a.name, unit: a.unit,
          fieldType: a.field_type, options: [], seen: new Map(),
        };
        byAttr.set(a.slug, g);
      }
      g.seen.set(r.value, (g.seen.get(r.value) ?? 0) + 1);
    }

    return [...byAttr.values()]
      .map((g) => ({
        slug: g.slug, name: g.name, unit: g.unit, fieldType: g.fieldType,
        // Commonest first: the filter a shopper wants is usually the one
        // most of the shelf already is.
        options: [...g.seen.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((x, y) => y.count - x.count || x.value.localeCompare(y.value)),
      }))
      /* A filter with ONE option filters nothing -- every product in the
         category already has it -- and it takes up the room a useful one
         could have had. */
      .filter((g) => g.options.length > 1)
      .sort((x, y) => x.name.localeCompare(y.name));
  } catch {
    // The migration window: no attribute tables. A catalogue with no
    // attribute filters is the catalogue as it has always been.
    return [];
  }
}

/** The product ids matching every one of the chosen filters.
 *
 * Returns null when nothing is filtered, which the caller must pass
 * straight through as "no filter" -- an empty array would mean "nothing
 * matched" and empty the catalogue for everybody who arrived without
 * filters. */
export async function idsMatching(filters: AttributeFilters): Promise<string[] | null> {
  const entries = Object.entries(filters).filter(([, v]) => v.length);
  if (!entries.length) return null;

  try {
    const sb = supabaseAnon();

    /* One query per ATTRIBUTE, not per value: the values within one
       attribute are an OR, which the function does with = any(). The
       groups are then intersected, which is the AND between attributes.
       Two or three round trips, because a shopper picks two or three
       filters -- not one per value, which is what a naive version does. */
    const groups = await Promise.all(entries.map(async ([slug, values]) => {
      const { data, error } = await sb
        .rpc("products_with_attribute", {
          p_attribute_slug: slug, p_values: values,
        });
      if (error) throw error;
      return ((data ?? []) as string[] | { products_with_attribute: string }[])
        .map((r) => (typeof r === "string" ? r : r.products_with_attribute));
    }));

    return intersectIds(groups);
  } catch {
    /* The function is not there yet. Returning null rather than an empty
       array means the filter is IGNORED rather than the catalogue being
       emptied -- a shop mid-migration shows too many products for a
       moment, which is recoverable, instead of none, which looks broken. */
    return null;
  }
}
