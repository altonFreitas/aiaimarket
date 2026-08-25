import Link from "next/link";
import CatalogLayout from "@/components/CatalogLayout";
import { getCategories, getLiveProducts, getSettings } from "@/lib/data/public";
import { searchCatalog, suggestProducts, parseSort, parsePage, parsePrice } from "@/lib/data/search";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; in?: string; min?: string; max?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();

  const [lang, settings, cats, allProducts, result] = await Promise.all([
    getLang(), getSettings(), getCategories(), getLiveProducts(),
    searchCatalog({
      q,
      inStockOnly: sp.in === "1",
      minPrice: parsePrice(sp.min),
      maxPrice: parsePrice(sp.max),
      sort: parseSort(sp.sort, !!q),
      page: parsePage(sp.page),
    }),
  ]);

  // Only worth a second query when the first one came back empty, and only
  // on the indexed path -- the fallback has no trigram index behind it.
  const suggestions =
    q && result.total === 0 && result.indexed ? await suggestProducts(q) : [];

  const sub = (
    <div className="sub">
      {result.total === 0 && q ? (
        <>
          <p style={{ margin: "0 0 6px" }}>
            {t("noResultsFor", lang)} “{q}”. {t("searchTips", lang)}
          </p>
          {suggestions.length > 0 && (
            <p style={{ margin: "0 0 6px" }}>
              {t("didYouMean", lang)}{" "}
              {suggestions.map((s, i) => (
                <span key={s.slug}>
                  {i > 0 && ", "}
                  <Link href={`/p/${s.slug}`}>{s.name}</Link>
                </span>
              ))}
            </p>
          )}
        </>
      ) : null}
      <p style={{ margin: 0 }}>
        <Link href="/shop">{t("clearSearch", lang)}</Link>
      </p>
    </div>
  );

  return (
    <CatalogLayout
      title={`${t("search", lang)}: “${q}”`}
      sub={sub}
      cats={cats}
      allProducts={allProducts}
      result={result}
      lang={lang}
      settings={settings}
      basePath="/search"
      params={{ q: sp.q, sort: sp.sort, in: sp.in, min: sp.min, max: sp.max }}
      showRelevance
    />
  );
}
