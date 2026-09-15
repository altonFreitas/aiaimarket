"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";
import { t } from "@/lib/i18n";
import {
  ADMIN_SECTIONS, canWrite, sectionOfSubsection, subsectionForPath, visibleSubsections,
  type Access, type AdminSection,
} from "@/lib/adminSections";
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


/* NO SECOND LIST HERE ANY MORE.
 *
 * This file used to carry its own table of areas and tabs -- the same
 * structure as ADMIN_SECTIONS, with labels bolted on. Two lists of "which
 * pages are Sales" is two chances to disagree, and the file that defines
 * the LOCK is the one that has to win. The labels moved into
 * lib/adminSections.ts beside the paths, and the nav reads them.
 *
 * So a tab added to that file appears here, is guarded at its page, and
 * shows up in the access checklist, from one edit. */

/** The group owning a path. Longest matching tab href wins, so
 * /admin/procurement/suppliers resolves to Procurement rather than to
 * whichever group happens to list a shorter prefix first. "/admin" is only
 * ever an exact match -- as a prefix it would swallow every admin page. */
function activeSection(pathname: string): AdminSection {
  const sub = subsectionForPath(pathname);
  const key = sub ? sectionOfSubsection(sub.key) : null;
  return ADMIN_SECTIONS.find((s) => s.key === key) ?? ADMIN_SECTIONS[1];
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
  /* ONLY WHAT THIS ACCOUNT CAN ACTUALLY OPEN, area and tab alike.
   *
   * Cosmetic -- every page checks for itself, so a link removed here is a
   * courtesy and not the lock. But a tab that always refuses is a broken
   * link with a label on it, and showing somebody five tabs that bounce
   * them is a worse way of saying the same thing.
   *
   * An area with no openable tab is dropped entirely: an area whose every
   * tab refuses is a heading over nothing. */
  const sections = ADMIN_SECTIONS
    .map((s) => ({ section: s, tabs: visibleSubsections(access, s.key) }))
    .filter((g) => g.tabs.length > 0);
  const section = activeSection(pathname);
  const current = sections.find((g) => g.section.key === section.key) ?? sections[0];
  const readOnly = !canWrite(access);

  return (
    <>
      <nav className="adm-nav adm-nav-top">
        {sections.map((g) => (
          // The area lands on the FIRST tab this account can open, not on
          // the area's own first tab -- somebody granted only Activity must
          // not be sent to Settings and bounced.
          <Link key={g.section.key} href={g.tabs[0].paths[0]}
            aria-current={g.section.key === current?.section.key}>
            {t(g.section.labelKey, lang)}
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

      {/* Second tier. Hidden for a single-tab area, where it would be a row
          of one repeating the label directly above it -- and that now
          includes an area where this account holds only ONE of the tabs. */}
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
