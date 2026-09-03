import CatalogLayout from "@/components/CatalogLayout";
import { getCategories, getLiveProducts, getSettings } from "@/lib/data/public";
import { searchCatalog, parseSort, parsePage, parsePrice } from "@/lib/data/search";
import { parseAudienceFilter } from "@/lib/audience";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

/** The full catalog — category sidebar, sort, filters, paginated grid. This
 * used to live at "/"; it moved here so "/" could become a proper
 * marketplace homepage, without losing any of this functionality. */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; in?: string; min?: string; max?: string; page?: string; for?: string }>;
}) {
  const sp = await searchParams;
  const [lang, settings, cats, allProducts, result] = await Promise.all([
    getLang(), getSettings(), getCategories(), getLiveProducts(),
    searchCatalog({
      inStockOnly: sp.in === "1",
      audience: parseAudienceFilter(sp.for),
      minPrice: parsePrice(sp.min),
      maxPrice: parsePrice(sp.max),
      sort: parseSort(sp.sort, false),
      page: parsePage(sp.page),
    }),
  ]);

  return (
    <CatalogLayout
      title={t("catalog", lang)}
      cats={cats}
      allProducts={allProducts}
      result={result}
      lang={lang}
      settings={settings}
      basePath="/shop"
      params={{ sort: sp.sort, in: sp.in, min: sp.min, max: sp.max, for: sp.for }}
    />
  );
}
