"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const TABS = [
  ["/admin", "products"],
  ["/admin/stock", "stockControl"],
  ["/admin/procurement", "procurement"],
  ["/admin/cats", "categories"],
  ["/admin/hero", "heroSlides"],
  ["/admin/promotions", "promotions"],
  ["/admin/sellers", "sellers"],
  ["/admin/orders", "orders"],
  ["/admin/notifications", "pendingMessages"],
  ["/admin/payouts", "payoutsShort"],
  ["/admin/statistics", "statistics"],
  ["/admin/settings", "settings"],
] as const;

export default function AdminNav({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  return (
    <nav className="adm-nav">
      {TABS.map(([href, key]) => (
        <Link key={href} href={href} aria-current={pathname === href}>
          {t(key, lang)}
        </Link>
      ))}
      <Link href="/" style={{ marginLeft: "auto" }}>{t("catalog", lang)} ↗</Link>
      <form action={logoutAction} style={{ display: "contents" }}>
        {/* Icon only, but never label-less: the accessible name still says
            "sign out" for a screen reader, and title= gives a sighted user
            the same words on hover. An unlabelled icon button is a guess. */}
        <button type="submit" className="adm-nav-icon" title={t("logout", lang)} aria-label={t("logout", lang)}>
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
