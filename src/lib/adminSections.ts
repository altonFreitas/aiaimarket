/* Who can see which part of the admin, and who can change anything.
 *
 * Two separate questions, deliberately kept separate:
 *
 *   role     what you may DO anywhere you can go -- "admin" writes,
 *            "reader" only looks.
 *   sections WHERE you may go at all.
 *
 * A reader with every section still cannot change a price; an admin with
 * only Procurement can do anything at all inside Procurement and cannot
 * open Sales. The two compose, which is what makes "the bookkeeper sees
 * the numbers but touches nothing" and "the storeman runs purchasing and
 * nothing else" both expressible without inventing a role for each.
 *
 * SECTIONS, NOT PAGES. The admin has 26 pages and 7 sections, and the
 * sections are the ones already in the navigation -- so this list drives
 * the nav, the checklist on the Admin users screen, and the lock on each
 * page from one definition. Three copies of "which pages are Sales" would
 * be three chances to disagree. It also covers the pages the nav never
 * shows: an order detail at /admin/o/<id> belongs to Sales here, and a
 * per-page checklist would simply have missed it.
 *
 * No server-only import: the nav is a client component and the guard is a
 * server one, and both need this. Nothing here reads a session or a
 * database -- it is a map and three predicates. */

export type SectionKey =
  | "home" | "sales" | "catalog" | "procurement"
  | "sellers" | "storefront" | "settings";

export type AdminRole = "admin" | "reader";

export interface AdminSubsection {
  /** Namespaced on its area -- "settings.users", not "users" -- so a key
   * stored on an account says which area it belongs to without a lookup,
   * and so two areas may both have a "Suppliers" without colliding. */
  key: string;
  /** i18n key for the name on the tab and in the checklist. */
  labelKey: string;
  /** Every path that belongs to this subsection, including detail routes
   * that never appear as a tab. Matched on segment boundaries, longest
   * first -- see subsectionForPath. */
  paths: string[];
  /** Never granted to staff and never offered in the checklist. Managing
   * accounts is the owner's alone: an account that could edit accounts
   * could grant itself everything, which is not a permission, it is the
   * absence of one. */
  ownerOnly?: boolean;
}

export interface AdminSection {
  key: SectionKey;
  /** i18n key for the name shown in the nav and the checklist. */
  labelKey: string;
  /** The tabs inside this area, in the order they are shown. The FIRST is
   * where the area's own nav link lands. */
  subsections: readonly AdminSubsection[];
}

/* Order matters only for display: this is the order the checklist and the
 * nav present them in. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    // /admin/no-access is the screen shown to somebody refused elsewhere,
    // so it lives in the one section every signed-in account holds.
    key: "home", labelKey: "navHome",
    subsections: [
      // /admin/overview is the deep version of the front page's money-in
      // against money-out tile, and belongs to the same subsection: an
      // account that may see one may see the other, and the two halves of
      // it are withheld by Sales and Procurement inside the screen just as
      // they are on the front page.
      { key: "home.overview", labelKey: "attnTitle",
        paths: ["/admin", "/admin/overview", "/admin/no-access"] },
    ],
  },
  {
    key: "sales", labelKey: "navSales",
    subsections: [
      { key: "sales.dashboard", labelKey: "salesDashboard", paths: ["/admin/sales"] },
      // /admin/o/<id> is one order; it belongs with the order list even
      // though the nav has no tab for it.
      { key: "sales.orders", labelKey: "orders", paths: ["/admin/orders", "/admin/o"] },
      // What came back. A customer return is a property of an order, so it
      // belongs here; the supplier half of that screen is drawn only for
      // somebody who also holds Procurement, and the actions behind it
      // check the same thing.
      { key: "sales.returns", labelKey: "returns", paths: ["/admin/returns"] },
      { key: "sales.notifications", labelKey: "pendingMessages", paths: ["/admin/notifications"] },
    ],
  },
  {
    key: "catalog", labelKey: "navCatalog",
    subsections: [
      { key: "catalog.products", labelKey: "products", paths: ["/admin/products", "/admin/p"] },
      { key: "catalog.stock", labelKey: "stockControl", paths: ["/admin/stock"] },
      { key: "catalog.categories", labelKey: "categories", paths: ["/admin/cats"] },
      // /admin/statistics is a retired screen that redirects into demand.
      // Listed so it is refused at its own door rather than one hop later,
      // and so "every page belongs to a subsection" stays literally true.
      { key: "catalog.demand", labelKey: "demand", paths: ["/admin/demand", "/admin/statistics"] },
      // Sits under the sales URL and is a catalog screen -- a unit cost is
      // a property of a product. Longest-match resolves it, which is
      // exactly why the matching is longest-match.
      { key: "catalog.costs", labelKey: "unitCosts", paths: ["/admin/sales/costs"] },
      // What customers wrote about the catalog. The store-ratings half of
      // that screen is drawn only for somebody who also holds Sellers, and
      // deleteSellerRating checks the same thing.
      { key: "catalog.reviews", labelKey: "reviewsAdmin", paths: ["/admin/reviews"] },
    ],
  },
  {
    key: "procurement", labelKey: "navProcurement",
    subsections: [
      // Longest-match is what keeps the two below out of this one, even
      // though /admin/procurement is a prefix of both.
      { key: "procurement.orders", labelKey: "procurement", paths: ["/admin/procurement"] },
      { key: "procurement.reorder", labelKey: "reorderPlan", paths: ["/admin/procurement/reorder"] },
      { key: "procurement.suppliers", labelKey: "suppliers", paths: ["/admin/procurement/suppliers"] },
    ],
  },
  {
    key: "sellers", labelKey: "navSellers",
    subsections: [
      { key: "sellers.list", labelKey: "sellers", paths: ["/admin/sellers"] },
      { key: "sellers.payouts", labelKey: "payoutsShort", paths: ["/admin/payouts"] },
    ],
  },
  {
    key: "storefront", labelKey: "navStorefront",
    subsections: [
      { key: "storefront.hero", labelKey: "heroSlides", paths: ["/admin/hero"] },
      { key: "storefront.promotions", labelKey: "promotions", paths: ["/admin/promotions"] },
    ],
  },
  {
    key: "settings", labelKey: "navSettings",
    subsections: [
      { key: "settings.shop", labelKey: "settings", paths: ["/admin/settings"] },
      // The books. Under Settings rather than Sales because they carry
      // what the shop pays its suppliers, its staff and its bank -- more
      // sensitive than margin, which can at least be guessed from prices.
      { key: "settings.finance", labelKey: "finance", paths: ["/admin/finance"] },
      { key: "settings.targets", labelKey: "salesTargets", paths: ["/admin/sales/targets"] },
      { key: "settings.users", labelKey: "adminUsers", paths: ["/admin/users"], ownerOnly: true },
      { key: "settings.activity", labelKey: "activity", paths: ["/admin/activity"] },
    ],
  },
] as const;

/** Every subsection, flattened. */
export const ALL_SUBSECTIONS: readonly AdminSubsection[] =
  ADMIN_SECTIONS.flatMap((s) => s.subsections);

/** The area a subsection key belongs to, read off the key itself. */
export function sectionOfSubsection(subKey: string): SectionKey | null {
  const head = subKey.split(".")[0];
  return (ALL_SECTIONS as readonly string[]).includes(head) ? (head as SectionKey) : null;
}

/** Home is not a permission. It is the "what needs doing" screen and the
 * place the nav lands you; a staff account that could sign in but had
 * nowhere to land would just be a broken account. Its cards are filtered
 * by the sections the viewer actually has, so it never becomes a way to
 * read a section through the back door. */
export const ALWAYS_GRANTED: readonly SectionKey[] = ["home"];

/** The sections an owner has, and the ones a full-access staff account is
 * given -- everything that is actually a choice. */
export const GRANTABLE_SECTIONS: readonly SectionKey[] =
  ADMIN_SECTIONS.map((s) => s.key).filter((k) => !ALWAYS_GRANTED.includes(k));

export const ALL_SECTIONS: readonly SectionKey[] = ADMIN_SECTIONS.map((s) => s.key);

/** Does `path` sit inside `base`?
 *
 * Segment-aware on purpose. A plain startsWith would put /admin/payouts
 * inside /admin/p -- the product detail route -- and hand the Sellers
 * section's payouts screen to anyone with Catalog. "/admin" itself is
 * exact-only; as a prefix it contains every admin page there is. */
function within(path: string, base: string): boolean {
  if (base === "/admin") return path === "/admin";
  return path === base || path.startsWith(base + "/");
}

/** Which section a path belongs to, or null if it is not an admin page.
 *
 * Longest match wins, so /admin/sales/costs resolves to Catalog rather
 * than to Sales, whose /admin/sales also contains it. */
export function subsectionForPath(path: string): AdminSubsection | null {
  // Query strings and fragments are not part of the route.
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: { sub: AdminSubsection; length: number } | null = null;
  for (const section of ADMIN_SECTIONS) {
    for (const sub of section.subsections) {
      for (const base of sub.paths) {
        if (within(clean, base) && (!best || base.length > best.length)) {
          best = { sub, length: base.length };
        }
      }
    }
  }
  return best?.sub ?? null;
}

export function sectionForPath(path: string): SectionKey | null {
  const sub = subsectionForPath(path);
  return sub ? sectionOfSubsection(sub.key) : null;
}

/* ---------------------------------------------------------------------
 * The two questions, asked of an actor.
 *
 * Both take the plain fields rather than the AdminActor type, so this
 * module stays free of the session (which is server-only) and can be
 * tested without one.
 * ------------------------------------------------------------------- */

export interface Access {
  kind: "owner" | "staff";
  role: AdminRole;
  sections: readonly string[];
}

/** The owner is not a row and has no checkboxes: they are the account the
 * shop is reachable through if everything on the Admin users screen goes
 * wrong, so they always have everything. */
export function canSee(access: Access, section: SectionKey): boolean {
  if (access.kind === "owner") return true;
  if (ALWAYS_GRANTED.includes(section)) return true;
  // The AREA opens if the account holds the area itself, OR any single tab
  // inside it. Somebody granted only Activity still needs the Settings tab
  // to exist, or there is no way to reach the one thing they hold.
  return access.sections.includes(section)
    || access.sections.some((k) => sectionOfSubsection(k) === section);
}

/** May this account open this one TAB?
 *
 * TWO KINDS OF GRANT, AND THE DIFFERENCE IS DELIBERATE.
 *
 *   "settings"        the whole area, including tabs added in a later
 *                     version of the app. Somebody trusted with Settings
 *                     was trusted with Settings, not with a list.
 *   "settings.users"  exactly that tab, and nothing that appears beside it
 *                     afterwards. A grant of three named tabs must not
 *                     silently become four.
 *
 * Getting that the other way round is how a permission quietly widens
 * between releases, which is the failure nobody is watching for. */
export function canOpenSubsection(access: Access, subKey: string): boolean {
  if (access.kind === "owner") return true;
  const sub = ALL_SUBSECTIONS.find((x) => x.key === subKey);
  // An unknown key is refused. A subsection removed in a later version
  // leaves stale strings on rows, and a stale string must not open a door.
  if (!sub) return false;
  // Managing accounts is the owner's alone, whatever the row says.
  if (sub.ownerOnly) return false;
  const section = sectionOfSubsection(subKey);
  if (section && ALWAYS_GRANTED.includes(section)) return true;
  if (section && access.sections.includes(section)) return true;
  return access.sections.includes(subKey);
}

/** The same question asked of a URL, which is what a guard has. */
export function canOpenPath(access: Access, path: string): boolean {
  const sub = subsectionForPath(path);
  // Not an admin page at all: not this module's business to permit.
  if (!sub) return false;
  return canOpenSubsection(access, sub.key);
}

/** The tabs of one area this account may actually open, in display order.
 * Empty is a real answer and the nav must handle it. */
export function visibleSubsections(
  access: Access, section: SectionKey
): AdminSubsection[] {
  const found = ADMIN_SECTIONS.find((s) => s.key === section);
  if (!found) return [];
  return found.subsections.filter((sub) => canOpenSubsection(access, sub.key));
}

/** Whether this person may change anything at all. Roles are not
 * per-section: "read-only in Sales but not in Catalog" is a rule nobody
 * has ever needed to explain to a new member of staff, and every extra
 * axis here is another way to get a permission wrong by accident. */
export function canWrite(access: Access): boolean {
  return access.kind === "owner" || access.role === "admin";
}

/** Normalises whatever came out of the database into section keys we
 * recognise. A section removed from the app in a later version leaves
 * stale strings in rows; they are dropped rather than carried around. */
export function normalizeSections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>([...GRANTABLE_SECTIONS,
    ...ALL_SUBSECTIONS.filter(grantableSubsection).map((s) => s.key)]);
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && known.has(v) && !out.includes(v)) out.push(v);
  }
  /* A SUBSECTION KEY IS REDUNDANT BESIDE ITS OWN AREA, and keeping both
     would make the two grants indistinguishable the moment a new tab
     appeared: ["settings","settings.users"] would have to mean either
     "everything" or "just users", and nothing on the row says which. The
     area wins, because it is the wider of the two and the one the person
     ticking the box saw last. */
  return out.filter((k) => {
    const parent = k.includes(".") ? sectionOfSubsection(k) : null;
    return !(parent && out.includes(parent));
  });
}

/** Every string an account may legitimately hold: the grantable areas and
 * the tabs inside them. Used by the checklist and by the database's own
 * check constraint, which is generated from this list. */
export const ALL_GRANT_KEYS: readonly string[] = [
  ...GRANTABLE_SECTIONS,
  ...ALL_SUBSECTIONS.filter(grantableSubsection).map((s) => s.key),
];

/** Is this tab something the owner may hand out?
 *
 * No for an owner-only tab -- an account that could edit accounts could
 * grant itself everything, which is not a permission but the absence of
 * one. No for a tab of an always-granted area either: Home is not a
 * checkbox, and a key for it stored on a row would be a permission nothing
 * reads, making the screen and the database disagree about what was
 * granted. */
export function grantableSubsection(sub: AdminSubsection): boolean {
  if (sub.ownerOnly) return false;
  const section = sectionOfSubsection(sub.key);
  return !(section && ALWAYS_GRANTED.includes(section));
}

/** Anything that is not exactly "admin" is a reader.
 *
 * Fail closed: a row with a null, a typo, or a role from a future version
 * of the app reads as the least privilege, not the most. */
export function normalizeRole(value: unknown): AdminRole {
  return value === "admin" ? "admin" : "reader";
}
