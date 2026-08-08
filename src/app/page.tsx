import CatalogLayout, { sortAndFilter } from "@/components/CatalogLayout";
import { getCategories, getLiveProducts, getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";

export default async function HomePage({
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
      title={settings.store_name}
      sub={
        <p className="sub">
          {lang === "pt" ? settings.tagline_pt : lang === "en" ? settings.tagline_en : settings.tagline_tet}
        </p>
      }
      cats={cats}
      allProducts={products}
      shown={shown}
      lang={lang}
      settings={settings}
    />
  );
}
