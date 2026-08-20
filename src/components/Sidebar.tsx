"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { placeholder } from "@/lib/placeholder";
import { money, discountPercent } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product } from "@/lib/types";

/** How long the panel stays open after the pointer leaves. Without this
 * grace period the panel closes the instant the cursor crosses the gap
 * between the category row and the panel itself, which makes the menu feel
 * broken — the classic diagonal-travel problem with hover menus. */
const CLOSE_DELAY_MS = 180;
const PREVIEW_COUNT = 4;

function idsFor(cats: Category[], id: string): string[] {
  return [id, ...cats.filter((c) => c.parent_id === id).map((c) => c.id)];
}
function count(cats: Category[], products: Product[], id: string): number {
  const ids = idsFor(cats, id);
  return products.filter((p) => ids.includes(p.category_id || "")).length;
}

export default function Sidebar({
  cats, products, activeSlug, lang,
}: { cats: Category[]; products: Product[]; activeSlug?: string; lang: Lang }) {
  const [openCat, setOpenCat] = useState<Category | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roots = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);

  function kidsOf(c: Category) {
    return cats
      .filter((k) => k.parent_id === c.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((k) => count(cats, products, k.id) > 0);
  }

  function cancelClose() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }
  function open(c: Category) { cancelClose(); setOpenCat(c); }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenCat(null), CLOSE_DELAY_MS);
  }

  // Esc closes, same as any other overlay in the app.
  useEffect(() => {
    if (!openCat) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenCat(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCat]);

  // Never leave a timer running past unmount.
  useEffect(() => cancelClose, []);

  const kids = openCat ? kidsOf(openCat) : [];
  const preview = openCat
    ? products.filter((p) => idsFor(cats, openCat.id).includes(p.category_id || "")).slice(0, PREVIEW_COUNT)
    : [];

  return (
    <div className="side-wrap" onMouseLeave={scheduleClose}>
      <nav className="panel side" aria-label={t("categories", lang)}>
        <h3 className="side-hd">{t("categories", lang)}</h3>
        <ul className="side-list">
          <li onMouseEnter={() => setOpenCat(null)}>
            <Link href="/" aria-current={!activeSlug}>
              <span>{t("all", lang)}</span>
              <span className="n">{products.length}</span>
            </Link>
          </li>
          {roots.map((c) => {
            const n = count(cats, products, c.id);
            if (!n) return null;
            const isActive = activeSlug === c.slug || kidsOf(c).some((k) => k.slug === activeSlug);
            return (
              // The row is always a plain link to the category page — the
              // panel is an enhancement, never the only way in. Opening on
              // focus as well as hover keeps it reachable by keyboard,
              // which a hover-only menu never is.
              <li key={c.id}
                onMouseEnter={() => open(c)}
                onFocus={() => open(c)}>
                <Link href={`/c/${c.slug}`} aria-current={isActive}
                  aria-expanded={openCat?.id === c.id}>
                  <span>{c.name}</span>
                  <span className="n">{n}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {openCat && (
        <div className="side-mega" onMouseEnter={cancelClose} role="group" aria-label={openCat.name}>
          <div className="side-mega-hd">
            <Link href={`/c/${openCat.slug}`} onClick={() => setOpenCat(null)}>
              {openCat.name} <span aria-hidden="true">›</span>
            </Link>
            <span className="side-mega-n">{count(cats, products, openCat.id)}</span>
          </div>

          {kids.length > 0 && (
            <ul className="side-mega-cols">
              {kids.map((k) => (
                <li key={k.id}>
                  <Link href={`/c/${k.slug}`} onClick={() => setOpenCat(null)}>
                    {k.name} <span className="n">{count(cats, products, k.id)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Product preview. Carries the panel on a flat catalogue (no
              sub-levels yet), and stays useful once subcategories exist —
              seeing actual stock beats reading a list of names. */}
          {preview.length > 0 && (
            <div className="side-mega-prev">
              {preview.map((p) => {
                const img = p.images?.[0] || placeholder(p.name);
                const pct = discountPercent(p.price, p.discount_price);
                return (
                  <Link key={p.id} href={`/p/${p.slug}`} className="side-mega-card"
                    onClick={() => setOpenCat(null)}>
                    <Image src={img} alt="" width={96} height={96} sizes="96px"
                      unoptimized={img.startsWith("data:")} />
                    <span className="side-mega-card-nm">{p.name}</span>
                    <span className="side-mega-card-pr">
                      {money(p.discount_price ?? p.price)}
                      {pct != null && <b> -{pct}%</b>}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
