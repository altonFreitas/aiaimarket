import { describe, it, expect } from "vitest";
import {
  profitAndLoss, dueRecurring, monthlyCommitment, monthlyTrend,
  recentMonths, monthsOfRunway,
  type ExpenseRow, type RecurringRow, type FinanceLine,
} from "@/lib/finance";
import {
  EXPENSE_ACCOUNTS, accountLabelKey, accountHintKey, annualCost, monthlyCost,
  isExpenseAccount, PLATFORM_ACCOUNTS,
} from "@/lib/accounts";
import { STR } from "@/lib/i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* AFTER EVERYTHING, HOW MUCH IS LEFT.
 *
 * Every other number in this application is about merchandise. This is the
 * arithmetic that turns those into a business, and the one thing it must
 * never do is flatter: a profit figure somebody makes decisions on has to
 * be the real one, including when the real one is negative.
 */

const line = (over: Partial<FinanceLine> = {}): FinanceLine =>
  ({ sellerId: null, netSales: 100, cost: 60, ...over });

const exp = (over: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id: "e" + Math.random(), account: "hosting", vendor: "Supabase",
  description: "", amountUsd: 25, incurredOn: "2026-09-01",
  periodStart: null, periodEnd: null, note: "", ...over,
});

const sub = (over: Partial<RecurringRow> = {}): RecurringRow => ({
  id: "r1", account: "hosting", vendor: "Supabase", description: "",
  amountUsd: 25, cadence: "monthly", dayOfMonth: 1,
  startedOn: "2026-01-01", endedOn: null, ...over,
});

const base = {
  lines: [] as FinanceLine[], commission: 0, deliveryFees: 0, refunds: 0,
  expenses: [] as ExpenseRow[],
};

describe("the marketplace split", () => {
  /* THE ONE STRUCTURAL THING. There are two businesses in one set of
   * books, and adding them together would show a profit the shop never
   * had. */

  it("counts the shop's own goods as revenue and their cost as a cost", () => {
    const pl = profitAndLoss({ ...base, lines: [line({ netSales: 100, cost: 60 })] });
    expect(pl.ownSales).toBe(100);
    expect(pl.ownCost).toBe(60);
    expect(pl.ownGrossProfit).toBe(40);
  });

  it("never counts another seller's sale as the shop's revenue", () => {
    // The whole point. The sale price was never the shop's money -- only
    // the commission is income, the rest is owed to the seller.
    const pl = profitAndLoss({
      ...base,
      lines: [line({ sellerId: "s1", netSales: 900, cost: null })],
      commission: 90,
    });
    expect(pl.ownSales).toBe(0);
    expect(pl.marketplaceGross).toBe(900);
    expect(pl.commission).toBe(90);
    // 90 of income, not 900.
    expect(pl.totalIncome).toBe(90);
  });

  it("treats a line with no seller as the shop's own", () => {
    // That is how a product with no marketplace seller has always been
    // stored, and the accounts have to agree with the storage.
    const pl = profitAndLoss({ ...base, lines: [line({ sellerId: null })] });
    expect(pl.ownSales).toBe(100);
  });

  it("treats the shop's own seller row as the shop's own", () => {
    const pl = profitAndLoss({
      ...base, lines: [line({ sellerId: "me" })], ownSellerId: "me",
    });
    expect(pl.ownSales).toBe(100);
    expect(pl.marketplaceGross).toBe(0);
  });
});

describe("cost coverage", () => {
  it("reports what share of own sales has a known cost", () => {
    // A margin quoted over 40% coverage describes under half the business,
    // and the screen has to be able to say so.
    const pl = profitAndLoss({
      ...base,
      lines: [line({ netSales: 40, cost: 20 }), line({ netSales: 60, cost: null })],
    });
    expect(pl.costCoverage).toBeCloseTo(0.4);
  });

  it("is zero when nothing sold, not NaN", () => {
    expect(profitAndLoss(base).costCoverage).toBe(0);
  });

  it("does not let an uncosted line inflate the cost side", () => {
    const pl = profitAndLoss({
      ...base, lines: [line({ netSales: 100, cost: null })],
    });
    expect(pl.ownCost).toBe(0);
    expect(pl.ownGrossProfit).toBe(100);
  });
});

describe("the bottom line", () => {
  it("subtracts running costs from income", () => {
    const pl = profitAndLoss({
      ...base,
      lines: [line({ netSales: 100, cost: 60 })],   // 40 gross
      commission: 10,
      deliveryFees: 5,
      expenses: [exp({ amountUsd: 25 })],
    });
    expect(pl.totalIncome).toBe(55);
    expect(pl.expensesTotal).toBe(25);
    expect(pl.netProfit).toBe(30);
  });

  it("reports a loss as a loss", () => {
    // The number somebody makes decisions on has to be the real one,
    // including when it is negative. Clamping at zero here would be the
    // single most expensive line of code in the application.
    const pl = profitAndLoss({ ...base, expenses: [exp({ amountUsd: 200 })] });
    expect(pl.netProfit).toBe(-200);
  });

  it("takes refunds off income", () => {
    const pl = profitAndLoss({
      ...base, lines: [line({ netSales: 100, cost: 0 })], refunds: 30,
    });
    expect(pl.totalIncome).toBe(70);
  });

  it("returns a null margin rather than zero when there was no income", () => {
    // "We earned nothing" and "we earned nothing per dollar" are different
    // statements, and only one of them is true here.
    expect(profitAndLoss(base).netMargin).toBeNull();
  });
});

describe("expenses by account", () => {
  it("adds up each account and sorts by size", () => {
    const pl = profitAndLoss({
      ...base,
      expenses: [
        exp({ account: "hosting", amountUsd: 25 }),
        exp({ account: "hosting", amountUsd: 20 }),
        exp({ account: "domain", amountUsd: 12 }),
      ],
    });
    expect(pl.byAccount.map((a) => [a.account, a.total]))
      .toEqual([["hosting", 45], ["domain", 12]]);
  });

  it("says who inside an account was actually paid", () => {
    // THE POINT OF THE BREAKDOWN. "Software and licences: $276" is a
    // filing cabinet, not an answer -- it cannot be acted on. "$276, of
    // which Supabase is $253" says what to cancel.
    const pl = profitAndLoss({
      ...base,
      expenses: [
        exp({ account: "software", vendor: "Supabase", amountUsd: 23 }),
        exp({ account: "software", vendor: "Supabase", amountUsd: 230 }),
        exp({ account: "software", vendor: "Claude Code", amountUsd: 20 }),
      ],
    });
    expect(pl.byAccount[0].vendors.map((v) => [v.vendor, v.total]))
      .toEqual([["Supabase", 253], ["Claude Code", 20]]);
  });

  it("measures a vendor against its own account, not the whole business", () => {
    // "Half our software spend is one licence" is the sentence this
    // supports, and dividing by total costs would not say that.
    const pl = profitAndLoss({
      ...base,
      expenses: [
        exp({ account: "software", vendor: "A", amountUsd: 25 }),
        exp({ account: "software", vendor: "B", amountUsd: 75 }),
        exp({ account: "staff", vendor: "C", amountUsd: 900 }),
      ],
    });
    const software = pl.byAccount.find((a) => a.account === "software")!;
    expect(software.vendors.map((v) => v.share)).toEqual([0.75, 0.25]);
  });

  it("keeps one vendor's two accounts apart", () => {
    // The bank charging for a transfer and for a card terminal is not one
    // cost, and a flat vendor key would have merged them.
    const pl = profitAndLoss({
      ...base,
      expenses: [
        exp({ account: "bank_fees", vendor: "BNU", amountUsd: 5 }),
        exp({ account: "software", vendor: "BNU", amountUsd: 30 }),
      ],
    });
    expect(pl.byAccount.find((a) => a.account === "bank_fees")!.vendors)
      .toEqual([{ vendor: "BNU", total: 5, share: 1 }]);
    expect(pl.byAccount.find((a) => a.account === "software")!.vendors)
      .toEqual([{ vendor: "BNU", total: 30, share: 1 }]);
  });

  it("still counts a cost with no vendor recorded", () => {
    // Dropping it would make the breakdown add up to less than the line it
    // opens under, which is the one thing a breakdown must never do.
    const pl = profitAndLoss({
      ...base,
      expenses: [
        exp({ account: "other", vendor: "", amountUsd: 10 }),
        exp({ account: "other", vendor: "Someone", amountUsd: 5 }),
      ],
    });
    const other = pl.byAccount.find((a) => a.account === "other")!;
    expect(other.vendors.reduce((n, v) => n + v.total, 0)).toBe(other.total);
    expect(other.vendors.map((v) => v.vendor)).toContain("");
  });

  it("omits an account nobody filed against", () => {
    // A chart of twelve accounts showing nine zeroes is a chart nobody
    // reads.
    const pl = profitAndLoss({ ...base, expenses: [exp({ account: "domain" })] });
    expect(pl.byAccount).toHaveLength(1);
  });

  it("adds up what the website itself costs", () => {
    // Hosting, software and domain: the three that bill whether or not
    // anything sells.
    const pl = profitAndLoss({
      ...base,
      expenses: [
        exp({ account: "hosting", amountUsd: 25 }),
        exp({ account: "domain", amountUsd: 12 }),
        exp({ account: "software", amountUsd: 8 }),
        exp({ account: "staff", amountUsd: 500 }),
      ],
    });
    expect(pl.platformCost).toBe(45);
    expect(pl.expensesTotal).toBe(545);
  });
});

describe("what is due", () => {
  const now = new Date("2026-09-15T00:00:00Z");

  it("lists a monthly cost that has not been confirmed this month", () => {
    const due = dueRecurring([sub()], new Set(), now);
    expect(due).toHaveLength(1);
    expect(due[0].periodStart).toBe("2026-09-01");
    expect(due[0].periodEnd).toBe("2026-09-30");
  });

  it("does not list one that was already confirmed", () => {
    // A cost recorded twice is a month's books wrong by $25 with nothing
    // to say why.
    expect(dueRecurring([sub()], new Set(["r1|2026-09-01"]), now)).toEqual([]);
  });

  it("marks a bill whose day has passed as overdue", () => {
    expect(dueRecurring([sub({ dayOfMonth: 1 })], new Set(), now)[0].overdue).toBe(true);
    expect(dueRecurring([sub({ dayOfMonth: 28 })], new Set(), now)[0].overdue).toBe(false);
  });

  it("puts overdue first", () => {
    const due = dueRecurring([
      sub({ id: "late", dayOfMonth: 1 }),
      sub({ id: "soon", dayOfMonth: 28 }),
    ], new Set(), now);
    expect(due.map((d) => d.recurring.id)).toEqual(["late", "soon"]);
  });

  it("stops listing a cancelled subscription", () => {
    // The row stays -- the history of having paid for it is worth more
    // than the tidiness -- but it is not owed any more.
    expect(dueRecurring([sub({ endedOn: "2026-08-31" })], new Set(), now)).toEqual([]);
  });

  it("anchors a quarterly cost on the calendar quarter", () => {
    // The less clever answer and the right one: an owner reconciling
    // against a bank statement is reading calendar months, and a period
    // running from the 14th of February matches nothing they can see.
    const due = dueRecurring([sub({ cadence: "quarterly" })], new Set(), now);
    expect([due[0].periodStart, due[0].periodEnd]).toEqual(["2026-07-01", "2026-09-30"]);
  });

  it("anchors a yearly cost on the calendar year", () => {
    const due = dueRecurring([sub({ cadence: "yearly" })], new Set(), now);
    expect([due[0].periodStart, due[0].periodEnd]).toEqual(["2026-01-01", "2026-12-31"]);
  });
});

describe("monthlyCommitment", () => {
  it("puts every cadence on the same footing", () => {
    // Three subscriptions on three cadences cannot be compared or added
    // until they are all expressed per month.
    const total = monthlyCommitment([
      sub({ id: "a", amountUsd: 25, cadence: "monthly" }),
      sub({ id: "b", amountUsd: 30, cadence: "quarterly" }),   // 10/mo
      sub({ id: "c", amountUsd: 120, cadence: "yearly" }),     // 10/mo
    ], new Date("2026-09-15T00:00:00Z"));
    expect(total).toBe(45);
  });

  it("ignores a subscription that has been stopped", () => {
    expect(monthlyCommitment(
      [sub({ endedOn: "2026-01-01" })], new Date("2026-09-15T00:00:00Z"))).toBe(0);
  });
});

describe("the trend", () => {
  it("buckets costs by the month they were incurred", () => {
    const points = monthlyTrend(
      new Map([["2026-08", 100], ["2026-09", 200]]),
      [exp({ incurredOn: "2026-08-04", amountUsd: 30 }),
       exp({ incurredOn: "2026-09-01", amountUsd: 25 })],
      ["2026-08", "2026-09"]);
    expect(points).toEqual([
      { month: "2026-08", income: 100, expenses: 30, netProfit: 70 },
      { month: "2026-09", income: 200, expenses: 25, netProfit: 175 },
    ]);
  });

  it("shows a month with costs and no income as a loss", () => {
    const points = monthlyTrend(new Map(), [exp({ incurredOn: "2026-09-01", amountUsd: 25 })],
      ["2026-09"]);
    expect(points[0].netProfit).toBe(-25);
  });

  it("lists the requested months oldest first, even when empty", () => {
    const months = recentMonths(3, new Date("2026-09-15T00:00:00Z"));
    expect(months).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
});

describe("runway", () => {
  it("says how many months of fixed cost the profit covers", () => {
    expect(monthsOfRunway(100, 25)).toBe(4);
  });

  it("refuses to dress up a loss as a forecast", () => {
    // A negative runway is a number pretending to be a prediction. The
    // screen should say the business is not covering its costs instead.
    expect(monthsOfRunway(-50, 25)).toBeNull();
    expect(monthsOfRunway(0, 25)).toBeNull();
  });

  it("is null when there are no fixed costs to run out of", () => {
    expect(monthsOfRunway(100, 0)).toBeNull();
  });
});

describe("the chart of accounts", () => {
  it("can name every account, in all three languages", () => {
    // The invariant the delivery zones violated: an id with no translation
    // renders as the raw key at whoever is reading the screen.
    for (const a of EXPENSE_ACCOUNTS) {
      expect([a, accountLabelKey(a) in STR]).toEqual([a, true]);
      expect([a, accountHintKey(a) in STR]).toEqual([a, true]);
      expect([a, STR[accountLabelKey(a)].filter(Boolean).length]).toEqual([a, 3]);
    }
  });

  it("matches the check constraint in the migration", () => {
    // Two lists that can disagree is how an account gets added in the UI
    // and rejected by the database.
    const sql = readFileSync(
      resolve(__dirname, "../supabase/operating-costs.sql"), "utf8");
    for (const a of EXPENSE_ACCOUNTS) {
      expect([a, sql.includes(`'${a}'`)]).toEqual([a, true]);
    }
  });

  it("accepts only accounts it knows", () => {
    expect(EXPENSE_ACCOUNTS.every(isExpenseAccount)).toBe(true);
    for (const bad of ["Hosting", "server", "", null, undefined]) {
      expect([bad, isExpenseAccount(bad as string)]).toEqual([bad, false]);
    }
  });

  it("counts hosting, software and domain as the cost of being online", () => {
    expect([...PLATFORM_ACCOUNTS].sort()).toEqual(["domain", "hosting", "software"]);
  });

  it("converts a cadence to a year and to a month", () => {
    expect(annualCost(25, "monthly")).toBe(300);
    expect(annualCost(120, "yearly")).toBe(120);
    expect(monthlyCost(30, "quarterly")).toBe(10);
  });
});
