import Sidebar from "./Sidebar";
import CatRail from "./CatRail";
import Toolbar from "./Toolbar";
import ProductCard from "./ProductCard";
import Footer from "./Footer";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product, Settings } from "@/lib/types";

export default function CatalogLayout({
  title, sub, cats, allProducts, shown, activeSlug, lang, settings,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  cats: Category[];
  allProducts: Product[];
  shown: Product[];
  activeSlug?: string;
  lang: Lang;
  settings: Settings;
}) {
  return (
    <div className="wrap">
      <div className="cols">
        <Sidebar cats={cats} products={allProducts} activeSlug={activeSlug} lang={lang} />
        <div>
          <h1>{title}</h1>
          {sub}
          <CatRail cats={cats} products={allProducts} activeSlug={activeSlug} lang={lang} />
          <Toolbar count={shown.length} lang={lang} />
          {shown.length ? (
            <div className="grid">
              {shown.map((p) => (
                <ProductCard key={p.id} p={p} lang={lang} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <p>{t("noResults", lang)}</p>
              <a className="btn btn-ghost" href="/">
                {t("browse", lang)}
              </a>
            </div>
          )}
          <Footer settings={settings} />
        </div>
      </div>
    </div>
  );
}

export function sortAndFilter(
  products: Product[],
  sort: string | undefined,
  inStockOnly: boolean
): Product[] {
  let a = products.slice();
  if (sort === "low") a.sort((x, y) => x.price - y.price);
  else if (sort === "high") a.sort((x, y) => y.price - x.price);
  else a.sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
  if (inStockOnly) a = a.filter((p) => p.stock_status !== "out");
  return a;
}
