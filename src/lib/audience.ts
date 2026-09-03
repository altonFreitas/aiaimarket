/* Who a product is for.
 *
 * Clothing, shoes and most of what this shop sells is bought by looking
 * for "jeans for men" rather than "jeans". Without this, the only way to
 * narrow that down was the category tree, which would have meant
 * duplicating every clothing category into a men's and a women's copy --
 * and then deciding which one a unisex t-shirt goes in.
 *
 * FOUR VALUES, NOT TWO. The shop asked for Man and Woman. Stored alongside
 * them are:
 *
 *   unisex  -- deliberately for both. It appears under Men AND under
 *              Women, because a shopper filtering to one of them is saying
 *              what they want to wear, not asking to be shown less.
 *   null    -- nobody has said. A saucepan is not unisex; it is simply not
 *              a question that applies. These are shown when no filter is
 *              set and hidden when one is, because a shopper who asked for
 *              women's clothing does not want a saucepan in the answer.
 *
 * The difference between the last two matters and is easy to lose: if
 * unset silently meant unisex, every product in the shop that predates
 * this feature would appear under both filters and the filter would do
 * nothing useful on the day it shipped. */

export type Audience = "men" | "women" | "unisex";

/** Order is display order: the two a shopper actually picks between, then
 * the one that means "both". */
export const AUDIENCES: readonly Audience[] = ["men", "women", "unisex"] as const;

/** i18n key for each, so the labels stay translated with everything else. */
export const AUDIENCE_KEY: Record<Audience, string> = {
  men: "audienceMen",
  women: "audienceWomen",
  unisex: "audienceUnisex",
};

/** What a product row's column means, tolerating anything it might hold.
 *
 * Returns null for unset, unrecognised, or a database that has not run
 * supabase/audience.sql yet -- all of which mean the same thing to every
 * caller: nobody has said who this is for. */
export function normalizeAudience(value: unknown): Audience | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (AUDIENCES as readonly string[]).includes(v) ? (v as Audience) : null;
}

/** What a ?for= in the address bar means.
 *
 * Only the two a shopper can pick. "unisex" is not offered as a filter --
 * nobody shops for "clothes that are for either" -- so a URL asking for it
 * is treated as no filter rather than as an empty shelf. */
export function parseAudienceFilter(raw: string | undefined | null): Audience | null {
  const v = normalizeAudience(raw);
  return v === "men" || v === "women" ? v : null;
}

/** Should a product appear when the shopper has asked for `filter`?
 *
 * No filter shows everything. A filter shows that audience plus unisex,
 * and hides both the other audience and the products nobody has labelled.
 */
export function matchesAudience(
  product: Audience | null, filter: Audience | null
): boolean {
  if (!filter) return true;
  if (product === "unisex") return true;
  return product === filter;
}
