"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";
import { t } from "@/lib/i18n";
import { canSee, canWrite, type Access, type SectionKey } from "@/lib/adminSections";
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
  /** Which section of the admin this group is; what the account must hold
   * to be shown it. Same keys the page guards and the checklist use. */
  section: SectionKey;
  /** Where the group's own label links to -- its most-used tab. */
  href: string;
  tabs: Array<readonly [href: string, key: string]>;
}

const GROUPS: Group[] = [
  {
    // The admin opens on what needs doing, not on a list of everything.
    key: "navHome", section: "home", href: "/admin",
    tabs: [["/admin", "attnTitle"]],
  },
  {
    key: "navSales", section: "sales", href: "/admin/sales",
    tabs: [
      ["/admin/sales", "salesDashboard"],
      ["/admin/orders", "orders"],
      ["/admin/notifications", "pendingMessages"],
    ],
  },
  {
    key: "navCatalog", section: "catalog", href: "/admin/products",
    tabs: [
      ["/admin/products", "products"],
      ["/admin/stock", "stockControl"],
      ["/admin/cats", "categories"],
      ["/admin/demand", "demand"],
      ["/admin/sales/costs", "unitCosts"],
    ],
  },
  {
    key: "navProcurement", section: "procurement", href: "/admin/procurement",
    tabs: [
      ["/admin/procurement", "procurement"],
      ["/admin/procurement/reorder", "reorderPlan"],
      ["/admin/procurement/suppliers", "suppliers"],
    ],
  },
  {
    key: "navSellers", section: "sellers", href: "/admin/sellers",
    tabs: [
      ["/admin/sellers", "sellers"],
      ["/admin/payouts", "payoutsShort"],
    ],
  },
  {
    key: "navStorefront", section: "storefront", href: "/admin/hero",
    tabs: [
      ["/admin/hero", "heroSlides"],
      ["/admin/promotions", "promotions"],
    ],
  },
  {
    key: "navSettings", section: "settings", href: "/admin/settings",
    tabs: [
      ["/admin/settings", "settings"],
      ["/admin/sales/targets", "salesTargets"],
      ["/admin/users", "adminUsers"],
      ["/admin/activity", "activity"],
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

export default function AdminNav({ lang, access }: {
  lang: Lang;
  /** The signed-in admin. `label` is their name, shown so that who you are
   * is a fact on screen rather than something to be inferred from which
   * buttons happen to be missing. */
  access: Access & { label?: string };
}) {
  const pathname = usePathname();

  /* THE LOGIN PAGE GETS NO NAVIGATION, EVEN THOUGH THE LAYOUT ALREADY SAYS SO.
   *
   * app/admin/layout.tsx renders this only when there is a verified
   * session, which is correct and is not enough. A layout is NOT re-rendered
   * when the router moves between two pages that share it, and
   * /admin/login shares it with every other admin page -- so when a session
   * expired and the middleware sent the tab to the login screen, the nav
   * the layout had already produced stayed mounted above it. Tabs to
   * Sales and Settings, sitting over a sign-in form, until the page was
   * reloaded by hand.
   *
   * Checking the path here fixes it wherever the render came from, because
   * this component is the thing that must not appear. */
  if (pathname === "/admin/login") return null;

  // Only the sections this account holds. Cosmetic -- every page checks for
  // itself, so a link removed here is a courtesy, not the lock. Showing the
  // other five and bouncing them off each one is just a worse way to say
  // the same thing.
  const isOwner = access.kind === "owner";
  const groups = GROUPS.filter((g) => canSee(access, g.section)).map((g) => ({
    ...g,
    // Managing accounts is the owner's alone -- the page refuses everyone
    // else. A tab that always refuses is a broken link with a label on it,
    // so staff are not offered it.
    tabs: g.tabs.filter(([href]) => isOwner || href !== "/admin/users"),
  }));
  const group = activeGroup(pathname);
  const readOnly = !canWrite(access);

  return (
    <>
      <nav className="adm-nav adm-nav-top">
        {groups.map((g) => (
          <Link key={g.key} href={g.href} aria-current={g.key === group.key}>
            {t(g.key, lang)}
          </Link>
        ))}
        {access.label && (
          <span className="adm-who" title={t("signedInAs", lang) + ": " + access.label}>
            {access.label}
          </span>
        )}
        {readOnly && (
          /* Said once, at the top, rather than on every button. Somebody
             who cannot save should know that before they fill in a form,
             not after. */
          <span className="adm-readonly" title={t("readOnlyHint", lang)}>
            {t("readOnlyBadge", lang)}
          </span>
        )}
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
      {group.tabs.length > 1 && canSee(access, group.section) && (
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
