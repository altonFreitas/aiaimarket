"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import SearchBar from "./SearchBar";
import { placeholder } from "@/lib/placeholder";
import {money,discountPercent} from "@/lib/utils";
import { t } from "@/lib/i18n";
import { isNavFree, type NavProduct, type NavRoot } from "@/lib/nav";
import type { HeroSlide, Lang } from "@/lib/types";

type View = "menu" | "search";

type PageIconName = "home" | "info" | "chat" | "heart" | "track";
interface PageRow { href: string; key: string; icon: PageIconName }

/** The pages, in the order somebody would look for them. Shop and
 *  Categories are deliberately absent -- they are behind the search icon
 *  beside this one, and listing them twice is what made the two buttons
 *  indistinguishable. */
const PAGES: PageRow[] = [
  { href: "/", key: "navHome", icon: "home" },
  { href: "/about", key: "navAbout", icon: "info" },
  { href: "/contact", key: "navContact", icon: "chat" },
];

/** Real destinations the three-tab bottom bar cannot fit. */
const EXTRAS: PageRow[] = [
  { href: "/loves", key: "navLoves", icon: "heart" },
  { href: "/track", key: "navTrack", icon: "track" },
];

function PageIcon({ name }: { name: PageIconName }) {
  const p = {
    width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.9,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "home":
      return <svg {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>;
    case "info":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
    case "chat":
      return <svg {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" /></svg>;
    case "heart":
      return <svg {...p}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>;
    default:
      return <svg {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>;
  }
}

/** ONE ROW, drawn once.
 *
 * The two lists below the rule and above it are the same row with
 * different contents, and they were written out twice -- which is how a
 * row loses its icon, or stops marking the page you are on, in one list
 * only. Nothing in a test can see that: a guard looking for the markup
 * finds the surviving copy and passes. Drawn once, it cannot happen. */
function PageLink(
  { row, lang, here, onGo }:
  { row: PageRow; lang: Lang; here: boolean; onGo: () => void }
) {
  return (
    <Link href={row.href} className="mpage"
      aria-current={here ? "page" : undefined} onClick={onGo}>
      <span className="mpage-ic"><PageIcon name={row.icon} /></span>
      <span className="mpage-t">{t(row.key, lang)}</span>
      <svg className="mpage-arw" width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </Link>
  );
}

/** How many products either screen shows. Four is two rows of two on a
 * phone -- enough to be worth scrolling to, few enough not to bury the
 * navigation above it. */
const SHOWCASE = 4;

/** The banners, as a row of cards. Same slides as the homepage hero, from
 * the same table; a video slide shows its poster frame, because a menu is
 * not the place to start a download. */
function SlideStrip({ slides, onPick }: { slides: HeroSlide[]; onPick: () => void }) {
  if (!slides.length) return null;
  return (
    <div className="msheet-slides">
      {slides.map((s) => {
        const img = s.image_url || placeholder(s.headline || "AIAI");
        return (
          <Link key={s.id} href={s.cta_href || "/shop"} className="msheet-slide" onClick={onPick}>
            <Image src={img} alt="" width={520} height={320} sizes="70vw"
              unoptimized={img.startsWith("data:")} />
            {s.headline && <span className="msheet-slide-t">{s.headline}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/** Real stock, from the same nav model the categories come from. */
function Showcase({ items, onPick }: { items: NavProduct[]; onPick: () => void }) {
  if (!items.length) return null;
  return (
    <div className="msheet-grid">
      {items.map((p) => {
        const img = p.image || placeholder(p.name);
        const pct = discountPercent(p.price, p.discount);
        return (
          <Link key={p.id} href={`/p/${p.slug}`} className="msheet-card" onClick={onPick}>
            <Image src={img} alt="" width={260} height={260} sizes="45vw"
              unoptimized={img.startsWith("data:")} />
            <span className="msheet-card-nm">{p.name}</span>
            <span className="msheet-card-pr">
              {money(p.discount ?? p.price)}
              {pct != null && <b> -{pct}%</b>}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

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
 * nothing: everything is on the screen that opens.
 *
 * THE TWO SCREENS USED TO BE THE SAME SCREEN. Both opened on the aisles,
 * the banners and a showcase of stock -- two buttons, one answer, and the
 * shop noticed. The search button keeps all of that, because "what is in
 * here" is exactly what somebody about to type is asking. The menu button
 * now carries what nothing else on a phone reaches: the pages. Home,
 * About, Contact, and the two destinations the bottom bar has no room
 * for.
 *
 * NOT SHOP OR CATEGORIES. They are one tap away behind the search icon,
 * and a phone menu that lists the same aisles twice is how this pair of
 * buttons became indistinguishable in the first place.
 *
 * BOTH SCREENS ARE PORTALS. The buttons live inside the header, which is a
 * stacking context at z-index 40, and the bottom navigation sits at 50 --
 * so a panel rendered where the buttons are would open UNDERNEATH it. The
 * portal puts the screens on <body>, where their own z-index means what it
 * says. It is only ever created after a tap, so there is no server/browser
 * mismatch to guard against. */
export default function MobileNav({
  roots, slides, lang,
}: { roots: NavRoot[]; slides: HeroSlide[]; lang: Lang }) {
  const pathname = usePathname();
  const [view, setView] = useState<View | null>(null);
  const [shownFor, setShownFor] = useState(pathname);
  /* `tab` and `openGroup` lived here to remember which aisle the MENU had
     open and which of its groups was expanded. The menu carries the pages
     now and the search screen lists the roots flat, so there is nothing
     left to remember -- and state nothing reads is state that goes
     quietly wrong. */

  // Navigating closes whatever is open, including on the back button. Done
  // during render rather than in an effect, so the panel never paints over
  // the page it just opened for a frame.
  if (pathname !== shownFor) {
    setShownFor(pathname);
    setView(null);
  }

  /* The search screen has no chosen aisle to draw from, so it takes one
   * product from each in turn -- a spread of the shop rather than four of
   * whatever happens to be first. Deduplicated, because a product filed
   * under Women is also under Sapatu. */
  const mixed: NavProduct[] = [];
  const seen = new Set<string>();
  for (let rank = 0; mixed.length < SHOWCASE && rank < SHOWCASE; rank++) {
    for (const r of roots) {
      const p = r.feature[rank];
      if (!p || seen.has(p.id) || mixed.length >= SHOWCASE) continue;
      seen.add(p.id);
      mixed.push(p);
    }
  }

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

  if (isNavFree(pathname)) return null;

  return (
    <>
      <button type="button" className="hd-mob" aria-label={t("navMenu", lang)}
        aria-expanded={view === "menu"} onClick={() => setView("menu")}>
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

          <div className="msheet-body">
            {/* THE PAGES. Each row is a real destination with the drawing
                that means it -- at this size an icon is read before the
                word is, which is the whole reason to spend the space on
                one. */}
            <nav className="mpages" aria-label={t("navMenu", lang)}>
              {PAGES.map((row) => (
                <PageLink key={row.href} row={row} lang={lang}
                  here={pathname === row.href} onGo={() => setView(null)} />
              ))}
            </nav>

            {/* Below the rule: the two the bottom bar has no room for.
                Quieter, because they are somewhere you go once you have
                already done something rather than while you are looking. */}
            <nav className="mpages mpages-more" aria-label={t("navMore", lang)}>
              {EXTRAS.map((row) => (
                <PageLink key={row.href} row={row} lang={lang}
                  here={pathname === row.href} onGo={() => setView(null)} />
              ))}
            </nav>
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
              its banners and its stock, which are a real answer to "what is
              in here" while the field is still empty. */}
          <div className="msheet-body">
            {roots.length > 0 && (
              <>
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
              </>
            )}
            <SlideStrip slides={slides} onPick={() => setView(null)} />
            {mixed.length > 0 && (
              <>
                <p className="msheet-hd">{t("newArrivals", lang)}</p>
                <Showcase items={mixed} onPick={() => setView(null)} />
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
