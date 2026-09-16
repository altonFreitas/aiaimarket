"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutSellerAction } from "@/lib/actions/seller-auth";
import {
  SELLER_AREAS, sellerAreaOf, sellerSubsectionForPath, visibleSellerSubsections,
  type SellerArea,
} from "@/lib/sellerFeatures";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* The store's own navigation, in the two tiers the admin's has.
 *
 * It used to be one flat row of up to eight links, because access was one
 * flat list of eight features. Now that a store is granted AREAS and TABS
 * the nav says so: the areas across the top, the tabs of whichever area
 * you are in underneath.
 *
 * Read from SELLER_AREAS rather than a list typed out here, so granting an
 * area on the Sellers screen puts its tabs in the seller's navigation with
 * nothing else to change -- and, more importantly, so a tab can never
 * appear that the page guard then refuses. A door that opens onto a locked
 * door is worse than no door: it reads as the shop being broken rather
 * than as the feature not being included.
 *
 * `features` comes from the seller's own row on the server (see
 * seller/layout.tsx), not from anything the browser could claim. Hiding a
 * tab is presentation; requireSellerFeature() on each page is the lock. */

/** The area owning a path. Longest matching tab wins, so a future
 * /seller/products/insights resolves to Catalog rather than to whichever
 * area lists a shorter prefix first. */
function activeArea(pathname: string, areas: readonly SellerArea[]): SellerArea | null {
  const sub = sellerSubsectionForPath(pathname);
  const key = sub ? sellerAreaOf(sub.key) : null;
  return areas.find((a) => a.key === key) ?? areas[0] ?? null;
}

function isCurrent(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // A detail page keeps its list tab lit: /seller/products/new belongs to
  // My products. Guarded with "/" so /seller/sales does not light
  // /seller/salesfoo.
  return pathname.startsWith(href + "/");
}

export default function SellerNav({
  lang, features, storeName = "",
}: { lang: Lang; features: readonly string[]; storeName?: string }) {
  const pathname = usePathname();

  /* The ways IN get no navigation. Same reasoning as AdminNav: a layout is
   * not re-rendered when the router moves between two pages that share it,
   * so a nav produced for a signed-in store can outlive the session and sit
   * above a sign-in or sign-up form until the page is reloaded. */
  if (pathname === "/seller/login" || pathname === "/seller/register") return null;

  /* Only what this store can actually open, area and tab alike. An area
   * with no openable tab is dropped entirely -- a heading over nothing is
   * worse than no heading. */
  const areas = SELLER_AREAS
    .map((a) => ({ area: a, tabs: visibleSellerSubsections(features, a.key) }))
    .filter((g) => g.tabs.length > 0);
  const active = activeArea(pathname, areas.map((g) => g.area));
  const current = areas.find((g) => g.area.key === active?.key) ?? areas[0];

  return (
    <>
      <nav className="adm-nav adm-nav-top">
        {areas.map((g) => (
          // The area lands on the FIRST tab this store can open, not on the
          // area's own first tab -- a store granted only Today must not be
          // sent to My orders' neighbour and bounced.
          <Link key={g.area.key} href={g.tabs[0].paths[0]}
            aria-current={g.area.key === current?.area.key}>
            {t(g.area.labelKey, lang)}
          </Link>
        ))}
        {/* Whose shop this is, then the way out to the storefront, then the
            way out of the account -- the same three, in the same order and
            the same shapes, as AdminNav. A person who has both accounts on
            one laptop should not have to work out which one they are in
            from which tabs are missing. */}
        {storeName && (
          <span className="adm-who" title={t("signedInAs", lang) + ": " + storeName}>
            {storeName}
          </span>
        )}
        <Link href="/" style={{ marginLeft: "auto" }}>{t("catalog", lang)} ↗</Link>
        <form action={logoutSellerAction} style={{ display: "contents" }}>
          {/* Icon only, but never label-less: the accessible name still says
              "log out" for a screen reader, and title= gives a sighted user
              the same words on hover. */}
          <button type="submit" className="adm-nav-icon"
            title={t("logOut", lang)} aria-label={t("logOut", lang)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </form>
      </nav>

      {/* Second tier. Hidden for a single-tab area, where it would be a row
          of one repeating the label directly above it -- and that includes
          an area where this store holds only ONE of the tabs. */}
      {current && current.tabs.length > 1 && (
        <nav className="adm-nav adm-nav-sub">
          {current.tabs.map((sub) => (
            <Link key={sub.key} href={sub.paths[0]}
              aria-current={isCurrent(pathname, sub.paths[0])}>
              {t(sub.labelKey, lang)}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
