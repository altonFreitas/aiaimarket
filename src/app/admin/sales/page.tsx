import SalesDashboard from "@/components/admin/sales/SalesDashboard";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { buildSalesLines, todayIso, type SalesTarget } from "@/lib/sales";
import { getLang } from "@/lib/lang";

export default async function SalesPage() {
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
    <SalesDashboard
      lang={lang}
      lines={lines}
      categories={data.categories}
      sellers={data.sellers}
      targets={data.targets as SalesTarget[]}
      unsoldProducts={unsoldProducts}
      today={todayIso()}
      ready={data.ready}
    />
  );
}
