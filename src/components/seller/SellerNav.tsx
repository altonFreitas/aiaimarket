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
  lang, features,
}: { lang: Lang; features: readonly string[] }) {
  const pathname = usePathname();
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
      <Link href="/" style={{ marginLeft: "auto" }}>{t("catalog", lang)} ↗</Link>
      <form action={logoutSellerAction} style={{ display: "contents" }}>
        <button type="submit" style={{ background: "none", border: 0, color: "rgba(255,255,255,.68)", cursor: "pointer", padding: "7px 11px", fontSize: 13 }}>
          {t("logOut", lang)}
        </button>
      </form>
    </nav>
  );
}
