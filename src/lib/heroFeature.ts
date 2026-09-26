import type { Category, HeroSlide, Product } from "./types";

/** What a hero slide's product card is drawn from. */
export interface HeroFeature {
  product: Product;
  /** The product's category, for the small label above its name. "" when
   * the product sits in no category, in which case the card omits the
   * line rather than printing an empty one. */
  categoryName: string;
}

/* THE SLIDE NAMES A PRODUCT; EVERYTHING ELSE IS READ FROM IT.
 *
 * Resolved against the catalogue the homepage has ALREADY loaded, so a
 * featured product costs no extra query -- and, more importantly, so the
 * card can only ever show a product the shop is actually selling.
 *
 * A slide pointing at something archived, unapproved or deleted resolves
 * to null and the slide renders as picture-and-copy, exactly as it did
 * before it had a product. That is the honest failure: a hero advertising
 * a product nobody can buy is worse than a hero with no card on it.
 *
 * (getLiveProducts is capped -- see MAX_CATALOG_PRODUCTS. A featured
 * product beyond that cap would also resolve to null, which is the same
 * safe outcome, and the cap is far above this shop's catalogue.)
 */
export function heroFeature(
  slide: Pick<HeroSlide, "product_id">,
  products: readonly Product[],
  cats: readonly Category[]
): HeroFeature | null {
  const id = (slide.product_id || "").trim();
  if (!id) return null;
  const product = products.find((p) => p.id === id);
  if (!product) return null;
  const cat = cats.find((c) => c.id === product.category_id);
  return { product, categoryName: cat?.name || "" };
}
