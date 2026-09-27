import Link from "next/link";
import Image from "next/image";
import { placeholder } from "@/lib/placeholder";
import { countIn, descendantIds } from "@/lib/categoryTree";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product } from "@/lib/types";

/* THE TOP OF A CATALOGUE PAGE, on the reference's shape.
 *
 * A breadcrumb, a kicker, the headline, one line of description, and then
 * the aisles as cards rather than as a list down the left-hand side.
 *
 * THE AISLE CARDS ARE WHY THE SIDEBAR COULD GO. A column of category
 * names took 246px of every catalogue page for the whole session, to
 * answer a question -- "what else is there" -- that a shopper asks once,
 * at the start. Asking it here, across the top, gives the answer more
 * room and the products the width back.
 *
 * NOTHING HERE IS WRITTEN DOWN. The aisles are the shop's own root
 * categories, the counts are counted, and the picture on each card is the
 * first photograph in that aisle -- so a shop that renames an aisle or
 * adds one gets a correct card without anybody opening this file. An
 * aisle holding nothing is not drawn: a card promising 0 products is a
 * door onto an empty room.
 */

export default function CatalogHeader({
  kicker, title, sub, cats, products, activeSlug, lang,
}: {
  /** The small line above the headline. Only the full catalogue has one --
   * a category page's headline is already the name of the thing. */
  kicker?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  cats: Category[];
  products: Product[];
  activeSlug?: string;
  lang: Lang;
}) {
  const roots = cats
    .filter((c) => !c.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({ cat: c, n: countIn(cats, products, c.id) }))
    .filter((r) => r.n > 0);

  const active = activeSlug ? cats.find((c) => c.slug === activeSlug) : undefined;
  /* The trail to the open category, however deep it sits. The tree is
     three levels in places (Fitness -> Sports Nutrition -> Protein) and a
     breadcrumb that named only the last one would say where the shopper
     is without saying how they got there. */
  const trail: Category[] = [];
  for (let c = active; c; c = c.parent_id ? cats.find((k) => k.id === c!.parent_id) : undefined) {
    trail.unshift(c);
    if (trail.length > 6) break;
  }

  return (
    <header className="shop-hd">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">{t("home", lang)}</Link>
        <span aria-hidden="true">/</span>
        {trail.length ? (
          <>
            <Link href="/shop">{t("catalog", lang)}</Link>
            {trail.map((c, i) => (
              <span key={c.id} style={{ display: "contents" }}>
                <span aria-hidden="true">/</span>
                {i === trail.length - 1 ? (
                  <span aria-current="page">{c.name}</span>
                ) : (
                  <Link href={`/c/${c.slug}`}>{c.name}</Link>
                )}
              </span>
            ))}
          </>
        ) : (
          <span aria-current="page">{kicker ? t("catalog", lang) : title}</span>
        )}
      </nav>

      {kicker && <p className="shop-kicker">{kicker}</p>}
      <h1 className="shop-title">{title}</h1>
      {sub ? <div className="shop-sub">{sub}</div> : null}

      {roots.length > 0 && (
        <ul className="aisles" aria-label={t("categories", lang)}>
          {roots.map(({ cat, n }) => {
            const first = products.find(
              (p) => descendantIds(cats, cat.id).includes(p.category_id || "") && p.images?.[0]
            );
            const img = first?.images?.[0] || placeholder(cat.name);
            const on = activeSlug === cat.slug
              || trail.some((c) => c.slug === cat.slug);
            return (
              <li key={cat.id}>
                <Link className={"aisle" + (on ? " is-on" : "")} href={`/c/${cat.slug}`}
                  aria-current={on || undefined}>
                  <span className="aisle-ph">
                    <Image src={img} alt="" width={96} height={96} sizes="96px"
                      unoptimized={img.startsWith("data:")} />
                  </span>
                  <span className="aisle-txt">
                    <span className="aisle-nm">{cat.name}</span>
                    <span className="aisle-n">{t("productsFound", lang).replace("{n}", String(n))}</span>
                  </span>
                  <span className="aisle-go" aria-hidden="true">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </header>
  );
}
