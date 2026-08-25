import CatalogLayout, { sortAndFilter } from "@/components/CatalogLayout";
import { getCategories, getLiveProducts, getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import Link from "next/link";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; in?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q || "").trim().toLowerCase();
  const [lang, settings, cats, products] = await Promise.all([
    getLang(), getSettings(), getCategories(), getLiveProducts(),
  ]);

  // D4 — search across name, description and utility tags
  const hits = q
    ? products.filter((p) =>
        (p.name + " " + p.description + " " + (p.tags || []).join(" ")).toLowerCase().includes(q)
      )
    : products;
  const shown = sortAndFilter(hits, sp.sort, sp.in === "1");

  return (
    <CatalogLayout
      title={`${t("search", lang)}: “${sp.q || ""}”`}
      sub={
        <p className="sub">
          <Link href="/">{t("clearSearch", lang)}</Link>
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
