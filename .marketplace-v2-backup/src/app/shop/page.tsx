import CatalogLayout, { sortAndFilter } from "@/components/CatalogLayout";
import { getCategories, getLiveProducts, getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

/** The full catalog — search, category sidebar, sort, "in stock only"
 * filter, product grid. This used to live at "/" (see git history /
 * apply-update-15.js); it moved here so "/" could become a proper
 * marketplace homepage, without losing any of this functionality. */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; in?: string }>;
}) {
  const sp = await searchParams;
  const [lang, settings, cats, products] = await Promise.all([
    getLang(), getSettings(), getCategories(), getLiveProducts(),
  ]);
  const shown = sortAndFilter(products, sp.sort, sp.in === "1");

  return (
    <CatalogLayout
      title={t("catalog", lang)}
      cats={cats}
      allProducts={products}
      shown={shown}
      lang={lang}
      settings={settings}
    />
  );
}
