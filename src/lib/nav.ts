/* The shop's main navigation: what sits in the bar under the logo, and what
 * drops down when a shopper points at it.
 *
 * THREE LEVELS, AND WHERE EACH ONE COMES FROM.
 *
 *   root    Women / Men, and the categories that are nobody's clothing --
 *           the top-level entries in the bar itself.
 *   group   a top-level category inside that root ("Sapatu", "Kalsa Jeans").
 *   child   one of that category's subcategories.
 *
 * Women and Men are NOT categories and deliberately never became any. The
 * store's category tree is whatever the admin set up (see CategoriesAdmin);
 * duplicating every clothing category into a men's and a women's copy is
 * exactly the trap src/lib/audience.ts was written to avoid. So the two
 * audience entries are a VIEW of the same tree, filtered by
 * products.audience, and every link inside them carries ?for= so the page
 * the shopper lands on is filtered the same way the menu was.
 *
 * WHEN A ROOT APPEARS AT ALL. Only when there is stock behind it:
 *
 *   Women / Men  when at least one product is labelled for that audience
 *                (or unisex, which belongs to both).
 *   a category   when it holds at least one product nobody has labelled --
 *                a saucepan, a fridge, a jacket nobody said is a man's.
 *
 * That rule is what makes this work on day one and on day one thousand. A
 * shop that has labelled nothing gets a bar of its own categories, exactly
 * what it has today. A clothing shop that has labelled everything gets
 * Women and Men. A shop that sells both gets both, and neither entry is
 * ever a door onto an empty shelf.
 *
 * Everything here is derived, nothing is stored, and no counts are
 * invented: every number in the menu is a length of a real filtered list.
 */
import { matchesAudience, normalizeAudience, type Audience } from "./audience";
import { t } from "./i18n";
import type { Category, Lang, Product } from "./types";

/** Products previewed inside one open panel. Four is what fits the panel's
 * third column at every desktop width without wrapping to a second row. */
const FEATURE_COUNT = 4;

/** How many plain category entries may sit in the bar beside Women/Men.
 * A navigation bar that scrolls sideways is not a navigation bar; the rest
 * of the tree stays one click away behind "Shop all". */
const MAX_CATEGORY_ROOTS = 6;

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

/** A category and its subcategories, the same "browsing Electronics must
 * not look empty because everything is filed under Phones" rule the
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

/** ?for=women appended to a path that may already carry a query string.
 * None of the shop's category or catalog paths do today, but building the
 * link by hand is how a "/shop?for=men?for=men" gets shipped one day. */
function withAudience(path: string, audience: Audience | null): string {
  if (!audience) return path;
  return `${path}${path.includes("?") ? "&" : "?"}for=${audience}`;
}

/** One top-level entry and the whole tree hanging off it, filtered to
 * `audience` when there is one. */
function buildRoot(
  id: string,
  label: string,
  href: string,
  cats: Category[],
  pool: Product[],
  audience: Audience | null
): NavRoot {
  const groups: NavGroup[] = [];
  for (const cat of topLevel(cats)) {
    const items = inCategory(pool, cats, cat.id);
    if (!items.length) continue;
    const children: NavLink[] = [];
    for (const kid of childrenOf(cats, cat.id)) {
      const n = pool.filter((p) => p.category_id === kid.id).length;
      if (n) children.push({ label: kid.name, href: withAudience(`/c/${kid.slug}`, audience), count: n });
    }
    groups.push({
      id: cat.id,
      label: cat.name,
      href: withAudience(`/c/${cat.slug}`, audience),
      count: items.length,
      children,
    });
  }
  return {
    id,
    label,
    href,
    count: pool.length,
    groups,
    feature: pool.slice(0, FEATURE_COUNT).map(compact),
  };
}

/** Women or Men: the whole category tree seen through one audience. Null
 * when the shop has nothing to put behind it -- an entry that opens onto
 * "No products found" is worse than no entry. */
function audienceRoot(
  audience: Audience, cats: Category[], products: Product[], lang: Lang
): NavRoot | null {
  const pool = products.filter((p) => matchesAudience(normalizeAudience(p.audience), audience));
  if (!pool.length) return null;
  const label = t(audience === "men" ? "audienceMen" : "audienceWomen", lang);
  return buildRoot(audience, label, withAudience("/shop", audience), cats, pool, audience);
}

/** The plain category entries -- the shop's Accessories, Electricals,
 * Homeware. Chosen by holding something nobody has labelled, but counted
 * and linked UNFILTERED: the entry is the category itself, not a slice of
 * it, so its numbers must be the category's own. */
function categoryRoots(cats: Category[], products: Product[]): NavRoot[] {
  const unlabelled = products.filter((p) => normalizeAudience(p.audience) === null);
  const out: NavRoot[] = [];
  for (const cat of topLevel(cats)) {
    if (out.length >= MAX_CATEGORY_ROOTS) break;
    if (!inCategory(unlabelled, cats, cat.id).length) continue;
    const pool = inCategory(products, cats, cat.id);
    out.push(buildRoot(cat.id, cat.name, `/c/${cat.slug}`, cats, pool, null));
  }
  return out;
}

/** The whole bar, left to right: Women, Men, then the categories that are
 * neither. "Shop all" is not in here -- it is a plain link with no panel,
 * and the header renders it directly. */
export function buildNav(cats: Category[], products: Product[], lang: Lang): NavRoot[] {
  const out: NavRoot[] = [];
  for (const a of ["women", "men"] as const) {
    const root = audienceRoot(a, cats, products, lang);
    if (root) out.push(root);
  }
  out.push(...categoryRoots(cats, products));
  return out;
}

/** The two audience entries on their own, for the homepage's "shop by"
 * tiles. Same rule as the bar: only what the shop actually stocks. */
export function audienceHighlights(
  cats: Category[], products: Product[], lang: Lang
): NavRoot[] {
  return (["women", "men"] as const)
    .map((a) => audienceRoot(a, cats, products, lang))
    .filter((r): r is NavRoot => r !== null);
}
