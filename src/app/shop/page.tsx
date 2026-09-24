import CatalogLayout from "@/components/CatalogLayout";
import { getCategories, getLiveProducts, getSettings } from "@/lib/data/public";
import { searchCatalog, parseSort, parsePage, parsePrice } from "@/lib/data/search";
import { categoryOptions, categoryFilterIds } from "@/lib/nav";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { listingMetadata } from "@/lib/listingMeta";
import { parseAttributeFilters } from "@/lib/attributeFilterParams";
import { filtersFor, idsMatching } from "@/lib/data/attributeFilters";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [lang, sp, settings] = await Promise.all([getLang(), searchParams, getSettings()]);
  return listingMetadata({
    title: t("catalog", lang),
    description: settings.tagline_tet || undefined,
    path: "/shop",
    lang,
    searchParams: sp,
  });
}

/** The full catalog — category sidebar, sort, filters, paginated grid. This
 * used to live at "/"; it moved here so "/" could become a proper
 * marketplace homepage, without losing any of this functionality. */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v);

  /* THE ATTRIBUTE FILTERS RESOLVE TO PRODUCT IDS BEFORE THE SEARCH RUNS,
     not after it. Filtering the result would leave the total count, and
     so the pager, describing the unfiltered catalogue -- offering pages
     that do not exist and returning an empty page one while page four
     was full. */
  const active = parseAttributeFilters(sp);
  const attributeIds = await idsMatching(active);

  /* The aisle filter needs the tree before the search can use it, so the
     categories are read first rather than inside the Promise.all below --
     getCategories() is cross-request cached (lib/data/public.ts), so the
     second call costs nothing. */
  const cats = await getCategories();
  const [lang, settings, allProducts, result] = await Promise.all([
    getLang(), getSettings(), getLiveProducts(),
    searchCatalog({
      categoryIds: categoryFilterIds(cats, one(sp.cat)) ?? undefined,
      inStockOnly: one(sp.in) === "1",
      minPrice: parsePrice(one(sp.min)),
      maxPrice: parsePrice(one(sp.max)),
      sort: parseSort(one(sp.sort), false),
      page: parsePage(one(sp.page)),
      attributeIds,
    }),
  ]);

  /* The options offered are built from the WHOLE catalogue rather than
     from the filtered result, so they do not disappear as they are used
     -- a colour list that shrinks to the one colour you picked is a
     filter you cannot undo without the back button. */
  const attributeFilters = await filtersFor(allProducts.map((p) => p.id));

  return (
    <CatalogLayout
      title={t("catalog", lang)}
      cats={cats}
      allProducts={allProducts}
      result={result}
      lang={lang}
      settings={settings}
      basePath="/shop"
      attributeFilters={attributeFilters}
      activeFilters={active}
      categories={categoryOptions(cats, allProducts)}
      params={{
        sort: one(sp.sort), in: one(sp.in), min: one(sp.min),
        max: one(sp.max), cat: one(sp.cat),
      }}
    />
  );
}
