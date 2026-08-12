"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const TABS = [
  ["/admin", "products"],
  ["/admin/cats", "categories"],
  ["/admin/hero", "heroSlides"],
  ["/admin/orders", "orders"],
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
        <button type="submit" style={{ background: "none", border: 0, color: "rgba(255,255,255,.68)", cursor: "pointer", padding: "7px 11px", fontSize: 13 }}>
          {t("logout", lang)}
        </button>
      </form>
    </nav>
  );
}
