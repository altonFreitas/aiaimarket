"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CartIcon from "./CartIcon";
import TrackIcon from "./TrackIcon";
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
        <CartIcon strokeWidth={1.8} />
        <BasketBadge as="bump" />
        <span>{t("navList", lang)}</span>
      </Link>
      <Link href="/track" aria-current={isAt("/track") || isAt("/o/")}>
        {/* The same parcel the desktop header shows. This bar kept the
            magnifying glass after the header stopped using it, so the
            errand looked like one thing on a laptop and another on a
            phone -- and on the phone it looked like search, which is a
            separate button two tabs away. */}
        {/* No size: .nav svg in globals.css sizes every icon in this bar
            to 20px, so passing one here would be dead. The stroke matches
            its neighbours. */}
        <TrackIcon strokeWidth={1.8} />
        <span>{t("navTrack", lang)}</span>
      </Link>
    </nav>
  );
}
