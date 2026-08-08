"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BasketBadge from "./BasketBadge";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function BottomNav({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const isAt = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));

  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" aria-current={isAt("/") && pathname === "/"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3 9.5 12 3l9 6.5V21H3z" />
        </svg>
        <span>{t("catalog", lang)}</span>
      </Link>
      <Link href="/list" aria-current={isAt("/list")} style={{ position: "relative" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        <BasketBadge as="bump" />
        <span>{t("navList", lang)}</span>
      </Link>
      <Link href="/track" aria-current={isAt("/track") || isAt("/o/")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span>{t("navTrack", lang)}</span>
      </Link>
      <Link href="/admin" aria-current={isAt("/admin")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 4v5" />
        </svg>
        <span>{t("admin", lang)}</span>
      </Link>
    </nav>
  );
}
