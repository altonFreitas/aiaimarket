"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product } from "@/lib/types";

function count(cats: Category[], products: Product[], id: string): number {
  const ids = [id, ...cats.filter((c) => c.parent_id === id).map((c) => c.id)];
  return products.filter((p) => ids.includes(p.category_id || "")).length;
}

export default function Sidebar({
  cats, products, activeSlug, lang,
}: { cats: Category[]; products: Product[]; activeSlug?: string; lang: Lang }) {
  const [openCat, setOpenCat] = useState<Category | null>(null);
  const roots = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);

  function kidsOf(c: Category) {
    return cats
      .filter((k) => k.parent_id === c.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((k) => count(cats, products, k.id) > 0);
  }

  // Esc closes the flyout, same as any other overlay in the app.
  useEffect(() => {
    if (!openCat) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenCat(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCat]);

  return (
    <>
      <nav className="panel side" aria-label={t("categories", lang)}>
        <h3 style={{ margin: "0 0 6px" }}>{t("categories", lang)}</h3>
        <ul className="side-list">
          <li>
            <Link href="/" aria-current={!activeSlug}>
              <span>{t("all", lang)}</span>
              <span className="n">{products.length}</span>
            </Link>
          </li>
          {roots.map((c) => {
            const n = count(cats, products, c.id);
            if (!n) return null;
            const kids = kidsOf(c);
            const isActive = activeSlug === c.slug || kids.some((k) => k.slug === activeSlug);
            // Categories with subcategories open the flyout (like the
            // reference site); categories with none just link straight
            // to their page — a flyout with nothing in it isn't useful.
            return (
              <li key={c.id}>
                {kids.length > 0 ? (
                  <button type="button" className="side-cat-btn" aria-current={isActive}
                    onClick={() => setOpenCat(c)}>
                    <span>{c.name}</span>
                    <span className="n">{n}</span>
                  </button>
                ) : (
                  <Link href={`/c/${c.slug}`} aria-current={activeSlug === c.slug}>
                    <span>{c.name}</span>
                    <span className="n">{n}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {openCat && (
        <div className="scrim" onClick={() => setOpenCat(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={openCat.name}
            onClick={(e) => e.stopPropagation()}>
            <div className="grip" />
            <div className="sheet-hd">
              <h3>{openCat.name}</h3>
              <button type="button" className="x" onClick={() => setOpenCat(null)} aria-label={t("close", lang)}>
                ×
              </button>
            </div>
            <ul className="side-list">
              <li>
                <Link href={`/c/${openCat.slug}`} onClick={() => setOpenCat(null)}>
                  <span><b>{t("all", lang)} — {openCat.name}</b></span>
                  <span className="n">{count(cats, products, openCat.id)}</span>
                </Link>
              </li>
              {kidsOf(openCat).map((k) => (
                <li key={k.id}>
                  <Link href={`/c/${k.slug}`} onClick={() => setOpenCat(null)}>
                    <span>{k.name}</span>
                    <span className="n">{count(cats, products, k.id)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
