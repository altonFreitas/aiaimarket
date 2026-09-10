"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutSellerAction } from "@/lib/actions/seller-auth";
import { SELLER_FEATURES, sellerCanUse } from "@/lib/sellerFeatures";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* The tabs this store actually holds.
 *
 * Read from SELLER_FEATURES rather than a list typed out here, so granting
 * a feature on the Sellers screen puts its tab in the seller's navigation
 * with nothing else to change -- and, more importantly, so a feature can
 * never appear as a tab that the page guard then refuses. A door that
 * opens onto a locked door is worse than no door: it reads as the shop
 * being broken rather than as the feature not being included.
 *
 * `features` comes from the seller's own row on the server (see
 * seller/layout.tsx), not from anything the browser could claim. Hiding a
 * tab is presentation; requireSellerFeature() on each page is the lock. */
export default function SellerNav({
  lang, features, storeName = "",
}: { lang: Lang; features: readonly string[]; storeName?: string }) {
  const pathname = usePathname();

  /* The ways IN get no navigation. Same reasoning as AdminNav: a layout is
   * not re-rendered when the router moves between two pages that share it,
   * so a nav produced for a signed-in store can outlive the session and sit
   * above a sign-in or sign-up form until the page is reloaded. */
  if (pathname === "/seller/login" || pathname === "/seller/register") return null;

  const tabs = SELLER_FEATURES.filter((f) => sellerCanUse(features, f.key));

  return (
    <nav className="adm-nav">
      {tabs.map((f) => {
        const href = f.paths[0];
        return (
          <Link key={f.key} href={href} aria-current={pathname === href}>
            {t(f.labelKey, lang)}
          </Link>
        );
      })}
      {/* Whose shop this is, then the way out to the storefront, then the
          way out of the account -- the same three, in the same order and
          the same shapes, as AdminNav. A person who has both accounts on
          one laptop should not have to work out which one they are in from
          which tabs are missing. */}
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
  );
}
