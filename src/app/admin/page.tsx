import AdminHome from "@/components/admin/AdminHome";
import { adminAttention, adminLoveStats, adminSellerLedgers } from "@/lib/data/admin";
import { financeTables, cashSideTotals } from "@/lib/data/finance";
import { profitAndLoss } from "@/lib/finance";
import {
  headlineMetrics, overviewSeries, rangeSpec, rangeWindow, totalsIn, RANGES,
  type RangeKey,
} from "@/lib/overview";
import { stockOnHand, type KpiInput } from "@/lib/adminHomeKpis";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { adminProcurementData } from "@/lib/data/procurement";
import {
  buildSalesLines, isLive, LIVE_STATUSES, orderDate, salesByCategory, todayIso,
} from "@/lib/sales";
import {
  analyticsFreshness, rollupIsCurrent, rollupLines, rollupOrderCount, salesRollup,
} from "@/lib/data/salesRollup";
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

  /* WHERE THIS PAGE'S FIGURES COME FROM.
   *
   * sales_daily holds the same arithmetic, already done -- see
   * supabase/sales-rollup.sql, and tests/rls/salesRollup.test.ts for the
   * proof that it agrees with buildSalesLines figure for figure. Reading it
   * instead of the order book is the difference between shipping 11 MB of
   * order lines to this page and shipping a few hundred rows.
   *
   * TWO THINGS DECIDE WHETHER IT CAN ANSWER, and both are known before any
   * read happens:
   *
   *   the range, because a rollup by DAY cannot draw an hour chart, and
   *   "1d" is the one range bucketed by hour;
   *
   *   and whether the view exists at all, which it does not on a shop that
   *   has not pasted supabase/sales-rollup.sql yet.
   *
   * The second is only knowable after asking, so the order book is still
   * read when the rollup turns out not to be there -- this page has to
   * work identically the day the code ships and the SQL has not been.
   */
  const daily = canSales && rangeSpec(range).bucket !== "hour";

  /* AND A THIRD THING, which is why this page could disagree with itself.
   *
   * A materialized view is exactly as current as its last refresh, and
   * `ready` only ever meant "the view can be read". So the shop saw net
   * profit $102.20 on every range except "1D" -- the one range bucketed by
   * hour, which a day-grained rollup cannot answer, so it alone fell back
   * to the live order book and alone agreed with the Finance screen.
   *
   * Nothing was wrong with the arithmetic; both sources compute the same
   * figures (tests/rls/salesRollup). One of them was simply reading a
   * week-old copy of the order book and saying so nowhere. A number that
   * is silently out of date is worse than a missing one, because it looks
   * like an answer.
   *
   * So the rollup is used only when it has seen every change the order
   * book has -- see rollupIsCurrent, and analytics_freshness() for why the
   * comparison is against orders.updated_at rather than created_at. */
  const freshness = daily ? await analyticsFreshness() : null;
  const rollupCurrent = freshness ? rollupIsCurrent(freshness) : false;

  /* FROM THE BEGINNING, not from an arbitrary number of days ago. This
     read a 2000-day window, which is five and a half years -- long enough
     that nothing showed up wrong on a young shop, and short enough that
     the "all time" range and the ALL-TIME net profit below it would both
     have quietly started at a moving date. A rollup is one row per day per
     status per seller per category; the horizon was never what kept it
     small. */
  const rollup = daily && rollupCurrent
    ? await salesRollup("1970-01-01", todayIso())
    : { ready: false, rows: [], orders: [] };
  const fromRollup = daily && rollupCurrent && rollup.ready;

  /* Worth saying out loud only when it costs the shop something: on a
     shop with orders, where the rollup exists but is behind, this page is
     doing the slow thing and somebody should start the cron. */
  const rollupStale = daily && !rollupCurrent && Boolean(freshness?.ordersChangedAt);

  const [lang, items, sales, procurement, returns, loves, tables, cash, ledgers] =
    await Promise.all([
      getLang(),
      adminAttention(),
      wantsProducts
        ? adminSalesData({ withOrders: !fromRollup })
        : Promise.resolve(null),
      canProcurement ? adminProcurementData() : Promise.resolve(null),
      // The returns map exists only to net the ORDER LINES down. The rollup
      // is already netted, so asking for it would be a second read of a
      // table nothing here would consult.
      canSales && !fromRollup ? returnedUnits() : Promise.resolve(new Map<string, number>()),
      canCatalog ? adminLoveStats() : Promise.resolve(null),
      canFinance ? financeTables() : Promise.resolve(null),
      canFinance ? cashSideTotals() : Promise.resolve(null),
      canFinance ? adminSellerLedgers() : Promise.resolve(null),
    ]);

  const mine = items.filter((item) => {
    const section = sectionForPath(item.href);
    return section !== null && canSee(actor, section);
  });

  /* ONE SHAPE, TWO SOURCES. Everything below groups and sums these; it
     does not care which side they came from, which is the property that
     makes swapping the source safe. The synthetic rows carry only the
     fields a rolled-up row can honestly fill -- see rollupLines(). */
  const lines = !canSales || !sales
    ? []
    : fromRollup
      ? rollupLines(rollup.rows, sales.categories, sales.sellers)
      : buildSalesLines(sales.orders, {
          products: sales.products,
          categories: sales.categories,
          sellers: sales.sellers,
          costs: costMap(sales.costs),
          returns,
        });
  const pos = procurement?.purchaseOrders ?? [];

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
        /* THE SAME LINES AS EVERY OTHER FIGURE ON THIS PAGE. This used to
           call buildSalesLines a SECOND time over the same orders -- the
           same work twice per load, and a standing invitation for the
           profit and loss to be computed from a different set than the
           revenue card above it. */
        lines: lines.filter(isLive).map((l) => ({
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

  /* HOW MANY ORDERS, not how many items -- one order of six shoes is one
     order here and six in "quantity sold", which is the distinction the
     card is for.
   *
   * REPORTED FROM THE SHOP: "the card says its only 4 in all time while
   * theres 10 orders in all time in orders". Three separate things made
   * that possible, and the first two were bugs:
   *
   *   THE TWO PATHS ASKED DIFFERENT QUESTIONS. The rollup branch counted
   *   only the statuses that are still sales; the order-book branch
   *   counted every status including cancelled. So the figure changed its
   *   meaning depending on which source happened to answer, which is the
   *   one thing a dashboard number must never do.
   *
   *   AN ORDER WITH NO READABLE LINES WAS NOT AN ORDER. sales_daily_orders
   *   required a row in order_items, and an old version of the sync
   *   trigger had dropped lines naming a deleted product -- so those
   *   orders vanished from the count entirely. See supabase/sales-rollup.sql.
   *
   *   AND A CANCELLED ORDER IS STILL IN THE ORDER BOOK. That last
   *   difference is real and stays: a cancelled sale is not revenue, and a
   *   card sitting beside "money in" must not count it. What was wrong was
   *   saying so nowhere, so the card now carries the number it left out.
   *
   * COUNTED FROM THE ORDERS THEMSELVES on both sides, never from lines: an
   * order whose items are empty is still an order, and a set of lines can
   * never see it. */
  const isLiveStatus = (st: string) =>
    (LIVE_STATUSES as readonly string[]).includes(st);
  /* Loaded only when the rollup did not answer -- see `withOrders` above.
     Empty on the rollup path, where rollup.orders is the exact count. */
  const orderRows = fromRollup ? [] : sales?.orders ?? [];
  const countOrders = (from: string, to: string, keep: (st: string) => boolean) =>
    fromRollup
      /* FROM ITS OWN VIEW, not from the rows above. sales_daily groups by
         seller and category, so an order holding a shirt and a football is
         a row in each and summing its `orders` column would count it
         twice. sales_daily_orders is grouped at the only grain where the
         answer is exact. */
      ? rollupOrderCount(rollup.orders, from, to, keep)
      : orderRows.filter((o) => {
          const d = orderDate(o);
          return d >= from && d <= to && keep(o.status);
        }).length;
  const ordersIn = (from: string, to: string) => countOrders(from, to, isLiveStatus);
  const win = canSales ? rangeWindow(lines, pos, range, today) : null;
  const orderCount = win ? ordersIn(win.from, win.to) : 0;
  const orderCountPrev = win
    ? ordersIn(shiftDays(win.from, -win.days), shiftDays(win.to, -win.days)) : 0;
  /* What the card is NOT counting, so it can say so. Written as "not a
     live status" rather than as "cancelled" so that a status added later
     is excluded from the count and from the sentence together. */
  const ordersCancelled = win
    ? countOrders(win.from, win.to, (st) => !isLiveStatus(st)) : 0;

  /* THE WINDOW'S OWN TOTALS, for the one thing headlineMetrics cannot say.
     Gross profit is computed over the lines that HAVE a cost, so its
     margin has to be taken over that same revenue -- this card used to
     divide it by ALL revenue, which on a shop with costs recorded for
     three products out of nine reports a third of the real margin and
     reads as a shop selling badly. */
  const winTotals = canSales && win ? totalsIn(lines, pos, win) : null;

  const kpis: KpiInput = {
    sales: canSales && revenue
      ? { value: revenue.current ?? 0, pct: revenue.prev?.pct ?? null } : null,
    grossProfit: canSales && gp
      ? {
          // null, not 0: no line in the window had a cost recorded, which
          // is an unanswered question rather than an answer of nothing.
          value: gp.current,
          pct: gp.prev?.pct ?? null,
          /* Share of the COSTED revenue kept -- see winTotals above. Null
             rather than 0 when nothing sold: "no margin" and "no sales to
             have a margin on" differ. */
          margin: winTotals?.margin ?? null,
          // How much of the window's revenue that margin speaks for.
          coverage: winTotals?.costCoverage ?? 0,
        }
      : null,
    orders: canSales && win
      ? {
          value: orderCount,
          pct: orderCountPrev ? (orderCount - orderCountPrev) / orderCountPrev : null,
          cancelled: ordersCancelled,
        }
      : null,
    catalog: shelf
      ? {
          value: shelf.value, units: shelf.units, pricedUnits: shelf.pricedUnits,
          live: shelf.live, priced: shelf.priced,
        }
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
      rollupStale={rollupStale}
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
