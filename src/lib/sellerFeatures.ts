/* What each seller has been given access to.
 *
 * The owner runs a marketplace and has, for their own business, a set of
 * tools they built for themselves. A seller renting a shop inside that
 * marketplace starts with the screens that make them a seller at all, and
 * can be given more -- because they asked, because they pay for it, or
 * because the owner decided their store is big enough to need it.
 *
 * TWO LEVELS, THE SAME TWO THE STAFF SIDE HAS.
 *
 * This used to be eight flat features and one row of checkboxes. It is now
 * AREAS holding TABS, exactly like lib/adminSections.ts, because the owner
 * grants staff access that way and running one shop should not mean
 * learning two different ideas of what "access" is.
 *
 * The two grants are deliberately different and must stay so:
 *
 *   "selling"        the whole area, INCLUDING tabs added in a later
 *                    version of the app. A store trusted with Sales was
 *                    trusted with Sales, not with a list.
 *   "selling.today"  exactly that tab, and nothing that appears beside it
 *                    afterwards.
 *
 * Getting that the other way round is how a permission quietly widens
 * between releases, which is the failure nobody is watching for.
 *
 * INCLUDED vs SELLABLE.
 *
 * Some tabs are not a feature and never appear as a checkbox: the
 * dashboard, products, orders and store settings. A seller who cannot list
 * a product or see an order is not a seller with fewer features, it is a
 * broken account -- so they are held by everyone, the way `home` is for
 * staff. Everything else is a choice the owner makes per store.
 *
 * One map drives the seller's navigation, the checklist on the Sellers
 * screen, and the lock on each page. Three copies of "which pages are
 * Sales" would be three chances to disagree.
 *
 * No server-only import: the nav is a client component and the page guard
 * is a server one, and both need this. Nothing here reads a session or a
 * database -- it is a map and some predicates. */

export type SellerAreaKey =
  | "home" | "selling" | "catalog" | "purchasing" | "settings";

export interface SellerSubsection {
  /** Namespaced on its area: "selling.today". The prefix is not decoration
   * -- sellerAreaOf() reads the area straight off it. */
  key: string;
  /** i18n key for the name in the nav and the checklist. */
  labelKey: string;
  /** i18n key for the one line under the checkbox saying what the store
   * actually gets. The owner is selling this; they should not have to open
   * the app as the seller to remember what it is. */
  blurbKey: string;
  /** Every seller route that belongs to this tab, including detail routes
   * that never appear in the navigation. Matched on segment boundaries,
   * longest first -- see sellerSubsectionForPath. */
  paths: string[];
  /** True for the ones that are simply part of being a seller. Never a
   * checkbox, held by every approved store. */
  included?: boolean;
}

export interface SellerArea {
  key: SellerAreaKey;
  labelKey: string;
  subsections: readonly SellerSubsection[];
}

/** Areas every approved store holds outright. Not a checkbox: a store that
 * could not reach its own dashboard would not be a cheaper store, it would
 * be a broken one. */
export const ALWAYS_GRANTED: readonly SellerAreaKey[] = ["home", "settings"];

/* Order matters only for display: this is the order the nav and the
 * checklist present them in. */
export const SELLER_AREAS: readonly SellerArea[] = [
  {
    key: "home", labelKey: "sellerDashboard",
    subsections: [
      {
        key: "home.dashboard", labelKey: "sellerDashboard",
        blurbKey: "featSellerDashboardBlurb",
        // /seller/no-access is the screen shown to somebody refused
        // elsewhere, so it lives in the one area every seller holds.
        paths: ["/seller/dashboard", "/seller/no-access"], included: true,
      },
    ],
  },
  {
    key: "selling", labelKey: "navSales",
    subsections: [
      {
        key: "selling.orders", labelKey: "sellerOrders",
        blurbKey: "featSellerOrdersBlurb",
        paths: ["/seller/orders"], included: true,
      },
      {
        key: "selling.today", labelKey: "sellerToday",
        blurbKey: "featSellerTodayBlurb",
        paths: ["/seller/today"],
      },
      {
        key: "selling.report", labelKey: "sellerSales",
        blurbKey: "featSellerSalesBlurb",
        paths: ["/seller/sales"],
      },
    ],
  },
  {
    key: "catalog", labelKey: "catalog",
    subsections: [
      {
        key: "catalog.products", labelKey: "sellerProducts",
        blurbKey: "featSellerProductsBlurb",
        paths: ["/seller/products"], included: true,
      },
      {
        key: "catalog.stock", labelKey: "sellerStock",
        blurbKey: "featSellerStockBlurb",
        paths: ["/seller/stock"],
      },
    ],
  },
  {
    key: "purchasing", labelKey: "procurement",
    subsections: [
      {
        key: "purchasing.purchases", labelKey: "sellerProcurement",
        blurbKey: "featSellerProcurementBlurb",
        paths: ["/seller/procurement"],
      },
    ],
  },
  {
    key: "settings", labelKey: "settings",
    subsections: [
      {
        key: "settings.store", labelKey: "sellerSettings",
        blurbKey: "featSellerSettingsBlurb",
        paths: ["/seller/settings"], included: true,
      },
    ],
  },
] as const;

export const ALL_SELLER_AREAS: readonly SellerAreaKey[] =
  SELLER_AREAS.map((a) => a.key);

export const ALL_SELLER_SUBSECTIONS: readonly SellerSubsection[] =
  SELLER_AREAS.flatMap((a) => a.subsections);

/** Part of being a seller. Held by every approved store, never a checkbox. */
export const INCLUDED_SUBSECTIONS: readonly string[] =
  ALL_SELLER_SUBSECTIONS.filter((s) => s.included).map((s) => s.key);

/** The area a tab key belongs to, read off the key itself. */
export function sellerAreaOf(key: string): SellerAreaKey | null {
  const head = key.split(".")[0];
  return (ALL_SELLER_AREAS as readonly string[]).includes(head)
    ? (head as SellerAreaKey) : null;
}

/** Is this tab something the owner can actually sell?
 *
 * No for an included tab -- it comes with the shop. No for a tab of an
 * always-granted area either, for the same reason: a key for it stored on
 * a row would be a permission nothing reads, making the screen and the
 * database disagree about what was granted. */
export function grantableSubsection(sub: SellerSubsection): boolean {
  if (sub.included) return false;
  const area = sellerAreaOf(sub.key);
  return !(area && ALWAYS_GRANTED.includes(area));
}

/** Is this AREA something the owner can offer as a whole?
 *
 * Only when it has something to sell. "Settings" holds one tab and that
 * tab comes free, so offering it as a checkbox would be offering nothing
 * -- a box that changes no permission is a box that teaches the owner the
 * checklist is decorative. */
export function grantableArea(area: SellerArea): boolean {
  if (ALWAYS_GRANTED.includes(area.key)) return false;
  return area.subsections.some(grantableSubsection);
}

export const GRANTABLE_AREAS: readonly SellerAreaKey[] =
  SELLER_AREAS.filter(grantableArea).map((a) => a.key);

/** Every key the owner may store on a seller: the areas, then the tabs. */
export const ALL_GRANT_KEYS: readonly string[] = [
  ...GRANTABLE_AREAS,
  ...ALL_SELLER_SUBSECTIONS.filter(grantableSubsection).map((s) => s.key),
];

/* ---------------------------------------------------------------------------
 * The keys that were stored before any of this existed
 * ------------------------------------------------------------------------ */

/** What the four flat feature keys meant, spelled as tabs.
 *
 * AND WHY THE SALES AREA IS KEYED "selling". The old flat key was "sales",
 * naming the My sales PAGE. If the new AREA were also keyed "sales" the two
 * would be the same string with two meanings, and no amount of context
 * tells them apart: a row reading ["sales"] is either a store that bought
 * one report before this change or a store granted the whole area after it.
 * Translating it would rob the second; not translating it would hand the
 * first the whole of Sales and every tab added to it later.
 *
 * So the area is keyed "selling" and nothing the old world could store is
 * a valid new key. The label is still "Sales" -- this is a name in a
 * database, not a word on a screen.
 *
 * EACH ONE MAPS TO A TAB, NEVER TO AN AREA, and that is the whole care in
 * this table. "sales" used to name the My sales PAGE -- it did not mean the
 * Sales area, which did not exist. Reading it as the area would hand every
 * store that had bought one report the whole of Sales, plus every tab added
 * to Sales afterwards, and nothing on any screen would say it had happened.
 * A migration that widens a permission is worse than one that fails. */
const LEGACY_KEYS: Readonly<Record<string, string>> = {
  today: "selling.today",
  sales: "selling.report",
  stock: "catalog.stock",
  procurement: "purchasing.purchases",
};

/* ---------------------------------------------------------------------------
 * Asking the questions
 * ------------------------------------------------------------------------ */

/** Does `path` sit inside `base`?
 *
 * Segment-aware on purpose. A plain startsWith would put /seller/salesman
 * inside /seller/sales, and there is no reason to leave that trap lying
 * around for whoever adds the next route. */
function within(path: string, base: string): boolean {
  return path === base || path.startsWith(base + "/");
}

/** Which tab a seller path belongs to, or null if it is not one.
 *
 * Longest match wins, so a future /seller/products/insights resolves to
 * whichever tab claims the longer prefix rather than to whichever happens
 * to be listed first. */
export function sellerSubsectionForPath(path: string): SellerSubsection | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: { sub: SellerSubsection; length: number } | null = null;
  for (const sub of ALL_SELLER_SUBSECTIONS) {
    for (const base of sub.paths) {
      if (within(clean, base) && (!best || base.length > best.length)) {
        best = { sub, length: base.length };
      }
    }
  }
  return best?.sub ?? null;
}

/** May this store open that tab?
 *
 * The included ones are held by everyone. Otherwise the store must hold
 * either the tab itself or the whole area it sits in -- and holding the
 * AREA is what carries tabs added later. */
export function sellerCanOpen(
  features: readonly string[], key: string
): boolean {
  if (INCLUDED_SUBSECTIONS.includes(key)) return true;
  const area = sellerAreaOf(key);
  if (area && ALWAYS_GRANTED.includes(area)) return true;
  if (features.includes(key)) return true;
  return !!area && features.includes(area);
}

/** May this store open that URL? False for anything that is not a seller
 * page at all -- not this module's business to permit. */
export function sellerCanOpenPath(
  features: readonly string[], path: string
): boolean {
  const sub = sellerSubsectionForPath(path);
  return sub ? sellerCanOpen(features, sub.key) : false;
}

/** The tabs of one area this store may actually open, in display order.
 * Empty is a real answer and the nav must handle it. */
export function visibleSellerSubsections(
  features: readonly string[], area: SellerAreaKey
): SellerSubsection[] {
  const found = SELLER_AREAS.find((a) => a.key === area);
  if (!found) return [];
  return found.subsections.filter((s) => sellerCanOpen(features, s.key));
}

/** The areas this store has at least one tab in. What the nav's top row
 * is built from. */
export function visibleSellerAreas(
  features: readonly string[]
): SellerArea[] {
  return SELLER_AREAS.filter(
    (a) => visibleSellerSubsections(features, a.key).length > 0);
}

/** Normalises whatever came out of the database into keys we recognise.
 *
 * Fails closed. A column that is not there yet -- on a shop with this code
 * and not yet supabase/seller-features.sql -- arrives as undefined and
 * reads as "nothing extra granted", which is exactly right: every sellable
 * tab is a screen that store never had.
 *
 * Old keys are translated rather than dropped, so a store that bought
 * stock alerts before this change still has them afterwards. Anything else
 * unrecognised IS dropped: a key left over from a feature the app has since
 * removed would otherwise sit on the row looking like a granted
 * permission. */
export function normalizeFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(ALL_GRANT_KEYS);
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const key = LEGACY_KEYS[v] ?? v;
    if (known.has(key) && !out.includes(key)) out.push(key);
  }
  /* A TAB KEY IS REDUNDANT BESIDE ITS OWN AREA, and keeping both would make
     the two grants indistinguishable the moment a new tab appeared:
     ["sales","sales.today"] would have to mean either "everything in Sales"
     or "just Today", and nothing on the row says which. The area wins,
     because it is the wider of the two and the one the owner ticked last. */
  const trimmed = out.filter((k) => {
    const area = k.includes(".") ? sellerAreaOf(k) : null;
    return !(area && out.includes(area));
  });
  // Stored in the order the catalogue lists them, not the order they were
  // clicked, so two stores with the same access read identically on screen
  // and in the database.
  return ALL_GRANT_KEYS.filter((k) => trimmed.includes(k));
}

/** "Sales, Catalog (1/2)" -- the one-line version for a row.
 *
 * An area granted whole is named plainly; an area granted in part says so
 * with a count, because those are different permissions and a row that
 * showed them the same way would be the screen misreporting what a store
 * is paying for. */
export function featureSummary(
  features: readonly string[], label: (key: string) => string,
  none: string, all: string
): string {
  const granted = normalizeFeatures(features);
  if (!granted.length) return none;
  if (GRANTABLE_AREAS.every((a) => granted.includes(a))) return all;

  const names: string[] = [];
  for (const area of SELLER_AREAS) {
    if (!grantableArea(area)) continue;
    const name = label(area.labelKey);
    if (granted.includes(area.key)) { names.push(name); continue; }
    const tabs = area.subsections.filter(grantableSubsection);
    const picked = tabs.filter((s) => granted.includes(s.key)).length;
    if (picked > 0) names.push(`${name} (${picked}/${tabs.length})`);
  }
  return names.length ? names.join(", ") : none;
}
