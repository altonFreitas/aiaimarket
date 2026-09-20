import AdminHome from "@/components/admin/AdminHome";
import { adminAttention, adminLoveStats, adminSellerLedgers } from "@/lib/data/admin";
import { financeTables, cashSideTotals } from "@/lib/data/finance";
import { profitAndLoss } from "@/lib/finance";
import {
  headlineMetrics, overviewSeries, rangeWindow, RANGES, type RangeKey,
} from "@/lib/overview";
import { stockOnHand, type KpiInput } from "@/lib/adminHomeKpis";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { adminProcurementData } from "@/lib/data/procurement";
import {
  buildSalesLines, isLive, salesByCategory, salesByCustomer, todayIso,
} from "@/lib/sales";
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
export default async function AdminHomePage(
  { searchParams }: { searchParams: Promise<{ range?: string }> },
) {
  const actor = await requireSection("home.overview");
  /* WHICH SPAN THE FIGURES COVER, from the address rather than from state.
     A server component computes these, so the picker is a row of links and
     the page is recomputed -- which also means a range can be bookmarked,
     opened in a second tab and shared with whoever is asked about it. */
  const range = parseRange((await searchParams).range);
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
    ? headlineMetrics(lines, pos, range, today) : [];
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

  const gp = metric("grossProfit");

  /* HOW MANY ORDERS, not how many items. Counted from the same windowed
     lines the money comes from, so the two cannot describe different sets
     of orders -- one order of six shoes is one order here and six in
     "quantity sold", which is the distinction the card is for. */
  const ordersIn = (from: string, to: string) =>
    new Set(lines.filter((l) => l.date >= from && l.date <= to)
      .map((l) => l.orderId)).size;
  const win = canSales ? rangeWindow(lines, pos, range, today) : null;
  const orderCount = win ? ordersIn(win.from, win.to) : 0;
  const orderCountPrev = win
    ? ordersIn(shiftDays(win.from, -win.days), shiftDays(win.to, -win.days)) : 0;

  const kpis: KpiInput = {
    sales: canSales && revenue
      ? { value: revenue.current ?? 0, pct: revenue.prev?.pct ?? null } : null,
    grossProfit: canSales && gp
      ? {
          // null, not 0: no line in the window had a cost recorded, which
          // is an unanswered question rather than an answer of nothing.
          value: gp.current,
          pct: gp.prev?.pct ?? null,
          // Share of revenue kept. Null rather than 0 when nothing sold:
          // "no margin" and "no sales to have a margin on" differ.
          margin: revenue?.current && gp.current != null
            ? gp.current / revenue.current : null,
        }
      : null,
    orders: canSales && win
      ? {
          value: orderCount,
          pct: orderCountPrev ? (orderCount - orderCountPrev) / orderCountPrev : null,
        }
      : null,
    catalog: shelf
      ? { value: shelf.value, units: shelf.units, live: shelf.live, priced: shelf.priced }
      : null,
    procurement: canProcurement && spend
      ? { value: spend.current ?? 0, pct: spend.prev?.pct ?? null } : null,
    finance: pl ? { value: pl.netProfit, margin: pl.netMargin } : null,
  };

  /* THE SHAPE OF THE TWO SIDES, small enough to sit on the front page.
     Monthly buckets over the last half year: enough to see a direction,
     few enough to read at tile size. The full version, with its range
     tabs and year-on-year, is one click away at /admin/overview. */
  const flow = ((canSales || canProcurement)
    ? overviewSeries(lines, pos, range, today)
    : [])
    /* The last two dozen buckets at most. overviewSeries already chooses a
       sensible bucket per range -- hours for a day, months for five years
       -- so this only guards the long tail: "max" on a shop five years old
       is sixty bars in a tile the width of a hand. */
    .slice(-24)
    .map((pt) => ({
      key: pt.key, label: pt.label, title: pt.full,
      a: Math.round(pt.revenue * 100) / 100,
      b: Math.round(pt.purchaseCost * 100) / 100,
    }));

  /* WHAT SELLS. The one breakdown worth a tile: a shop that cannot see
     which part of its catalogue earns is guessing when it reorders. */
  const categories = canSales
    ? salesByCategory(lines.filter((l) => win && l.date >= win.from && l.date <= win.to))
        .slice(0, 5)
        .map((g) => ({ key: g.key, label: g.label, value: g.revenue, share: g.share }))
    : [];

  return (
    <AdminHome
      lang={lang}
      items={mine}
      canSales={canSales}
      canProcurement={canProcurement}
      kpis={kpis}
      range={range}
      flow={flow}
      categories={categories}
      loves={loves}
    />
  );
}

/** A date, n days along. Negative moves back. UTC throughout, like every
 * other date in the sales code: a shop in Dili comparing months must not
 * lose a day to whichever machine rendered the page. */
function shiftDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The range from the address, or the default.
 *
 * Validated against RANGES rather than trusted: ?range= is whatever
 * somebody typed, and an unknown value must land on a real window rather
 * than on an empty chart that looks like a shop with no trade. A month is
 * the default because it is the span a shop actually plans against. */
function parseRange(raw: string | undefined): RangeKey {
  return RANGES.some((r) => r.key === raw) ? (raw as RangeKey) : "1m";
}
