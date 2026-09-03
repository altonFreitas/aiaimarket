import { notFound } from "next/navigation";
import CatalogLayout from "@/components/CatalogLayout";
import { getCategories, getCategoryBySlug, getLiveProducts, getSettings } from "@/lib/data/public";
import { searchCatalog, parseSort, parsePage, parsePrice } from "@/lib/data/search";
import { parseAudienceFilter } from "@/lib/audience";
import { getLang } from "@/lib/lang";

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

  // A category page shows its own products AND its subcategories', which is
  // why this passes a list of ids rather than one: browsing "Electronics"
  // that has everything filed under "Phones" and "Audio" must not look empty.
  const categoryIds = [cat.id, ...cats.filter((c) => c.parent_id === cat.id).map((c) => c.id)];

  const result = await searchCatalog({
    categoryIds,
    inStockOnly: sp.in === "1",
    audience: parseAudienceFilter(sp.for),
    minPrice: parsePrice(sp.min),
    maxPrice: parsePrice(sp.max),
    sort: parseSort(sp.sort, false),
    page: parsePage(sp.page),
  });

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
      params={{ sort: sp.sort, in: sp.in, min: sp.min, max: sp.max, for: sp.for }}
    />
  );
}
