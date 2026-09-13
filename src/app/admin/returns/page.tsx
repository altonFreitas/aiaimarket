import ReturnsDashboard from "@/components/admin/returns/ReturnsDashboard";
import { customerReturns, supplierReturns, liveOrderCount } from "@/lib/data/returns";
import { adminSuppliers } from "@/lib/data/procurement";
import { adminProducts } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import { canSee } from "@/lib/adminSections";
import {
  customerReturnStats, byReason, mostReturnedProducts,
  supplierReturnStats, bySupplier, chaseList, monthlyReturns,
} from "@/lib/returns";
import { recentMonths } from "@/lib/finance";

/** WHAT CAME BACK, in both directions.
 *
 * Guarded on Sales because customer returns are the bulk of it and they are
 * a property of an order. The supplier half is drawn only for somebody who
 * also holds Procurement -- the actions behind it check the same thing, so
 * this is not the lock; it is not drawing a claim list nobody on this
 * account can act on, and not showing them the shop's cost prices.
 */
export default async function ReturnsPage() {
  const actor = await requireSection("sales");
  const seesSupplier = canSee(actor, "procurement");

  const [lang, customer, supplier, orderCount, suppliers, products] = await Promise.all([
    getLang(),
    customerReturns(),
    seesSupplier ? supplierReturns() : Promise.resolve({ ready: false, rows: [] }),
    liveOrderCount(),
    seesSupplier ? adminSuppliers() : Promise.resolve([]),
    seesSupplier ? adminProducts() : Promise.resolve([]),
  ]);

  const months = recentMonths(12);

  return (
    <ReturnsDashboard
      lang={lang}
      ready={customer.ready}
      stats={customerReturnStats(customer.rows, orderCount)}
      reasons={byReason(customer.rows)}
      products={mostReturnedProducts(customer.rows)}
      returns={customer.rows}
      openRequests={customer.openRequests}
      trend={monthlyReturns(customer.rows, supplier.rows, months)}
      supplier={seesSupplier ? {
        ready: supplier.ready,
        stats: supplierReturnStats(supplier.rows),
        bySupplier: bySupplier(supplier.rows),
        chase: chaseList(supplier.rows),
        rows: supplier.rows,
        suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
        catalog: products
          .filter((p) => !p.archived)
          .map((p) => ({ id: p.id, name: p.name })),
      } : null}
    />
  );
}
