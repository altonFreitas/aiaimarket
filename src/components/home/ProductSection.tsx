"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import { t } from "@/lib/i18n";
import type { Lang, Product } from "@/lib/types";

/** Homepage row: a heading, a "view all" link, and the products themselves
 * as a rail that scrolls sideways rather than a grid that grows downwards.
 *
 * WHY A RAIL AND NOT A GRID. A homepage is a set of invitations, not a
 * catalogue -- the catalogue is one click away at /shop, where the grid,
 * the filters and the pagination live. Six sections stacked as grids push
 * everything below the first one off the screen; six sections as rails fit
 * in a scroll, and each one keeps its own place in the row when you come
 * back to it. On a phone this is also the gesture people already use.
 *
 * The cards are the same ProductCard the catalogue uses -- same photo
 * sizes, same stock badge, same "add to cart" -- so nothing about a product
 * looks different here than where it is bought. */
export default function ProductSection({
  id, title, subtitle, products, viewAllHref, viewAllLabel, lang, badgeLabel, badgeForIds, sellersById,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  products: Product[];
  viewAllHref: string;
  viewAllLabel: string;
  lang: Lang;
  /** Small label shown on cards in `badgeForIds`, e.g. "BEST SELLER". */
  badgeLabel?: string;
  badgeForIds?: Set<string>;
  sellersById?: Record<string, { store_name: string }>;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  /** Which arrows are usable, read from the element rather than counted
   * from the product list: how many cards fit depends on the window, and
   * only the browser knows that. The 4px tolerance absorbs the sub-pixel
   * scroll positions that smooth scrolling leaves behind, which otherwise
   * leave the "next" arrow live at the end of the row forever. */
  const sync = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    // The row reflows on rotation and on a desktop resize, and the arrows
    // have to follow -- a ResizeObserver rather than a window listener
    // because the rail also changes width when the sidebar-less homepage
    // lays out at a new breakpoint.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", sync); ro.disconnect(); };
  }, [sync, products.length]);

  function page(direction: 1 | -1) {
    const el = rail.current;
    if (!el) return;
    // Just under a full width, so the card at the edge stays half-visible
    // and the row reads as continuing rather than as jumping.
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.9), behavior: "smooth" });
  }

  if (!products.length) return null;

  return (
    <section id={id} className="home-section">
      <div className="home-section-hd">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="home-section-sub">{subtitle}</p>}
        </div>
        <div className="home-section-acts">
          <Link className="home-section-more" href={viewAllHref}>{viewAllLabel} →</Link>
          {(canPrev || canNext) && (
            <div className="rail-arrows">
              <button type="button" className="rail-arrow" onClick={() => page(-1)}
                disabled={!canPrev} aria-label={t("railPrev", lang)}>‹</button>
              <button type="button" className="rail-arrow" onClick={() => page(1)}
                disabled={!canNext} aria-label={t("railNext", lang)}>›</button>
            </div>
          )}
        </div>
      </div>

      <div className="rail" ref={rail}>
        {products.map((p) => (
          <div key={p.id} className="home-card-wrap">
            {badgeLabel && badgeForIds?.has(p.id) && <span className="seller-badge">{badgeLabel}</span>}
            <ProductCard p={p} lang={lang} sellerName={sellersById?.[p.seller_id]?.store_name} />
          </div>
        ))}
      </div>

      <Link className="btn btn-ghost home-section-more-mobile" href={viewAllHref}>{viewAllLabel}</Link>
    </section>
  );
}
