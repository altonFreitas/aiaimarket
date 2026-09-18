"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { placeholder } from "@/lib/placeholder";
import {discountPercent} from "@/lib/utils";
import { useMoney } from "@/components/Currency";
import { t } from "@/lib/i18n";
import { isNavFree, type NavRoot } from "@/lib/nav";
import type { Lang } from "@/lib/types";

/** How long the panel stays open after the pointer leaves it. Without this
 * grace period the menu closes the instant the cursor crosses the gap
 * between the bar and the panel below it -- the classic diagonal-travel
 * problem, and the reason so many hover menus feel broken. Same value the
 * category sidebar uses. */
const CLOSE_DELAY_MS = 180;

/** The main navigation: a bar of top-level entries, each opening a panel of
 * categories, each category revealing its subcategories.
 *
 * DESKTOP ONLY. A phone gets MobileNav instead -- a menu button opening a
 * full screen -- because six category names do not fit across 390px and a
 * row that scrolls sideways hides whatever is past its right edge. This bar
 * is display:none below 768px; the two share the same nav model from
 * lib/nav.ts, so they can never disagree about what the shop sells.
 *
 * EVERY ENTRY IS ALSO A LINK. The bar's buttons open the panel; the panel's
 * first row is always "Shop all <entry>", and every category and
 * subcategory in it is a plain link to that page. A menu that can only be
 * operated by hovering is a menu that a phone, a keyboard and a search
 * engine cannot use. */
export default function MegaNav({ roots, lang }: { roots: NavRoot[]; lang: Lang }) {
  const m = useMoney();
  const pathname = usePathname();
  const [openId, setOpenId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState(pathname);
  const [hoverable, setHoverable] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A menu left standing over the page it just opened is the single most
  // common bug in this pattern -- and it happens on the back button too,
  // not only on a click the menu could have handled itself. Adjusted
  // during render rather than in an effect: React re-runs this component
  // immediately with the corrected state, so the open panel never paints
  // over the new page for a frame the way an effect would let it.
  if (pathname !== shownFor) {
    setShownFor(pathname);
    setOpenId(null);
  }

  const open = roots.find((r) => r.id === openId) || null;
  const group = open?.groups.find((g) => g.id === groupId) || null;

  function cancelClose() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }
  function show(id: string) {
    cancelClose();
    setOpenId(id);
    // Open on the first category, so the subcategory column is never an
    // empty panel waiting to be pointed at.
    setGroupId(roots.find((r) => r.id === id)?.groups[0]?.id ?? null);
  }
  function close() { cancelClose(); setOpenId(null); }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenId(null), CLOSE_DELAY_MS);
  }

  /* IS THERE A POINTER TO HOVER WITH AT ALL.
   *
   * Not a nicety -- without it the menu is unusable on a phone. A tap
   * fires the whole compatibility mouse sequence, pointerenter included,
   * so "open on enter, toggle on click" opened the panel and then shut it
   * again on the same tap. Guarding on the event's own pointerType does not
   * help: the synthesized events claim to be a mouse.
   *
   * So hovering is wired up only where the device actually has a fine
   * pointer, which is the same test the stylesheet uses for the card's
   * hover-revealed button. Everywhere else, tapping is the only way in and
   * the click handler is the only thing listening. It starts false so the
   * server and the browser render the same markup, and the media query
   * settles it after hydration. */
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setHoverable(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Esc closes, same as every other overlay in the app.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  // Never leave a timer running past unmount.
  useEffect(() => cancelClose, []);

  if (isNavFree(pathname)) return null;

  /* THE BAR IS ALWAYS DRAWN on the storefront, even for a shop with nothing in it yet -- it
   * still has "Shop all" in it, and its height is part of the sticky chrome
   * every other pinned row parks below (--nav-h in globals.css). Returning
   * null on an empty catalogue would leave that 44px reserved and empty,
   * with the page scrolling through the gap under the search bar. */
  return (
    // Closing on leaving is a hover gesture, so it exists only where hover
    // does. On touch the scrim, Escape and navigating away close the panel.
    <nav className="mainnav" aria-label={t("categories", lang)}
      onPointerLeave={() => { if (hoverable) scheduleClose(); }}>
      <div className="mainnav-in">
        <div className="mainnav-row">
          {roots.map((r) => (
            <button
              key={r.id} type="button"
              className={"mainnav-item" + (openId === r.id ? " is-on" : "")}
              aria-expanded={openId === r.id}
              aria-controls="mega-panel"
              onPointerEnter={() => { if (hoverable) show(r.id); }}
              // KEYBOARD focus opens it; a tap must not. Pressing a button
              // focuses it, so a plain onFocus opened the panel on
              // pointerdown and the click that followed closed it again --
              // the menu could not be opened by tapping at all. :focus-visible
              // is exactly the distinction the browser already draws.
              onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) show(r.id); }}
              onClick={() => (openId === r.id ? close() : show(r.id))}
            >
              {r.label}
            </button>
          ))}
          <Link className="mainnav-item mainnav-all" href="/shop"
            onMouseEnter={close} onFocus={close}>
            {t("navShopAll", lang)}
          </Link>
        </div>

      </div>

      {open && (
        <>
          {/* The page behind the menu, pushed back. Gymshark's trick and a
              good one: dimming and blurring what is not being chosen from
              makes a wide panel readable over a busy catalogue without
              needing an opaque sheet across the whole window. */}
          <div className="mega-scrim" onClick={close} aria-hidden="true"
            onPointerEnter={() => { if (hoverable) scheduleClose(); }} />

          <div className="mega" id="mega-panel" onPointerEnter={cancelClose}>
            <div className="mega-in">
              <div className="mega-col mega-col-groups">
                <Link className="mega-all" href={open.href} onClick={close}>
                  {t("navShopAllOf", lang)} {open.label}
                  <span aria-hidden="true"> →</span>
                </Link>
                <ul className="mega-groups">
                  {open.groups.map((g) => (
                    <li key={g.id} className={groupId === g.id ? "is-on" : ""}
                      onPointerEnter={() => { if (hoverable) setGroupId(g.id); }}>
                      <Link className="mega-group" href={g.href} onClick={close}>
                        <span>{g.label}</span>
                        <span className="n">{g.count}</span>
                      </Link>
                      {g.children.length > 0 && (
                        <>
                          {/* Touch has no hover, so the chevron is the
                              control that opens a category on a phone. It is
                              a button, not a link: it reveals, it does not
                              navigate -- the row beside it already does. */}
                          <button type="button" className="mega-exp"
                            aria-expanded={groupId === g.id} aria-label={g.label}
                            onClick={() => setGroupId(groupId === g.id ? null : g.id)}>
                            <span aria-hidden="true">›</span>
                          </button>
                          {groupId === g.id && (
                            <ul className="mega-kids-inline">
                              {g.children.map((k) => (
                                <li key={k.href}>
                                  <Link href={k.href} onClick={close}>
                                    <span>{k.label}</span>
                                    <span className="n">{k.count}</span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                  {!open.groups.length && (
                    <li className="mega-empty">{t("navNoSubcategories", lang)}</li>
                  )}
                </ul>
              </div>

              {/* Column two: the pointed-at category's subcategories. Desktop
                  only -- on a phone the same links are the accordion above,
                  which is why this is hidden rather than duplicated in
                  state. */}
              <div className="mega-col mega-col-kids">
                {group && group.children.length > 0 && (
                  <>
                    <p className="mega-kids-hd">{group.label}</p>
                    <ul className="mega-kids">
                      {group.children.map((k) => (
                        <li key={k.href}>
                          <Link href={k.href} onClick={close}>
                            <span>{k.label}</span>
                            <span className="n">{k.count}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {/* Column three: real stock from this entry. It carries the
                  panel on a flat catalogue that has no subcategories yet,
                  and stays worth its space once there are some -- seeing
                  four products beats reading four more names. */}
              {open.feature.length > 0 && (
                <div className="mega-col mega-col-feature">
                  {open.feature.map((p) => {
                    const img = p.image || placeholder(p.name);
                    const pct = discountPercent(p.price, p.discount);
                    return (
                      <Link key={p.id} href={`/p/${p.slug}`} className="mega-card" onClick={close}>
                        <Image src={img} alt="" width={120} height={120} sizes="120px"
                          unoptimized={img.startsWith("data:")} />
                        <span className="mega-card-nm">{p.name}</span>
                        <span className="mega-card-pr">
                          {m(p.discount ?? p.price)}
                          {pct != null && <b> -{pct}%</b>}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
