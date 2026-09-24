/* The shop's aisles: the categories, and the products behind each one.
 *
 * TWO LEVELS, BOTH FROM THE CATEGORY TREE.
 *
 *   root    a top-level category ("Clothing", "Eletrodomestiku").
 *   child   one of its subcategories ("Men's clothing", "Sapatu").
 *
 * THERE WAS A THIRD THING HERE AND IT IS GONE. The bar used to open with
 * Women and Men -- not categories, but a VIEW of the whole tree filtered by
 * products.audience, so that every clothing category did not have to be
 * duplicated into a men's copy and a women's copy. That was the right
 * answer to the question "how do I sell men's jeans and women's jeans
 * without two Jeans categories", and the shop has since answered it a
 * different way: Clothing is the category, Men's clothing and Women's
 * clothing are subcategories of it, and a shop that also sells fridges is
 * not asked who a fridge is for. One tree, one place to file a product,
 * nothing derived from a second column that had to agree with it.
 *
 * WHEN A ROOT APPEARS AT ALL. Only when there is stock behind it, counting
 * its subcategories -- browsing Clothing must not look empty because
 * everything is filed under Men's clothing. A door onto an empty shelf is
 * worse than no door.
 *
 * Everything here is derived, nothing is stored, and no counts are
 * invented: every number is a length of a real list.
 */
import type { Category, Lang, Product } from "./types";

/** Where the shop's aisles are not what is being navigated.
 *
 *   /admin, /seller  someone managing stock is not shopping for it; a row
 *                    of Sapatu / Eletrodomestiku over the sales dashboard
 *                    is the shop's furniture in the back office.
 *   /checkout        someone filling in their address and choosing how to
 *                    pay is one distraction away from not finishing. Every
 *                    checkout worth the name strips its navigation for the
 *                    same reason; the logo still goes home and Cancel still
 *                    goes back to the cart.
 */
export const NAV_FREE_PATHS: readonly string[] = ["/admin", "/seller", "/checkout"];

/** Matches the path itself and anything under it, and nothing that merely
 * starts with the same letters -- "/sellers-report" is not "/seller". */
export function isNavFree(pathname: string): boolean {
  return NAV_FREE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Products previewed inside one open panel.
 *
 * Four are VISIBLE -- that is what the column fits at every desktop width
 * -- and eight are loaded, because the row scrolls sideways. A panel that
 * showed exactly what fit had nothing to scroll and no reason to hint that
 * there was more; eight makes the gesture worth making and still costs one
 * small image each. */
const FEATURE_COUNT = 8;

/** Just enough of a product to draw a small card in the menu. The whole nav
 * model is serialized into every page's payload, so this deliberately
 * carries six fields rather than a forty-column product row. */
export interface NavProduct {
  id: string;
  name: string;
  slug: string;
  /** First photo, or "" when the product has none -- the caller draws the
   * inline placeholder, so no data URL is shipped over the wire. */
  image: string;
  price: number;
  discount: number | null;
}

export interface NavLink {
  label: string;
  href: string;
  /** How many live products are behind this link. */
  count: number;
}

export interface NavGroup extends NavLink {
  id: string;
  children: NavLink[];
}

export interface NavRoot extends NavLink {
  id: string;
  groups: NavGroup[];
  /** A few real products from this root, for the panel's preview column. */
  feature: NavProduct[];
}

function byOrder(a: Category, b: Category): number {
  return a.sort_order - b.sort_order;
}

function topLevel(cats: Category[]): Category[] {
  return cats.filter((c) => !c.parent_id).sort(byOrder);
}

function childrenOf(cats: Category[], id: string): Category[] {
  return cats.filter((c) => c.parent_id === id).sort(byOrder);
}

/** A category and its subcategories, the same "browsing Clothing must not
 * look empty because everything is filed under Men's clothing" rule the
 * category page itself uses. */
function idsFor(cats: Category[], id: string): string[] {
  return [id, ...childrenOf(cats, id).map((c) => c.id)];
}

function inCategory(products: Product[], cats: Category[], id: string): Product[] {
  const ids = idsFor(cats, id);
  return products.filter((p) => ids.includes(p.category_id || ""));
}

function compact(p: Product): NavProduct {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    image: p.images?.[0] || "",
    price: Number(p.price),
    discount: p.discount_price == null ? null : Number(p.discount_price),
  };
}

/** One top-level category and the subcategories hanging off it. */
function buildRoot(cat: Category, cats: Category[], products: Product[]): NavRoot {
  const pool = inCategory(products, cats, cat.id);
  const groups: NavGroup[] = [];
  for (const kid of childrenOf(cats, cat.id)) {
    const items = inCategory(products, cats, kid.id);
    if (!items.length) continue;
    groups.push({
      id: kid.id,
      label: kid.name,
      href: `/c/${kid.slug}`,
      count: items.length,
      children: childrenOf(cats, kid.id)
        .map((g) => ({
          label: g.name,
          href: `/c/${g.slug}`,
          count: products.filter((p) => p.category_id === g.id).length,
        }))
        .filter((l) => l.count > 0),
    });
  }
  return {
    id: cat.id,
    label: cat.name,
    href: `/c/${cat.slug}`,
    count: pool.length,
    groups,
    feature: pool.slice(0, FEATURE_COUNT).map(compact),
  };
}

/** Every top-level category the shop has something in, in the order the
 * admin put them. `lang` is taken and unused: the labels are the shop's own
 * category names, which are not translated strings, and the parameter stays
 * so the callers -- and any future label that IS a phrase -- do not all
 * have to change back. */
export function buildNav(cats: Category[], products: Product[], _lang: Lang): NavRoot[] {
  return topLevel(cats)
    .map((c) => buildRoot(c, cats, products))
    .filter((r) => r.count > 0);
}

/** One entry per category, flattened for a <select>.
 *
 * WHY A FLAT LIST WITH A DEPTH RATHER THAN A TREE. This feeds the
 * catalogue toolbar's category filter, and a <select> has no nesting --
 * <optgroup> comes close but its labels are not selectable, and "Clothing"
 * has to be choosable in its own right. So the shape of the tree is
 * carried as a number the caller indents with, and the order is the tree's
 * own: each top-level category followed by its children.
 *
 * The count is the category WITH its subcategories, the same rule the
 * sidebar and the menu use -- picking Clothing must not report fewer
 * products than picking Men's clothing inside it.
 *
 * Empty categories are kept here, unlike in the menu: this is a filter, and
 * a filter that silently omits a category leaves the shop wondering where
 * it went. It shows "(0)" and returns nothing, which is an answer. */
export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
  /** 0 for a top-level category, 1 for a subcategory. */
  depth: number;
  count: number;
}

export function categoryOptions(cats: Category[], products: Product[]): CategoryOption[] {
  const out: CategoryOption[] = [];
  for (const top of topLevel(cats)) {
    out.push({
      id: top.id, slug: top.slug, name: top.name, depth: 0,
      count: inCategory(products, cats, top.id).length,
    });
    for (const kid of childrenOf(cats, top.id)) {
      out.push({
        id: kid.id, slug: kid.slug, name: kid.name, depth: 1,
        count: inCategory(products, cats, kid.id).length,
      });
    }
  }
  return out;
}

/** The ids a `?cat=` slug covers -- the category itself and its children.
 * Null for a slug the shop does not have, which the caller treats as no
 * filter rather than as an empty shelf: a stale bookmark should show the
 * catalogue, not nothing. */
export function categoryFilterIds(cats: Category[], slug: string | undefined): string[] | null {
  if (!slug) return null;
  const cat = cats.find((c) => c.slug === slug);
  return cat ? idsFor(cats, cat.id) : null;
}
