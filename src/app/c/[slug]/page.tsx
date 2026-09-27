import { notFound } from "next/navigation";
import CatalogLayout from "@/components/CatalogLayout";
import { getCategories, getCategoryBySlug, getLiveProducts, getSettings } from "@/lib/data/public";
import { searchCatalog, parseSort, parsePage, parsePrice } from "@/lib/data/search";
import { getLang } from "@/lib/lang";
import { listingMetadata } from "@/lib/listingMeta";
import { descendantIds } from "@/lib/categoryTree";
import { parseAttributeFilters } from "@/lib/attributeFilterParams";
import { filtersFor, idsMatching } from "@/lib/data/attributeFilters";

export async function generateMetadata({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; in?: string; min?: string; max?: string; page?: string; for?: string }>;
}) {
  const [{ slug }, sp, settings, lang] = await Promise.all([params, searchParams, getSettings(), getLang()]);
  const cat = await getCategoryBySlug(slug);
  if (!cat) return { title: "404" };
  return listingMetadata({
    title: cat.name,
    description: `${cat.name} — ${settings.store_name}`,
    path: `/c/${cat.slug}`,
    lang,
    searchParams: sp,
  });
}

export default async function CategoryPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; in?: string; min?: string; max?: string; page?: string; for?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const [lang, settings, cats, allProducts, cat] = await Promise.all([
    getLang(), getSettings(), getCategories(), getLiveProducts(), getCategoryBySlug(slug),
  ]);
  if (!cat) notFound();

  /* A category page shows its own products AND EVERYTHING BELOW IT, which
     is why this passes a list of ids rather than one: browsing "Fitness &
     Wellness" that has everything filed under "Sports Nutrition" must not
     look empty.

     THE WHOLE SUBTREE, not the first level of it. This walked one level --
     the category and its direct children -- and the tree is three deep in
     places: Fitness & Wellness -> Sports Nutrition -> Protein. A shopper
     opening the top of that saw the aisle's own products and its
     children's, and none of the protein, while the aisle card beside it
     counted the protein in. Same helper as everything else that walks it. */
  const categoryIds = descendantIds(cats, cat.id);

  /* THE ATTRIBUTE FILTERS RESOLVE TO PRODUCT IDS BEFORE THE SEARCH RUNS,
     not after it. Filtering the result would leave the total count, and so
     the pager, describing the unfiltered category. */
  const active = parseAttributeFilters(sp as Record<string, string | undefined>);
  const attributeIds = await idsMatching(active);

  const result = await searchCatalog({
    categoryIds,
    inStockOnly: sp.in === "1",
    minPrice: parsePrice(sp.min),
    maxPrice: parsePrice(sp.max),
    sort: parseSort(sp.sort, false),
    page: parsePage(sp.page),
    attributeIds,
  });

  /* THE RAIL ON A CATEGORY PAGE IS THAT CATEGORY'S RAIL, and this line is
     the whole of why: the filters are built from the products in this
     aisle, so shoes offer Shoe Size and Terrain while protein offers
     Flavour and Weight, and neither offers the other's. Built from the
     aisle BEFORE the attribute filters are applied, so the options do not
     disappear as they are used. */
  const inAisle = allProducts.filter((p) => categoryIds.includes(p.category_id || ""));
  const attributeFilters = await filtersFor(inAisle.map((p) => p.id));

  return (
    <CatalogLayout
      title={cat.name}
      cats={cats}
      allProducts={allProducts}
      result={result}
      activeSlug={cat.slug}
      lang={lang}
      settings={settings}
      basePath={`/c/${cat.slug}`}
      attributeFilters={attributeFilters}
      activeFilters={active}
      params={{ sort: sp.sort, in: sp.in, min: sp.min, max: sp.max }}
    />
  );
}
