import { notFound } from "next/navigation";
import CatalogLayout, { sortAndFilter } from "@/components/CatalogLayout";
import { getCategories, getCategoryBySlug, getLiveProducts, getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";

export default async function CategoryPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; in?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const [lang, settings, cats, products, cat] = await Promise.all([
    getLang(), getSettings(), getCategories(), getLiveProducts(), getCategoryBySlug(slug),
  ]);
  if (!cat) notFound();

  const ids = [cat.id, ...cats.filter((c) => c.parent_id === cat.id).map((c) => c.id)];
  const inCat = products.filter((p) => ids.includes(p.category_id || ""));
  const shown = sortAndFilter(inCat, sp.sort, sp.in === "1");

  return (
    <CatalogLayout
      title={cat.name}
      cats={cats}
      allProducts={products}
      shown={shown}
      activeSlug={cat.slug}
      lang={lang}
      settings={settings}
    />
  );
}
