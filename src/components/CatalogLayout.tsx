import Link from "next/link";
import CatalogHeader from "./shop/CatalogHeader";
import FilterRail from "./shop/FilterRail";
import ShopBar from "./shop/ShopBar";
import Pagination from "./Pagination";
import ProductCard from "./ProductCard";
import { getApprovedSellersById } from "@/lib/data/public";
import { cardFactsFor } from "@/lib/data/cardFacts";
import { isNewProduct } from "@/lib/cardBadges";
import { t } from "@/lib/i18n";
import type { CatalogResult } from "@/lib/data/search";
import type { Category, Lang, Product, Settings } from "@/lib/types";
import type { CatalogFilter } from "@/lib/data/attributeFilters";
import type { AttributeFilters as Filters } from "@/lib/attributeFilterParams";

/** Shared shell for every catalog view (/shop, /c/[slug], /search).
 *
 * THE SHAPE CHANGED; THE QUERIES DID NOT. What used to be a 246px column
 * of category names down the left, a filter panel beneath it, and a bar of
 * sort-plus-price-plus-in-stock above the grid is now: aisles as cards
 * across the top, ONE filter rail holding everything a shopper can narrow
 * by, and a bar that answers how many and in what order. Same searches,
 * same pagination, same links.
 *
 * `allProducts` and `result` are deliberately different things and come
 * from different queries:
 *
 *   allProducts — the cached full catalog, used ONLY by the aisle cards
 *                 and the rail's category counts. It is one shared,
 *                 cross-request-cached read, not a per-visitor scan.
 *   result      — one page of matches from search_products(), which is
 *                 what the grid renders. This is the part that used to
 *                 grow with the catalog and no longer does.
 */
export default async function CatalogLayout({
  title, sub, kicker, cats, allProducts, result, activeSlug, lang, basePath, params,
  showRelevance = false, attributeFilters = [], activeFilters = {},
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** The small line over the headline; only the full catalogue has one. */
  kicker?: string;
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
   * its product types ask for. Empty until the taxonomy is in use, and
   * those groups simply do not appear. */
  attributeFilters?: CatalogFilter[];
  /** Which of those are on right now. */
  activeFilters?: Filters;
  showRelevance?: boolean;
}) {
  const sellersById = await getApprovedSellersById();
  /* ONE READ FOR THE PAGE'S COLOURS AND SIZES, not one per card --
     see lib/data/cardFacts.ts. */
  const facts = await cardFactsFor(result.products);
  /* The clock, asked once on the server. ProductCard is a client
     component; working NEW out inside it would ask the clock on both
     sides of the boundary and mismatch across a day change. */
  const now = new Date();

  const onCount =
    Object.values(activeFilters).reduce((n, v) => n + v.length, 0)
    + (params.in === "1" ? 1 : 0) + (params.min ? 1 : 0) + (params.max ? 1 : 0);

  return (
    <div className="wrap shop">
      {/* What the rail's close link returns to -- see .frail. */}
      <span id="shop-top" />
      <CatalogHeader
        kicker={kicker} title={title} sub={sub}
        cats={cats} products={allProducts} activeSlug={activeSlug} lang={lang} />

      <div className="shop-cols">
        <FilterRail
          filters={attributeFilters} active={activeFilters}
          basePath={basePath} params={params}
          cats={cats} products={allProducts} activeSlug={activeSlug} lang={lang} />

        <div className="shop-main">
          <ShopBar count={result.total} countCapped={result.totalCapped}
            lang={lang} showRelevance={showRelevance} activeFilters={onCount} />

          {result.products.length ? (
            <>
              <div className="grid">
                {result.products.map((p) => (
                  <ProductCard key={p.id} p={p} lang={lang}
                    sellerName={sellersById[p.seller_id]?.store_name}
                    facts={facts.get(p.id)}
                    isNew={isNewProduct(p.created_at, now)} />
                ))}
              </div>
              <Pagination
                page={result.page} pageCount={result.pageCount}
                basePath={basePath} params={params} lang={lang}
              />
            </>
          ) : (
            /* TWO WAYS OUT, because there are two reasons to be here.
               A filter that matched nothing is undone by clearing it; a
               catalogue that genuinely holds nothing like this is left by
               going back to all of it. Offering only the second told a
               shopper who had ticked three boxes to start again. */
            <div className="empty">
              <p>{t("noResults", lang)}</p>
              <div className="empty-actions">
                {onCount > 0 && (
                  <Link className="btn btn-sm" href={basePath}>
                    {t("clearFilters", lang)}
                  </Link>
                )}
                <Link className="btn btn-sm btn-ghost" href="/shop">
                  {t("shopEverything", lang)}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
