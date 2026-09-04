import AdminHome from "@/components/admin/AdminHome";
import { adminAttention } from "@/lib/data/admin";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { adminProcurementData } from "@/lib/data/procurement";
import { buildSalesLines, salesByCustomer, todayIso } from "@/lib/sales";
import { spendBySupplier } from "@/lib/procurement";
import { packSalesLines } from "@/lib/salesWire";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import { canSee, sectionForPath } from "@/lib/adminSections";

/** The management overview, and what needs doing today.
 *
 * WHY THE OVERVIEW IS HERE AND NOT A SEVENTH TAB. /admin/sales answers
 * everything about selling; /admin/procurement everything about buying.
 * Neither can answer "is what we take in growing faster than what we
 * spend?", because each sees half the business. That comparison is the only
 * thing this page computes -- the breakdowns stay where they already are,
 * and every panel here links out to them.
 *
 * THE SECTION RULE STILL HOLDS. Home is the one screen everybody holds,
 * which would make it a way to read every other section through the back
 * door. The to-do cards were already filtered by destination; the sales and
 * purchase halves of the overview are filtered the same way, so a staff
 * account holding neither section sees the to-do list alone, exactly as
 * before. */
export default async function AdminHomePage() {
  const actor = await requireSection("home");
  const canSales = canSee(actor, "sales");
  const canProcurement = canSee(actor, "procurement");

  const [lang, items, sales, procurement, returns] = await Promise.all([
    getLang(),
    adminAttention(),
    canSales ? adminSalesData() : Promise.resolve(null),
    canProcurement ? adminProcurementData() : Promise.resolve(null),
    canSales ? returnedUnits() : Promise.resolve(new Map<string, number>()),
  ]);

  const mine = items.filter((item) => {
    const section = sectionForPath(item.href);
    return section !== null && canSee(actor, section);
  });

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

  // The one name from each side, for the written summary. Computed here
  // rather than shipped as two more ranked lists: "who is biggest" is a
  // sentence on this page and a whole panel on the two dashboards.
  const topCustomer = canSales ? (salesByCustomer(lines)[0] ?? null) : null;
  const topSupplier = canProcurement && procurement
    ? (spendBySupplier(pos, procurement.suppliers)[0] ?? null) : null;

  return (
    <AdminHome
      lang={lang}
      items={mine}
      lines={packSalesLines(lines)}
      purchases={pos}
      today={todayIso()}
      canSales={canSales}
      canProcurement={canProcurement}
      topCustomer={topCustomer ? { label: topCustomer.label, value: topCustomer.revenue } : null}
      topSupplier={topSupplier ? { label: topSupplier.label, value: topSupplier.value } : null}
    />
  );
}
