import { EXPENSE_ACCOUNTS, isPlatformCost, monthlyCost, type Cadence, type ExpenseAccount } from "./accounts";

/* AFTER EVERYTHING, HOW MUCH IS LEFT.
 *
 * Every other number in this application is about MERCHANDISE -- what sold,
 * what it cost to buy, what margin that left. All of it true, and none of it
 * able to answer the question that decides whether the business works,
 * because the shop also pays for Supabase, a domain, Vercel, a licence and
 * the bank's cut of every card payment.
 *
 * This is that arithmetic, and it is pure: given the sales lines, the
 * commission, the delivery fees and the expenses, it returns a profit and
 * loss. No I/O, so every rule below can be tested without a database.
 *
 * THE ONE STRUCTURAL THING TO UNDERSTAND. This is a MARKETPLACE, so there
 * are two businesses in one set of books:
 *
 *   the shop's own goods   revenue is the sale price, and the cost of those
 *                          goods is a real cost. Margin is the shop's.
 *   somebody else's goods  the sale price was never the shop's money. Only
 *                          the COMMISSION is income; the rest is owed to the
 *                          seller and passes straight through.
 *
 * Adding gross marketplace sales to own sales would make the shop look many
 * times larger than it is and would show a profit it never had. So they are
 * counted separately and only the commission from the second is income.
 */

export interface ExpenseRow {
  id: string;
  account: string;
  vendor: string;
  description: string;
  /** Already converted to USD by the database (amount * fx_rate). */
  amountUsd: number;
  incurredOn: string;
  periodStart: string | null;
  periodEnd: string | null;
  note: string;
}

export interface RecurringRow {
  id: string;
  account: string;
  vendor: string;
  description: string;
  amountUsd: number;
  cadence: Cadence;
  dayOfMonth: number;
  startedOn: string;
  endedOn: string | null;
}

/** The minimum a sales line has to carry for the accounts. Deliberately
 * narrower than SalesLine: this module has no business knowing a buyer's
 * phone number. */
export interface FinanceLine {
  sellerId: string | null;
  netSales: number;
  cost: number | null;
}

export interface FinanceInput {
  /** Live (non-cancelled) lines for the period. */
  lines: readonly FinanceLine[];
  /** Commission earned on other sellers' goods, from the same function the
   * payouts screen uses -- passed in rather than recomputed, so the two
   * screens cannot disagree about what the platform earned. */
  commission: number;
  /** Delivery fees collected from buyers in the period. */
  deliveryFees: number;
  /** Money refunded to buyers, which is revenue that came back. */
  refunds: number;
  expenses: readonly ExpenseRow[];
  /** Which seller id is the shop's own. Lines with this id, or with none at
   * all, are the shop's own goods. */
  ownSellerId?: string | null;
}

export interface AccountTotal {
  account: ExpenseAccount;
  total: number;
  share: number;
}

export interface ProfitAndLoss {
  /* --- income --- */
  /** Revenue on goods the shop itself sold. */
  ownSales: number;
  /** What those goods cost to buy, over the lines that HAVE a cost. */
  ownCost: number;
  /** ownSales - ownCost. */
  ownGrossProfit: number;
  /** 0..1 -- the share of ownSales whose cost is actually known. A margin
   * quoted at 30% coverage is describing under a third of the business, and
   * the screen has to say so rather than presenting it as the whole. */
  costCoverage: number;

  /** The platform's cut of other sellers' goods. */
  commission: number;
  /** Gross value of other sellers' goods. NOT income -- reported so the
   * marketplace's size is visible next to the shop's own trade. */
  marketplaceGross: number;

  deliveryFees: number;
  refunds: number;

  /** Own gross profit + commission + delivery fees - refunds. */
  totalIncome: number;

  /* --- costs --- */
  expensesTotal: number;
  byAccount: AccountTotal[];
  /** Hosting + software + domain: what the website costs whether or not
   * anything sells. */
  platformCost: number;

  /* --- the answer --- */
  netProfit: number;
  /** netProfit / totalIncome, or null when there was no income to divide by.
   * Null rather than 0: "we earned nothing this month" and "we earned
   * nothing per dollar" are different statements. */
  netMargin: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function profitAndLoss(input: FinanceInput): ProfitAndLoss {
  const own = input.ownSellerId ?? null;

  let ownSales = 0, ownCost = 0, costedSales = 0, marketplaceGross = 0;

  for (const l of input.lines) {
    // No seller at all is the shop's own catalogue -- that is how a product
    // with no marketplace seller has always been stored.
    const isOwn = l.sellerId == null || (own != null && l.sellerId === own);
    if (!isOwn) {
      marketplaceGross += l.netSales;
      continue;
    }
    ownSales += l.netSales;
    if (l.cost != null) {
      ownCost += l.cost;
      costedSales += l.netSales;
    }
  }

  const ownGrossProfit = ownSales - ownCost;

  const expensesTotal = input.expenses.reduce((a, e) => a + e.amountUsd, 0);

  const sums = new Map<string, number>();
  for (const e of input.expenses) {
    sums.set(e.account, (sums.get(e.account) || 0) + e.amountUsd);
  }
  const byAccount: AccountTotal[] = EXPENSE_ACCOUNTS
    .map((account) => ({
      account,
      total: round2(sums.get(account) || 0),
      share: expensesTotal > 0 ? (sums.get(account) || 0) / expensesTotal : 0,
    }))
    // An account nobody has filed against is not a row of zero -- it is
    // absent. A chart of twelve accounts showing nine zeroes is a chart
    // nobody reads.
    .filter((a) => a.total > 0)
    .sort((a, b) => b.total - a.total);

  const platformCost = input.expenses
    .filter((e) => isPlatformCost(e.account))
    .reduce((a, e) => a + e.amountUsd, 0);

  const totalIncome =
    ownGrossProfit + input.commission + input.deliveryFees - input.refunds;
  const netProfit = totalIncome - expensesTotal;

  return {
    ownSales: round2(ownSales),
    ownCost: round2(ownCost),
    ownGrossProfit: round2(ownGrossProfit),
    costCoverage: ownSales > 0 ? costedSales / ownSales : 0,
    commission: round2(input.commission),
    marketplaceGross: round2(marketplaceGross),
    deliveryFees: round2(input.deliveryFees),
    refunds: round2(input.refunds),
    totalIncome: round2(totalIncome),
    expensesTotal: round2(expensesTotal),
    byAccount,
    platformCost: round2(platformCost),
    netProfit: round2(netProfit),
    netMargin: totalIncome > 0 ? netProfit / totalIncome : null,
  };
}

/* ---------------------------------------------------------------------------
 * What is due, and has not been paid
 * ------------------------------------------------------------------------ */

export interface DueExpense {
  recurring: RecurringRow;
  /** The period this instance covers, as YYYY-MM-DD. Also the key that makes
   * confirming it twice impossible -- see the unique index in
   * supabase/operating-costs.sql. */
  periodStart: string;
  periodEnd: string;
  /** The day the money is expected to leave. */
  dueOn: string;
  /** True when that day has already passed. */
  overdue: boolean;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The first day of the period a given date falls in, for a cadence.
 *
 * Quarterly anchors on the calendar quarter and yearly on the calendar year
 * rather than on the subscription's own start date. That is the less clever
 * answer and the right one: an owner reconciling against a bank statement is
 * reading calendar months, and a "period" that runs from the 14th of
 * February to the 13th of May matches nothing they can see. */
function periodStartFor(d: Date, cadence: Cadence): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (cadence === "yearly") return new Date(Date.UTC(y, 0, 1));
  if (cadence === "quarterly") return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
  return new Date(Date.UTC(y, m, 1));
}

function periodEndFor(start: Date, cadence: Cadence): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const months = cadence === "yearly" ? 12 : cadence === "quarterly" ? 3 : 1;
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(y, m + months, 0));
}

/** Every recurring cost whose current period has not been confirmed paid.
 *
 * NOTHING HERE IS A COST YET. This is the list the finance screen shows so
 * the owner can confirm what actually left the account -- a subscription
 * that was cancelled, failed or was billed at a different price must never
 * find its way into the profit and loss on the strength of a template
 * somebody typed once.
 *
 * `paidPeriods` is the set of "<recurringId>|<periodStart>" already
 * recorded, which is the same key the unique index uses. */
export function dueRecurring(
  recurring: readonly RecurringRow[],
  paidPeriods: ReadonlySet<string>,
  now: Date = new Date(),
): DueExpense[] {
  const out: DueExpense[] = [];
  const today = iso(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  for (const r of recurring) {
    // Cancelled subscriptions stop being due. The row stays, because the
    // history of having paid for it is worth more than the tidiness.
    if (r.endedOn && r.endedOn < today) continue;

    const start = periodStartFor(now, r.cadence);
    const startIso = start.toISOString().slice(0, 10);

    // A subscription that starts next month is not owed this month.
    if (r.startedOn > periodEndFor(start, r.cadence).toISOString().slice(0, 10)) continue;

    if (paidPeriods.has(`${r.id}|${startIso}`)) continue;

    const due = new Date(Date.UTC(
      start.getUTCFullYear(), start.getUTCMonth(), r.dayOfMonth));
    const dueIso = due.toISOString().slice(0, 10);

    out.push({
      recurring: r,
      periodStart: startIso,
      periodEnd: periodEndFor(start, r.cadence).toISOString().slice(0, 10),
      dueOn: dueIso,
      overdue: dueIso < today,
    });
  }

  // Overdue first, then by date: the list is a to-do, so what is late is
  // what the eye should reach first.
  return out.sort((a, b) =>
    Number(b.overdue) - Number(a.overdue) || a.dueOn.localeCompare(b.dueOn));
}

/** What the shop is committed to every month, across every cadence.
 *
 * The number that makes "$25 a month" feel real: three subscriptions on
 * three different cadences cannot be compared or added until they are all
 * expressed per month. */
export function monthlyCommitment(recurring: readonly RecurringRow[], now: Date = new Date()): number {
  const today = now.toISOString().slice(0, 10);
  return round2(recurring
    .filter((r) => !r.endedOn || r.endedOn >= today)
    .reduce((a, r) => a + monthlyCost(r.amountUsd, r.cadence), 0));
}

/* ---------------------------------------------------------------------------
 * The trend
 * ------------------------------------------------------------------------ */

export interface MonthlyPoint {
  /** YYYY-MM. */
  month: string;
  income: number;
  expenses: number;
  netProfit: number;
}

/** Income and cost by calendar month.
 *
 * Income is passed in already bucketed, because working out which month a
 * sale belongs to is the sales module's job and doing it twice is how two
 * screens come to disagree. */
export function monthlyTrend(
  incomeByMonth: ReadonlyMap<string, number>,
  expenses: readonly ExpenseRow[],
  months: readonly string[],
): MonthlyPoint[] {
  const spend = new Map<string, number>();
  for (const e of expenses) {
    const m = e.incurredOn.slice(0, 7);
    spend.set(m, (spend.get(m) || 0) + e.amountUsd);
  }
  return months.map((month) => {
    const income = round2(incomeByMonth.get(month) || 0);
    const out = round2(spend.get(month) || 0);
    return { month, income, expenses: out, netProfit: round2(income - out) };
  });
}

/** The last `count` calendar months, oldest first, as YYYY-MM. */
export function recentMonths(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Runway
 * ------------------------------------------------------------------------ */

/** How many months the shop could keep paying its fixed costs if it sold
 * nothing at all, given what it has made recently.
 *
 * Null when the fixed costs are zero (nothing to run out of) or when the
 * shop is not yet profitable -- in which case "runway" would be a negative
 * number pretending to be a forecast, and the screen should say that the
 * business is not covering its costs instead of dressing it up. */
export function monthsOfRunway(
  averageMonthlyProfit: number,
  monthlyFixedCost: number,
): number | null {
  if (monthlyFixedCost <= 0) return null;
  if (averageMonthlyProfit <= 0) return null;
  return round2(averageMonthlyProfit / monthlyFixedCost);
}
