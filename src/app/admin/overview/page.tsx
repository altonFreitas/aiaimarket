import BusinessOverview from "@/components/admin/BusinessOverview";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { adminProcurementData } from "@/lib/data/procurement";
import { buildSalesLines, salesByCustomer, todayIso } from "@/lib/sales";
import { spendBySupplier } from "@/lib/procurement";
import { packSalesLines } from "@/lib/salesWire";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import { canSee } from "@/lib/adminSections";

/** Sales against purchases, on one timeline.
 *
 * WHY THIS IS ITS OWN SCREEN NOW. It used to be the bottom half of the
 * admin's front page, which meant the front page could not be read without
 * scrolling and this could not be read without scrolling past six figures
 * first. It is the one thing neither /admin/sales nor /admin/procurement
 * can answer -- each sees half the business -- so it was never a candidate
 * for deletion; it had simply outgrown being an appendix. The front page
 * keeps a monthly summary of it and links here.
 *
 * THE SECTION RULE IS UNCHANGED, and is the same one the front page
 * applies: the sales half is withheld from an account without Sales, the
 * purchase half from one without Procurement, and an account holding
 * neither never reaches this route at all.
 */
export default async function AdminOverviewPage() {
  const actor = await requireSection("home.overview");
  const canSales = canSee(actor, "sales");
  const canProcurement = canSee(actor, "procurement");

  const [lang, sales, procurement, returns] = await Promise.all([
    getLang(),
    canSales ? adminSalesData() : Promise.resolve(null),
    canProcurement ? adminProcurementData() : Promise.resolve(null),
    canSales ? returnedUnits() : Promise.resolve(new Map<string, number>()),
  ]);

  const lines = sales
    ? buildSalesLines(sales.orders, {
        products: sales.products,
        categories: sales.categories,
        sellers: sales.sellers,
        costs: costMap(sales.costs),
        returns,
      })
    : [];
  const pos = procurement?.purchaseOrders ?? [];

  const topCustomer = canSales ? (salesByCustomer(lines)[0] ?? null) : null;
  const topSupplier = canProcurement && procurement
    ? (spendBySupplier(pos, procurement.suppliers)[0] ?? null) : null;

  return (
    <BusinessOverview
      lang={lang}
      lines={packSalesLines(lines)}
      purchases={pos}
      today={todayIso()}
      canSales={canSales}
      canProcurement={canProcurement}
      closeHref="/admin"
      topCustomer={topCustomer ? { label: topCustomer.label, value: topCustomer.revenue } : null}
      topSupplier={topSupplier ? { label: topSupplier.label, value: topSupplier.value } : null}
    />
  );
}
