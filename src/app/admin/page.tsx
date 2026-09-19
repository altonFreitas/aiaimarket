import AdminHome from "@/components/admin/AdminHome";
import { adminAttention, adminLoveStats, adminSellerLedgers } from "@/lib/data/admin";
import { financeTables, cashSideTotals } from "@/lib/data/finance";
import { profitAndLoss } from "@/lib/finance";
import { headlineMetrics } from "@/lib/overview";
import { stockOnHand, type KpiInput } from "@/lib/adminHomeKpis";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { adminProcurementData } from "@/lib/data/procurement";
import { buildSalesLines, isLive, salesByCustomer, todayIso } from "@/lib/sales";
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
  const actor = await requireSection("home.overview");
  const canSales = canSee(actor, "sales");
  const canProcurement = canSee(actor, "procurement");
  // The heart lives on the catalog's product cards, so the figure counting
  // it belongs to whoever holds the catalog -- the same section rule every
  // other panel on this page follows.
  const canCatalog = canSee(actor, "catalog");
  // The books sit under Settings, being more sensitive than margin -- see
  // adminSections. Home shows one figure off them and nothing more.
  const canFinance = canSee(actor, "settings");

  /* THE CATALOGUE KPI NEEDS THE PRODUCT ROWS, which arrive inside the sales
     payload. An account holding Catalog and not Sales would otherwise have
     no way to be told what its own shelves are worth, so the load is
     widened for either. */
  const wantsProducts = canSales || canCatalog;

  const [lang, items, sales, procurement, returns, loves, tables, cash, ledgers] =
    await Promise.all([
      getLang(),
      adminAttention(),
      wantsProducts ? adminSalesData() : Promise.resolve(null),
      canProcurement ? adminProcurementData() : Promise.resolve(null),
      canSales ? returnedUnits() : Promise.resolve(new Map<string, number>()),
      canCatalog ? adminLoveStats() : Promise.resolve(null),
      canFinance ? financeTables() : Promise.resolve(null),
      canFinance ? cashSideTotals() : Promise.resolve(null),
      canFinance ? adminSellerLedgers() : Promise.resolve(null),
    ]);

  const mine = items.filter((item) => {
    const section = sectionForPath(item.href);
    return section !== null && canSee(actor, section);
  });

  const lines = sales && canSales
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

  /* ONE FIGURE FROM EACH AREA, over the same month the overview below uses.
     Built here rather than in the component because three of the four are
     database reads, and because each has to be withheld from an account
     that cannot open the screen it comes from -- the same rule the to-do
     cards follow. */
  const today = todayIso();
  const headline = canSales || canProcurement
    ? headlineMetrics(lines, pos, "1m", today) : [];
  const metric = (k: string) => headline.find((m) => m.key === k) ?? null;
  const revenue = metric("revenue");
  const spend = metric("purchaseCost");

  const pl = canFinance && sales && tables && cash && ledgers
    ? profitAndLoss({
        lines: buildSalesLines(sales.orders, {
          products: sales.products, categories: sales.categories,
          sellers: sales.sellers, costs: costMap(sales.costs), returns,
        }).filter(isLive).map((l) => ({
          sellerId: l.sellerId, netSales: l.netSales, cost: l.cost,
        })),
        commission: ledgers.reduce((a, l) => a + l.commission, 0),
        deliveryFees: cash.deliveryFees,
        refunds: cash.refunds,
        expenses: tables.expenses,
      })
    : null;

  const shelf = canCatalog && sales
    ? stockOnHand(sales.products, costMap(sales.costs)) : null;

  const kpis: KpiInput = {
    sales: canSales && revenue
      ? { value: revenue.current ?? 0, pct: revenue.prev?.pct ?? null } : null,
    catalog: shelf
      ? { value: shelf.value, live: shelf.live, priced: shelf.priced } : null,
    procurement: canProcurement && spend
      ? { value: spend.current ?? 0, pct: spend.prev?.pct ?? null } : null,
    finance: pl ? { value: pl.netProfit, margin: pl.netMargin } : null,
  };

  return (
    <AdminHome
      lang={lang}
      items={mine}
      lines={packSalesLines(lines)}
      purchases={pos}
      today={today}
      kpis={kpis}
      canSales={canSales}
      canProcurement={canProcurement}
      loves={loves}
      topCustomer={topCustomer ? { label: topCustomer.label, value: topCustomer.revenue } : null}
      topSupplier={topSupplier ? { label: topSupplier.label, value: topSupplier.value } : null}
    />
  );
}
