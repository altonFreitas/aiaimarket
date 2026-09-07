"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LangSwitch from "./LangSwitch";
import SearchBar from "./SearchBar";
import { t } from "@/lib/i18n";
import type { NavRoot } from "@/lib/nav";
import type { Lang } from "@/lib/types";

/** Where the shop's own navigation is not what someone is navigating.
 * Same list MegaNav uses -- see the note there. */
const STAFF_PATHS = ["/admin", "/seller"];

type View = "menu" | "search";

/** The phone's navigation: two icons in the header, and a full screen
 * behind each.
 *
 * WHY NOT THE ROW OF CATEGORY NAMES IT REPLACES. Six category names do not
 * fit across 390px, so they became a row that scrolled sideways -- and a
 * row that scrolls sideways hides whatever is past its right edge behind a
 * gesture nobody is told about. Below it sat a second line holding the
 * search field. Two lines of chrome, one of them a guessing game.
 *
 * A menu button and a search button cost one line between them and hide
 * nothing: everything is on the screen that opens. This is what every
 * storefront of this kind does on a phone, and it is what the desktop bar
 * (MegaNav) already does with hover, expressed for a device that has no
 * hover to give.
 *
 * BOTH SCREENS ARE PORTALS. The buttons live inside the header, which is a
 * stacking context at z-index 40, and the bottom navigation sits at 50 --
 * so a panel rendered where the buttons are would open UNDERNEATH it. The
 * portal puts the screens on <body>, where their own z-index means what it
 * says. It is only ever created after a tap, so there is no server/browser
 * mismatch to guard against. */
export default function MobileNav({ roots, lang }: { roots: NavRoot[]; lang: Lang }) {
  const pathname = usePathname();
  const [view, setView] = useState<View | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState(pathname);

  // Navigating closes whatever is open, including on the back button. Done
  // during render rather than in an effect, so the panel never paints over
  // the page it just opened for a frame.
  if (pathname !== shownFor) {
    setShownFor(pathname);
    setView(null);
  }

  const active = roots.find((r) => r.id === tab) || roots[0] || null;

  // Esc closes, same as every other overlay in the app. The panel also
  // takes the page's scroll while it is open -- without that, dragging the
  // menu scrolls the catalogue behind it and the menu appears to be stuck.
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setView(null); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [view]);

  if (STAFF_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  function openMenu() {
    setTab((cur) => cur ?? roots[0]?.id ?? null);
    setOpenGroup(null);
    setView("menu");
  }

  return (
    <>
      <button type="button" className="hd-mob" aria-label={t("navMenu", lang)}
        aria-expanded={view === "menu"} onClick={openMenu}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <button type="button" className="hd-mob" aria-label={t("search", lang)}
        aria-expanded={view === "search"} onClick={() => setView("search")}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>

      {view === "menu" && createPortal(
        <div className="msheet" role="dialog" aria-modal="true" aria-label={t("navMenu", lang)}>
          <div className="msheet-top">
            <button type="button" className="msheet-x" onClick={() => setView(null)}
              aria-label={t("close", lang)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {roots.length > 1 && (
            <div className="msheet-tabs" role="tablist" aria-label={t("categories", lang)}>
              {roots.map((r) => (
                <button key={r.id} type="button" role="tab" aria-selected={active?.id === r.id}
                  className={"msheet-tab" + (active?.id === r.id ? " is-on" : "")}
                  onClick={() => { setTab(r.id); setOpenGroup(null); }}>
                  {r.label}
                </button>
              ))}
            </div>
          )}

          <div className="msheet-body">
            {active && (
              <>
                <Link className="msheet-all" href={active.href} onClick={() => setView(null)}>
                  {t("navShopAllOf", lang)} {active.label}
                  <span aria-hidden="true"> →</span>
                </Link>
                <ul className="msheet-list">
                  {active.groups.map((g) => (
                    <li key={g.id}>
                      <div className="msheet-row">
                        <Link href={g.href} onClick={() => setView(null)}>
                          <span>{g.label}</span>
                          <span className="n">{g.count}</span>
                        </Link>
                        {g.children.length > 0 && (
                          // The chevron reveals; the row beside it navigates.
                          // Two targets, two jobs, neither guessing which was
                          // meant.
                          <button type="button" className="msheet-exp"
                            aria-expanded={openGroup === g.id} aria-label={g.label}
                            onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                              stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                              <path d="m9 6 6 6-6 6" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {g.children.length > 0 && openGroup === g.id && (
                        <ul className="msheet-kids">
                          {g.children.map((k) => (
                            <li key={k.href}>
                              <Link href={k.href} onClick={() => setView(null)}>
                                <span>{k.label}</span>
                                <span className="n">{k.count}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <Link className="msheet-all msheet-all-shop" href="/shop" onClick={() => setView(null)}>
              {t("navShopAll", lang)}<span aria-hidden="true"> →</span>
            </Link>

            {/* The language switch lives here rather than in the header. At
                390px the header holds two icons, the logo and an account
                button, and three language buttons beside them left nothing
                for the shop's name. */}
            <div className="msheet-foot">
              <LangSwitch current={lang} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {view === "search" && createPortal(
        <div className="msheet" role="dialog" aria-modal="true" aria-label={t("search", lang)}>
          <div className="msheet-top msheet-top-search">
            <button type="button" className="msheet-x" onClick={() => setView(null)}
              aria-label={t("back", lang)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <div className="site-search msheet-field">
              <SearchBar lang={lang} autoFocus onSubmit={() => setView(null)} />
            </div>
          </div>

          {/* No invented "trending searches" -- this shop does not record
              what people search for. What it does have is its own aisles,
              which is a real answer to "what is in here". */}
          {roots.length > 0 && (
            <div className="msheet-body">
              <p className="msheet-hd">{t("categories", lang)}</p>
              <ul className="msheet-list">
                {roots.map((r) => (
                  <li key={r.id}>
                    <div className="msheet-row">
                      <Link href={r.href} onClick={() => setView(null)}>
                        <span>{r.label}</span>
                        <span className="n">{r.count}</span>
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
