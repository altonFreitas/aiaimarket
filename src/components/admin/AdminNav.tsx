"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* Two tiers, not twelve flat tabs.
 *
 * Twelve equal-weight links said nothing about what is a daily task and what
 * is a quarterly setting, so every screen had to be found by reading the
 * whole bar. Grouping into six domains puts the count inside the range a
 * person can scan at a glance, and the second row only ever shows the tabs
 * of the section you are actually in.
 *
 * Routes are unchanged. Grouping is a navigation concern; moving pages would
 * break every bookmark and inbound link for no gain. */

interface Group {
  key: string;
  /** Where the group's own label links to -- its most-used tab. */
  href: string;
  tabs: Array<readonly [href: string, key: string]>;
}

const GROUPS: Group[] = [
  {
    key: "navSales", href: "/admin/sales",
    tabs: [
      ["/admin/sales", "salesDashboard"],
      ["/admin/orders", "orders"],
      ["/admin/notifications", "pendingMessages"],
      ["/admin/statistics", "statistics"],
    ],
  },
  {
    key: "navCatalog", href: "/admin",
    tabs: [
      ["/admin", "products"],
      ["/admin/stock", "stockControl"],
      ["/admin/cats", "categories"],
      ["/admin/sales/costs", "unitCosts"],
    ],
  },
  {
    key: "navProcurement", href: "/admin/procurement",
    tabs: [
      ["/admin/procurement", "procurement"],
      ["/admin/procurement/suppliers", "suppliers"],
    ],
  },
  {
    key: "navSellers", href: "/admin/sellers",
    tabs: [
      ["/admin/sellers", "sellers"],
      ["/admin/payouts", "payoutsShort"],
    ],
  },
  {
    key: "navStorefront", href: "/admin/hero",
    tabs: [
      ["/admin/hero", "heroSlides"],
      ["/admin/promotions", "promotions"],
    ],
  },
  {
    key: "navSettings", href: "/admin/settings",
    tabs: [
      ["/admin/settings", "settings"],
      ["/admin/sales/targets", "salesTargets"],
    ],
  },
];

/** The group owning a path. Longest matching tab href wins, so
 * /admin/procurement/suppliers resolves to Procurement rather than to
 * whichever group happens to list a shorter prefix first. "/admin" is only
 * ever an exact match -- as a prefix it would swallow every admin page. */
function activeGroup(pathname: string): Group {
  let best: { group: Group; length: number } | null = null;
  for (const group of GROUPS) {
    for (const [href] of group.tabs) {
      const hit = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
      if (hit && (!best || href.length > best.length)) best = { group, length: href.length };
    }
  }
  return best?.group ?? GROUPS[1];
}

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  if (pathname === href) return true;
  // A detail page keeps its list tab lit: /admin/procurement/po/x belongs to
  // Purchase orders. Guarded with "/" so /admin/sales does not light
  // /admin/salesfoo.
  return pathname.startsWith(href + "/");
}

export default function AdminNav({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const group = activeGroup(pathname);

  return (
    <>
      <nav className="adm-nav adm-nav-top">
        {GROUPS.map((g) => (
          <Link key={g.key} href={g.href} aria-current={g.key === group.key}>
            {t(g.key, lang)}
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

      {/* Second tier. Hidden for a single-tab group, where it would be a row
          of one repeating the label directly above it. */}
      {group.tabs.length > 1 && (
        <nav className="adm-nav adm-nav-sub">
          {group.tabs.map(([href, key]) => (
            <Link key={href} href={href} aria-current={isCurrent(pathname, href)}>
              {t(key, lang)}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
