"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import type { NavRoot } from "@/lib/nav";

/* THE NAV ACROSS THE MIDDLE OF THE HEADER.
 *
 * Home, Shop, Categories, About, Contact -- the reference's row, with two
 * of them opening a menu.
 *
 * TWO MENUS THAT SAY DIFFERENT THINGS. The reference draws a caret on both
 * Shop and Categories, and the obvious reading -- a list of aisles under
 * each -- would be the same list twice, three inches apart. So Shop opens
 * WAYS INTO the catalogue (all of it, newest, best rated, in stock) and
 * Categories opens the TREE. Every entry under Shop is a real state of
 * /shop that its own toolbar can already produce, so none of them is a
 * link to something that has to be built.
 *
 * OPENS ON HOVER AND ON CLICK, closes on Escape, on a click outside and on
 * navigating. Hover alone would be unreachable by keyboard and unusable on
 * a touch screen that reports itself as a mouse; click alone would feel
 * broken next to every other shop's header.
 *
 * Hidden below 1024px, where MobileNav's sheet carries the same links with
 * room to spell them out -- see globals.css.
 */
type Menu = "shop" | "cats" | null;

export default function HeaderNav({
  roots, lang,
}: {
  roots: NavRoot[];
  lang: Lang;
}) {
  const [open, setOpen] = useState<Menu>(null);
  /* WHETHER THE MENU IS HELD OPEN, or merely hovered.
   *
   * THE BUG THIS FIXES, found by clicking it in a browser: hover opened
   * the menu and the click then TOGGLED it -- so by the time the press
   * landed, `open` was already this menu and the click closed it. A
   * pointer user could not open a menu by clicking the thing that opens
   * it, which is the one gesture everybody tries first.
   *
   * So a click PINS instead of toggling: hover opens it loosely and
   * moving away closes it again, a click holds it open until Escape, a
   * click outside, a second click, or navigating. That is what every
   * mega-menu does, and it is also what makes the keyboard path work --
   * Enter on the button pins it rather than opening and closing it in
   * one event. */
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLElement>(null);
  const pathname = usePathname();

  function close() { setOpen(null); setPinned(false); }
  function hoverOpen(m: Menu) { if (!pinned) setOpen(m); }
  function hoverOut() { if (!pinned) setOpen(null); }
  function press(m: Menu) {
    if (open === m && pinned) close();
    else { setOpen(m); setPinned(true); }
  }

  /* NAVIGATING CLOSES IT. Without this the menu stays open over the page
     it just opened, which reads as a menu that failed to respond.
     Adjusted DURING RENDER rather than in an effect -- React's own answer
     to "reset state when something changes", and the same thing
     SearchBar does two files away. In an effect it is a cascading render
     React rightly complains about: one frame with the menu still open
     over the new page, then a correction. */
  const [shownFor, setShownFor] = useState(pathname);
  if (pathname !== shownFor) {
    setShownFor(pathname);
    setOpen(null);
    setPinned(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }
    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const here = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  /* Real states of /shop, every one of them something its toolbar can
     already produce -- see components/Toolbar.tsx. A menu entry that
     needs a feature built is a menu entry that 404s until it is. */
  const shopLinks = [
    { href: "/shop", label: t("navShopAll", lang) },
    { href: "/shop?sort=new", label: t("sortNew", lang) },
    { href: "/shop?sort=rating", label: t("sortRating", lang) },
    { href: "/shop?in=1", label: t("onlyIn", lang) },
  ];

  return (
    <nav className="hd-nav" ref={wrap} aria-label={t("navCategories", lang)}>
      <Link className={"hd-nav-a" + (pathname === "/" ? " is-here" : "")} href="/">
        {t("navHome", lang)}
      </Link>

      <div className="hd-drop"
        onMouseEnter={() => hoverOpen("shop")} onMouseLeave={hoverOut}>
        <button type="button" className={"hd-nav-a" + (here("/shop") ? " is-here" : "")}
          aria-expanded={open === "shop"} aria-haspopup="true"
          onClick={() => press("shop")}>
          {t("navShop", lang)}<Caret />
        </button>
        {open === "shop" && (
          <div className="hd-menu">
            {shopLinks.map((l) => (
              <Link key={l.href} href={l.href}>{l.label}</Link>
            ))}
          </div>
        )}
      </div>

      <div className="hd-drop"
        onMouseEnter={() => hoverOpen("cats")} onMouseLeave={hoverOut}>
        <button type="button" className={"hd-nav-a" + (here("/c") ? " is-here" : "")}
          aria-expanded={open === "cats"} aria-haspopup="true"
          onClick={() => press("cats")}>
          {t("navCategories", lang)}<Caret />
        </button>
        {open === "cats" && (
          <div className="hd-menu hd-menu-wide">
            {/* THE TREE, TWO LEVELS. buildNav has already dropped every
                root with no stock behind it, counting subcategories -- a
                door onto an empty shelf is worse than no door. */}
            {roots.length === 0 ? (
              <Link href="/shop">{t("navShopAll", lang)}</Link>
            ) : roots.map((r) => (
              <div key={r.id} className="hd-menu-col">
                <Link className="hd-menu-head" href={r.href}>
                  {r.label}<em>{r.count}</em>
                </Link>
                {r.groups.slice(0, 6).map((g) => (
                  <Link key={g.id} href={g.href}>{g.label}</Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <Link className={"hd-nav-a" + (here("/about") ? " is-here" : "")} href="/about">
        {t("navAbout", lang)}
      </Link>
      <Link className={"hd-nav-a" + (here("/contact") ? " is-here" : "")} href="/contact">
        {t("navContact", lang)}
      </Link>
    </nav>
  );
}

function Caret() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
