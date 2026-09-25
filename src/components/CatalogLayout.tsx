import Link from "next/link";
import Sidebar from "./Sidebar";
import CatRail from "./CatRail";
import Toolbar from "./Toolbar";
import Pagination from "./Pagination";
import ProductCard from "./ProductCard";
import { getApprovedSellersById } from "@/lib/data/public";
import { t } from "@/lib/i18n";
import type { CatalogResult } from "@/lib/data/search";
import type { Category, Lang, Product, Settings } from "@/lib/types";
import AttributeFilters from "./AttributeFilters";
import type { CatalogFilter } from "@/lib/data/attributeFilters";
import type { AttributeFilters as Filters } from "@/lib/attributeFilterParams";

/** Shared shell for every catalog view (/shop, /c/[slug], /search).
 *
 * `allProducts` and `result` are deliberately different things and come from
 * different queries:
 *
 *   allProducts — the cached full catalog, used ONLY by the category nav,
 *                 which shows a live product count per category and a hover
 *                 preview. It is one shared, cross-request-cached read, not
 *                 a per-visitor scan.
 *   result      — one page of matches from search_products(), which is what
 *                 the grid renders. This is the part that used to grow with
 *                 the catalog and no longer does.
 */
export default async function CatalogLayout({
  title, sub, cats, allProducts, result, activeSlug, lang, basePath, params, showRelevance = false,
  attributeFilters = [], activeFilters = {},
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  cats: Category[];
  allProducts: Product[];
  result: CatalogResult;
  activeSlug?: string;
  lang: Lang;
  settings: Settings;
  /** Path the pagination links are built from, e.g. "/c/eletronika". */
  basePath: string;
  /** Active filters, preserved by the pagination links. */
  params: Record<string, string | undefined>;
  /** What this catalogue can be filtered by, generated from the attributes
   * its product types ask for. Empty until the taxonomy is in use, and the
   * panel simply does not appear. */
  attributeFilters?: CatalogFilter[];
  /** Which of those are on right now. */
  activeFilters?: Filters;
  showRelevance?: boolean;
}) {
  const sellersById = await getApprovedSellersById();
  return (
    <div className="wrap wrap-rail">
      <div className="cols">
        <div className="cat-side">
          <Sidebar cats={cats} products={allProducts} activeSlug={activeSlug} lang={lang} />
          {/* Under the categories, because a shopper picks WHAT before
              they narrow it. Generated -- see components/AttributeFilters. */}
          <AttributeFilters
            filters={attributeFilters} active={activeFilters}
            basePath={basePath} params={params} lang={lang} />
        </div>
        <div>
          <h1>{title}</h1>
          {sub}
          <CatRail cats={cats} products={allProducts} activeSlug={activeSlug} lang={lang} />
          <Toolbar count={result.total} lang={lang} showRelevance={showRelevance} />
          {result.products.length ? (
            <>
              <div className="grid">
                {result.products.map((p) => (
                  <ProductCard key={p.id} p={p} lang={lang} sellerName={sellersById[p.seller_id]?.store_name} />
                ))}
              </div>
              <Pagination
                page={result.page} pageCount={result.pageCount}
                basePath={basePath} params={params} lang={lang}
              />
            </>
          ) : (
            <div className="empty">
              <p>{t("noResults", lang)}</p>
              <Link className="btn btn-ghost" href="/">
                {t("browse", lang)}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
