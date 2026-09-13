import FinanceDashboard from "@/components/admin/FinanceDashboard";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { adminSellerLedgers } from "@/lib/data/admin";
import { financeTables, paidRecurringPeriods, cashSideTotals } from "@/lib/data/finance";
import { buildSalesLines, isLive } from "@/lib/sales";
import {
  profitAndLoss, dueRecurring, monthlyCommitment, monthlyTrend, recentMonths,
  monthsOfRunway,
} from "@/lib/finance";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

/** After everything, how much is left.
 *
 * Guarded on settings rather than sales: this screen carries what the shop
 * pays its suppliers, its staff and its bank, which is more sensitive than
 * margin -- margin can at least be guessed from prices.
 *
 * THE COMMISSION COMES FROM THE PAYOUTS SCREEN'S OWN FUNCTION, not from a
 * second calculation here. Two screens that each work out what the platform
 * earned will eventually disagree, and the one nobody is looking at will be
 * the wrong one.
 */
export default async function FinancePage() {
  await requireSection("settings");

  const [lang, data, returns, tables, paidPeriods, cash, ledgers] = await Promise.all([
    getLang(),
    adminSalesData(),
    returnedUnits(),
    financeTables(),
    paidRecurringPeriods(),
    cashSideTotals(),
    adminSellerLedgers(),
  ]);

  const lines = buildSalesLines(data.orders, {
    products: data.products,
    categories: data.categories,
    sellers: data.sellers,
    costs: costMap(data.costs),
    returns,
  }).filter(isLive);

  // Commission across every seller, from the same ledger the payouts screen
  // shows. A platform-owned line carries no seller and no commission.
  const commission = ledgers.reduce((a, l) => a + l.commission, 0);

  const pl = profitAndLoss({
    lines: lines.map((l) => ({
      sellerId: l.sellerId, netSales: l.netSales, cost: l.cost,
    })),
    commission,
    deliveryFees: cash.deliveryFees,
    refunds: cash.refunds,
    expenses: tables.expenses,
  });

  /* THE TREND, over the last twelve calendar months.
   *
   * Income is bucketed here rather than inside lib/finance.ts because
   * working out which month a sale belongs to is the sales module's job,
   * and doing it twice is how two screens come to disagree about a number
   * they both display. */
  const months = recentMonths(12);
  const incomeByMonth = new Map<string, number>();
  for (const l of lines) {
    const m = l.date.slice(0, 7);
    // Gross profit on own goods; a marketplace line's income is its
    // commission, which is not knowable per month from this shape and is
    // deliberately left out of the trend rather than guessed at.
    if (l.sellerId != null) continue;
    const gp = l.cost != null ? l.netSales - l.cost : l.netSales;
    incomeByMonth.set(m, (incomeByMonth.get(m) || 0) + gp);
  }
  const trend = monthlyTrend(incomeByMonth, tables.expenses, months);

  const due = dueRecurring(tables.recurring, paidPeriods);
  const committed = monthlyCommitment(tables.recurring);

  // Averaged over the months that actually have something in them: a shop
  // three months old should not have its average divided by twelve.
  const withActivity = trend.filter((t) => t.income > 0 || t.expenses > 0);
  const avgProfit = withActivity.length
    ? withActivity.reduce((a, t) => a + t.netProfit, 0) / withActivity.length
    : 0;

  return (
    <FinanceDashboard
      lang={lang}
      ready={tables.ready}
      pl={pl}
      expenses={tables.expenses}
      recurring={tables.recurring}
      due={due}
      committed={committed}
      trend={trend}
      runway={monthsOfRunway(avgProfit, committed)}
    />
  );
}
