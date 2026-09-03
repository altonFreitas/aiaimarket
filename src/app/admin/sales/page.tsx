import SalesDashboard from "@/components/admin/sales/SalesDashboard";
import CoverageNotice from "@/components/admin/CoverageNotice";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { buildSalesLines, todayIso, type SalesTarget } from "@/lib/sales";
import { packSalesLines } from "@/lib/salesWire";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function SalesPage() {
  await requireSection("sales");
  const [lang, data, returns] = await Promise.all([
    getLang(), adminSalesData(), returnedUnits(),
  ]);

  const lines = buildSalesLines(data.orders, {
    products: data.products,
    categories: data.categories,
    sellers: data.sellers,
    costs: costMap(data.costs),
    // Goods handed back were never really sold. Netted off here so every
    // figure below -- revenue, margin, best product, best customer -- is
    // corrected at once rather than one metric at a time.
    returns,
  });

  // Catalog products that sold nothing at all -- section 19 of the spec.
  // Derived here rather than in the component because it needs the full
  // catalog, which the dashboard otherwise has no reason to receive.
  const sold = new Set(lines.map((l) => l.productId));
  const unsoldProducts = data.products
    .filter((p) => !p.archived && !sold.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      {/* Above the figures, not below them: a limitation read after the
          numbers is a limitation read too late. */}
      <CoverageNotice lang={lang} coverage={data.coverage} />
      <SalesDashboard
        lang={lang}
        lines={packSalesLines(lines)}
        categories={data.categories}
        sellers={data.sellers}
        targets={data.targets as SalesTarget[]}
        unsoldProducts={unsoldProducts}
        today={todayIso()}
        ready={data.ready}
      />
    </>
  );
}
