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

export interface AdminSection {
  key: SectionKey;
  /** i18n key for the name shown in the nav and the checklist. */
  labelKey: string;
  /** Every path that belongs to this section, including detail routes
   * that never appear in the navigation. Matched on segment boundaries,
   * longest first -- see sectionForPath. */
  paths: string[];
}

/* Order matters only for display: this is the order the checklist and the
 * nav present them in. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  // /admin/no-access is the screen shown to somebody refused elsewhere,
  // so it lives in the one section every signed-in account holds.
  { key: "home", labelKey: "navHome", paths: ["/admin", "/admin/no-access"] },
  {
    key: "sales", labelKey: "navSales",
    // /admin/o/<id> is an order; it belongs with orders even though the
    // nav has no tab for it.
    paths: ["/admin/sales", "/admin/orders", "/admin/notifications", "/admin/o"],
  },
  {
    key: "catalog", labelKey: "navCatalog",
    // /admin/sales/costs sits under the sales URL but is a catalog screen
    // -- unit costs are a property of a product. Longest-match resolves
    // it correctly, which is exactly why the matching is longest-match.
    paths: [
      "/admin/products", "/admin/stock", "/admin/cats",
      "/admin/demand", "/admin/sales/costs", "/admin/p",
      // A retired screen that now redirects into /admin/demand. Listed so
      // it is refused at its own door rather than one hop later, and so
      // "every page belongs to a section" stays literally true.
      "/admin/statistics",
    ],
  },
  { key: "procurement", labelKey: "navProcurement", paths: ["/admin/procurement"] },
  { key: "sellers", labelKey: "navSellers", paths: ["/admin/sellers", "/admin/payouts"] },
  { key: "storefront", labelKey: "navStorefront", paths: ["/admin/hero", "/admin/promotions"] },
  {
    key: "settings", labelKey: "navSettings",
    paths: ["/admin/settings", "/admin/sales/targets", "/admin/users", "/admin/activity"],
  },
] as const;

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
export function sectionForPath(path: string): SectionKey | null {
  // Query strings and fragments are not part of the route.
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: { key: SectionKey; length: number } | null = null;
  for (const section of ADMIN_SECTIONS) {
    for (const base of section.paths) {
      if (within(clean, base) && (!best || base.length > best.length)) {
        best = { key: section.key, length: base.length };
      }
    }
  }
  return best?.key ?? null;
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
  return access.sections.includes(section);
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
export function normalizeSections(value: unknown): SectionKey[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(ALL_SECTIONS);
  const out: SectionKey[] = [];
  for (const v of value) {
    if (typeof v === "string" && known.has(v) && !out.includes(v as SectionKey)) {
      out.push(v as SectionKey);
    }
  }
  return out;
}

/** Anything that is not exactly "admin" is a reader.
 *
 * Fail closed: a row with a null, a typo, or a role from a future version
 * of the app reads as the least privilege, not the most. */
export function normalizeRole(value: unknown): AdminRole {
  return value === "admin" ? "admin" : "reader";
}
