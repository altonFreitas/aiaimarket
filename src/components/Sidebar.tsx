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
  const roots = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);

  return (
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
          const kids = cats
            .filter((k) => k.parent_id === c.id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .filter((k) => count(cats, products, k.id) > 0);
          return (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} aria-current={activeSlug === c.slug}>
                <span>{c.name}</span>
                <span className="n">{n}</span>
              </Link>
              {kids.length > 0 && (
                <ul className="side-list sub-cat" style={{ listStyle: "none", padding: 0, margin: "2px 0 0" }}>
                  {kids.map((k) => (
                    <li key={k.id}>
                      <Link href={`/c/${k.slug}`} aria-current={activeSlug === k.slug}>
                        <span>{k.name}</span>
                        <span className="n">{count(cats, products, k.id)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
