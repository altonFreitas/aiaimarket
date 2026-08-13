"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutSellerAction } from "@/lib/actions/seller-auth";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const TABS = [
  ["/seller/dashboard", "sellerDashboard"],
  ["/seller/products", "sellerProducts"],
  ["/seller/orders", "sellerOrders"],
  ["/seller/settings", "sellerSettings"],
] as const;

export default function SellerNav({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  return (
    <nav className="adm-nav">
      {TABS.map(([href, key]) => (
        <Link key={href} href={href} aria-current={pathname === href}>
          {t(key, lang)}
        </Link>
      ))}
      <Link href="/" style={{ marginLeft: "auto" }}>{t("catalog", lang)} ↗</Link>
      <form action={logoutSellerAction} style={{ display: "contents" }}>
        <button type="submit" style={{ background: "none", border: 0, color: "rgba(255,255,255,.68)", cursor: "pointer", padding: "7px 11px", fontSize: 13 }}>
          {t("logOut", lang)}
        </button>
      </form>
    </nav>
  );
}
