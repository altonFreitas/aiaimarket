import ProductList from "@/components/admin/ProductList";
import { adminCategories, adminProducts, adminSettings } from "@/lib/data/admin";
import { staleStock } from "@/lib/data/stale";
import { normalizeStaleDays } from "@/lib/stale";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function AdminProductsPage(
  { searchParams }: { searchParams: Promise<{ stale?: string }> }
) {
  await requireSection("catalog.products");
  const [lang, products, cats, settings, params] = await Promise.all([
    getLang(), adminProducts(), adminCategories(),
    adminSettings().catch(() => null), searchParams,
  ]);

  /* WHAT THE TO-DO LIST WAS POINTING AT.
     Read here as well as on the admin home because this is where the shop
     acts on it, and a link that lands on an unfiltered catalogue has told
     them a number and then hidden the rows. Degrades to an empty list on a
     shop that has not run supabase/stale-stock.sql, and the filter is then
     simply not offered. */
  const days = normalizeStaleDays(
    (settings as { stale_days?: number } | null)?.stale_days);
  const stale = await staleStock(days).catch(() => ({ products: [], days }));

  return (
    <ProductList
      lang={lang} products={products} cats={cats}
      staleIds={stale.products.map((p) => p.id)}
      staleDays={stale.days}
      initialStale={params?.stale === "1"}
    />
  );
}
