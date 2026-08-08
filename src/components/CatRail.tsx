import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product } from "@/lib/types";

function count(cats: Category[], products: Product[], id: string): number {
  const ids = [id, ...cats.filter((c) => c.parent_id === id).map((c) => c.id)];
  return products.filter((p) => ids.includes(p.category_id || "")).length;
}

export default function CatRail({
  cats, products, activeSlug, lang,
}: { cats: Category[]; products: Product[]; activeSlug?: string; lang: Lang }) {
  const roots = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="cat-rail" role="navigation" aria-label={t("categories", lang)}>
      <Link className="chip" href="/" aria-current={!activeSlug}>
        {t("all", lang)}
        <span className="n">{products.length}</span>
      </Link>
      {roots.map((c) => {
        const n = count(cats, products, c.id);
        if (!n) return null;
        const kids = cats.filter((k) => k.parent_id === c.id);
        return (
          <span key={c.id} style={{ display: "contents" }}>
            <Link className="chip" href={`/c/${c.slug}`} aria-current={activeSlug === c.slug}>
              {c.name}
              <span className="n">{n}</span>
            </Link>
            {kids.map((k) => {
              const m = count(cats, products, k.id);
              if (!m) return null;
              return (
                <Link key={k.id} className="chip" href={`/c/${k.slug}`} aria-current={activeSlug === k.slug}>
                  {c.name} › {k.name}
                  <span className="n">{m}</span>
                </Link>
              );
            })}
          </span>
        );
      })}
    </div>
  );
}
