/* THE ATTRIBUTE FILTERS, AS THEY TRAVEL IN THE ADDRESS BAR.
 *
 * ?a_color=Black,White&a_material=Leather
 *
 * Pure, so the parsing and the intersection can be tested without a
 * database -- which matters because the rules are not obvious:
 *
 *   * values WITHIN one attribute are OR -- black or white shirts;
 *   * DIFFERENT attributes are AND -- black leather, not black-or-leather.
 *
 * Getting that backwards gives a filter that widens as you narrow it, and
 * it is the kind of mistake that looks like it works on a small catalogue.
 */

/** The prefix that marks a search parameter as an attribute filter.
 * Namespaced so a future attribute called "sort" or "page" cannot collide
 * with the parameters the catalogue already owns. */
export const ATTR_PREFIX = "a_";

/** attribute slug -> the values chosen for it. */
export type AttributeFilters = Record<string, string[]>;

/** Reads the filters out of whatever the page was given. */
export function parseAttributeFilters(
  params: Record<string, string | string[] | undefined>
): AttributeFilters {
  const out: AttributeFilters = {};
  for (const [key, raw] of Object.entries(params)) {
    if (!key.startsWith(ATTR_PREFIX) || raw == null) continue;
    const slug = key.slice(ATTR_PREFIX.length);
    if (!slug) continue;

    // Repeated parameters and comma-separated ones mean the same thing, so
    // both work: ?a_color=Black&a_color=White and ?a_color=Black,White.
    const values = (Array.isArray(raw) ? raw : [raw])
      .flatMap((v) => String(v).split(","))
      .map((v) => v.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    const unique = values.filter((v) => !seen.has(v) && seen.add(v));
    if (unique.length) out[slug] = unique;
  }
  return out;
}

/** The filters back into query parameters, for building links. */
export function attributeFilterParams(f: AttributeFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug, values] of Object.entries(f)) {
    if (values.length) out[ATTR_PREFIX + slug] = values.join(",");
  }
  return out;
}

/** The filters with one value toggled on or off -- what a checkbox does. */
export function toggleFilter(
  f: AttributeFilters, slug: string, value: string
): AttributeFilters {
  const have = f[slug] ?? [];
  const next = have.includes(value)
    ? have.filter((v) => v !== value)
    : [...have, value];

  const out = { ...f };
  // An attribute with nothing chosen is not a filter, and leaving the key
  // behind would put ?a_color= in the address for no reason.
  if (next.length) out[slug] = next;
  else delete out[slug];
  return out;
}

/** Whether any filter is set at all. */
export function hasFilters(f: AttributeFilters): boolean {
  return Object.values(f).some((v) => v.length > 0);
}

/* ---------------------------------------------------------------------------
 * Intersecting
 * ------------------------------------------------------------------------ */

/** The products matching EVERY attribute group.
 *
 * Each entry is the set that matched one attribute (its values already
 * OR-ed by the query that produced it). This ANDs the groups together.
 *
 * NO GROUPS MEANS NO FILTER, which is not the same as no products: it
 * returns null, and the caller sends nothing to the search rather than
 * sending an empty list and getting an empty catalogue. An EMPTY group,
 * though, is a filter that matched nothing, and correctly yields nothing.
 */
export function intersectIds(groups: readonly (readonly string[])[]): string[] | null {
  if (!groups.length) return null;

  // Smallest first: the intersection cannot be bigger than the smallest
  // group, and starting there does the least work.
  const sorted = [...groups].sort((a, b) => a.length - b.length);
  let acc = new Set(sorted[0]);

  for (const g of sorted.slice(1)) {
    if (!acc.size) break;
    const next = new Set<string>();
    for (const id of g) if (acc.has(id)) next.add(id);
    acc = next;
  }
  return [...acc];
}
