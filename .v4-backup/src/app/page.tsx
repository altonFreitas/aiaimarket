import Hero from "@/components/home/Hero";
import ProductSection from "@/components/home/ProductSection";
import Sidebar from "@/components/Sidebar";
import CatRail from "@/components/CatRail";
import { getCategories, getLiveProducts, getSettings, getBestSellingProducts, getHeroSlides, getApprovedSellersById } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import type { Category, Product } from "@/lib/types";

const SECTION_SIZE = 6;
const MAX_CATEGORY_SECTIONS = 3;

/** Same "category + its children" product filter used by /c/[slug] —
 * kept in sync deliberately rather than sharing a helper, since this one
 * additionally caps the result and the /c/[slug] one doesn't. */
function productsInCategory(cat: Category, cats: Category[], products: Product[]): Product[] {
  const ids = [cat.id, ...cats.filter((c) => c.parent_id === cat.id).map((c) => c.id)];
  return products.filter((p) => ids.includes(p.category_id || ""));
}

export default async function HomePage() {
  const [lang, settings, cats, products, bestSellers, heroSlides, sellersById] = await Promise.all([
    getLang(), getSettings(), getCategories(), getLiveProducts(), getBestSellingProducts(SECTION_SIZE), getHeroSlides(), getApprovedSellersById(),
  ]);

  const newArrivals = products.slice(0, SECTION_SIZE); // getLiveProducts() is already newest-first

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
    <div className="wrap">
      <div className="cols">
        <Sidebar cats={cats} products={products} lang={lang} />
        <div className="home">
          <CatRail cats={cats} products={products} lang={lang} />
          <Hero lang={lang} settings={settings} slides={heroSlides} />

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
    </div>
  );
}
