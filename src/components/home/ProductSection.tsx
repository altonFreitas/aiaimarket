import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import type { Lang, Product } from "@/lib/types";

/** Reusable homepage section: a heading, an optional subtitle, a product
 * grid (reusing the same ProductCard and .grid used on /shop and /c/[slug]
 * — same responsive breakpoints, same "Add to list" button, same link to
 * the product page), and a "view all" link. Used for New Arrivals, each
 * category spotlight, and Best Sellers. */
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
  if (!products.length) return null;
  return (
    <section id={id} className="home-section">
      <div className="home-section-hd">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="home-section-sub">{subtitle}</p>}
        </div>
        <Link className="home-section-more" href={viewAllHref}>{viewAllLabel} →</Link>
      </div>
      <div className="grid">
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
