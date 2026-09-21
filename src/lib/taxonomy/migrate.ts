/* MOVING PRODUCTS THAT ALREADY EXIST ONTO THE TAXONOMY.
 *
 * Section 23. Every product created before the taxonomy existed has a
 * category_id, a sizes array and nothing else -- no product type, so no
 * attributes, so no specification table and no filters. They keep selling
 * exactly as they always did; this is how they catch up.
 *
 * THE HONEST FINDING FIRST. A real shop's categories are in the language
 * it trades in: this one's are "Sapatu", "Roupa", "Telemóvel & asesóriu".
 * The taxonomy seeded from the specification is in English -- "Shoes",
 * "Men's Clothing", "Electronics". Matching one to the other by NAME will
 * therefore find almost nothing here, and pretending otherwise would be
 * building an automatic migration that quietly does nothing and leaves
 * somebody believing the job is done.
 *
 * So the automatic pass is deliberately small and certain: an exact name
 * match, after normalising case, accents and a trailing plural. Anything
 * else is left for a person, and the admin screen is built as the main
 * road rather than the exception.
 *
 * NEVER GUESS. A near-miss is not a match. Filing a product under the
 * wrong product type gives it the wrong questions, the wrong filters and
 * the wrong specification table, and the shop finds out when a customer
 * asks why a shoe has a Seat Height. A product with no type is visibly
 * unfinished; a product with the wrong one looks finished and is not.
 */

/** Case, accents and a trailing "s" removed -- the only three differences
 * worth ignoring. "Sofas" and "sofa" are the same product type; "Sofa
 * beds" is not. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/s$/, "");
}

export interface TypeCandidate {
  id: string;
  name: string;
  /** "Home, Furniture & Living / Furniture" -- shown so a person choosing
   * between two same-named types can tell them apart. */
  path: string;
}

export interface MatchResult {
  /** The single product type this certainly is, or null. */
  typeId: string | null;
  /** Why not, when there is no match -- for a screen that has to explain
   * itself rather than just showing an empty box. */
  reason: "matched" | "none" | "ambiguous";
  /** The candidates, when more than one matched. A person picks. */
  candidates: TypeCandidate[];
}

/** The product type a category name certainly means.
 *
 * @param categoryName the shop's own name for it, in its own language
 * @param types every product type in the taxonomy
 */
export function matchProductType(
  categoryName: string, types: readonly TypeCandidate[]
): MatchResult {
  const needle = normalizeName(categoryName);
  if (!needle) return { typeId: null, reason: "none", candidates: [] };

  const hits = types.filter((t) => normalizeName(t.name) === needle);

  if (hits.length === 1) {
    return { typeId: hits[0].id, reason: "matched", candidates: hits };
  }
  if (hits.length > 1) {
    /* "Chairs" exists under Furniture and under Office. Both are real and
       the shop means one of them; which one is not something a name
       comparison can know. */
    return { typeId: null, reason: "ambiguous", candidates: hits };
  }
  return { typeId: null, reason: "none", candidates: [] };
}

/* ---------------------------------------------------------------------------
 * What the migration screen works in
 * ------------------------------------------------------------------------ */

export interface CategoryGroup {
  categoryId: string;
  categoryName: string;
  /** How many products are still without a product type here. */
  pending: number;
  /** What the automatic pass thinks, if anything. */
  suggestion: MatchResult;
}

/** BY CATEGORY, NOT BY PRODUCT, and that is the whole design of the
 * screen. A shop with two hundred products in "Sapatu" does not want two
 * hundred pickers; it wants to say once that Sapatu means Shoes, and have
 * two hundred products move. Grouping first is what turns an afternoon
 * into a minute. */
export function groupForMigration(
  products: readonly { id: string; category_id: string | null; product_type_id?: string | null }[],
  categories: readonly { id: string; name: string }[],
  types: readonly TypeCandidate[],
): CategoryGroup[] {
  const pending = new Map<string, number>();
  for (const p of products) {
    if (p.product_type_id) continue;       // already done
    const key = p.category_id ?? "";
    pending.set(key, (pending.get(key) ?? 0) + 1);
  }

  const byId = new Map(categories.map((c) => [c.id, c]));
  return [...pending.entries()]
    .map(([categoryId, count]) => {
      const cat = byId.get(categoryId);
      return {
        categoryId,
        // A product filed under no category at all is a real state and
        // has to be offered too, or it can never be migrated.
        categoryName: cat?.name ?? "(no category)",
        pending: count,
        suggestion: cat
          ? matchProductType(cat.name, types)
          : { typeId: null, reason: "none" as const, candidates: [] },
      };
    })
    // Biggest first: the one worth doing next is the one covering most
    // products.
    .sort((a, b) => b.pending - a.pending);
}
