import Hero from "@/components/home/Hero";
import ProductSection from "@/components/home/ProductSection";
import AudienceTiles from "@/components/home/AudienceTiles";
import PromoStrip from "@/components/home/PromoStrip";
import { getCategories, getLiveProducts, getSettings, getBestSellingProducts, getHeroSlides, getPromotions, getApprovedSellersById } from "@/lib/data/public";
import { audienceHighlights } from "@/lib/nav";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import type { Category, Product } from "@/lib/types";

const SECTION_SIZE = 12;
const MAX_CATEGORY_SECTIONS = 3;

/** Same "category + its children" product filter used by /c/[slug] —
 * kept in sync deliberately rather than sharing a helper, since this one
 * additionally caps the result and the /c/[slug] one doesn't. */
function productsInCategory(cat: Category, cats: Category[], products: Product[]): Product[] {
  const ids = [cat.id, ...cats.filter((c) => c.parent_id === cat.id).map((c) => c.id)];
  return products.filter((p) => ids.includes(p.category_id || ""));
}

/** The homepage.
 *
 * NO CATEGORY SIDEBAR HERE ANY MORE, ON PURPOSE. The categories moved into
 * the navigation bar in the header (see MegaNav), where they open into
 * their subcategories and are reachable from every page in the shop rather
 * than only from this one. That frees the homepage to do the job a
 * storefront's front page actually does: one full-width piece of
 * merchandising at the top, then rows of real stock underneath. The
 * catalogue -- grid, filters, sort, pagination, and the sidebar -- is still
 * exactly where it was, at /shop and /c/[slug].
 *
 * Every row below is real: newest first from the catalogue, the categories
 * the shop actually has stock in, and best sellers counted from completed
 * orders. Nothing here invents a section to fill space, which is why each
 * one renders nothing at all when it has nothing to show. */
export default async function HomePage() {
  const [lang, settings, cats, products, bestSellers, heroSlides, promotions, sellersById] = await Promise.all([
    getLang(), getSettings(), getCategories(), getLiveProducts(), getBestSellingProducts(SECTION_SIZE), getHeroSlides(), getPromotions(), getApprovedSellersById(),
  ]);

  const newArrivals = products.slice(0, SECTION_SIZE); // getLiveProducts() is already newest-first

  // Women / Men, but only once the shop has said who its products are for.
  // Same rule as the navigation bar -- see lib/nav.ts.
  const audiences = audienceHighlights(cats, products, lang);

  // Homepage category spotlights: real top-level categories with actual
  // stock, not a hardcoded Men's/Women's/Accessories list — the store's
  // categories are whatever the admin has set up (see CategoriesAdmin),
  // so the homepage follows that rather than assuming a fixed set.
  const topCategories = cats
    .filter((c) => !c.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const categorySections = topCategories
    .map((cat) => ({ cat, items: productsInCategory(cat, cats, products).slice(0, SECTION_SIZE) }))
    .filter((s) => s.items.length > 0)
    .slice(0, MAX_CATEGORY_SECTIONS);

  return (
    <div className="home">
      {/* Full-bleed, edge to edge: the hero is the only thing on this page
          that is allowed to ignore the content width. */}
      <Hero lang={lang} settings={settings} slides={heroSlides} />

      <div className="wrap home-body">
        <AudienceTiles roots={audiences} lang={lang} />
        <PromoStrip lang={lang} promotions={promotions} />

        <ProductSection
          id="new-arrivals"
          title={t("newArrivals", lang)}
          subtitle={t("newArrivalsSub", lang)}
          products={newArrivals}
          viewAllHref="/shop"
          viewAllLabel={t("viewAll", lang)}
          lang={lang}
          sellersById={sellersById}
        />

        {categorySections.map(({ cat, items }) => (
          <ProductSection
            key={cat.id}
            title={cat.name}
            subtitle={t("categoryPicks", lang)}
            products={items}
            viewAllHref={`/c/${cat.slug}`}
            viewAllLabel={t("viewAll", lang)}
            lang={lang}
            sellersById={sellersById}
          />
        ))}

        <ProductSection
          title={t("bestSellers", lang)}
          subtitle={t("bestSellersSub", lang)}
          products={bestSellers.products}
          viewAllHref="/shop"
          viewAllLabel={t("viewAllBestSellers", lang)}
          lang={lang}
          badgeLabel={t("bestSellerBadge", lang)}
          badgeForIds={bestSellers.confirmedIds}
          sellersById={sellersById}
        />
      </div>
    </div>
  );
}
