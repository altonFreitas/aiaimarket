import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { rollupTotals, type RollupRow } from "@/lib/data/salesRollup";

/* THE ROLLUP THE DASHBOARD READS INSTEAD OF THE ORDER BOOK.
 *
 * tests/rls/salesRollup.test.ts proves the VIEW agrees with
 * buildSalesLines against a real Postgres, which is the claim that matters
 * and the one only a database can answer. These are the parts that do not
 * need one: the arithmetic on this side, and the promises the reader and
 * the cron make about a shop whose migration has not been run.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const row = (over: Partial<RollupRow> = {}): RollupRow => ({
  day: "2026-09-03", status: "completed", sellerId: null, categoryId: null,
  hasCost: true, orders: 1, qty: 2, netSales: 30, cost: 12, discount: 0,
  linesWithoutCost: 0, lines: 1, ...over,
});

describe("summing the rollup", () => {
  it("adds the money and keeps its cents", () => {
    const out = rollupTotals([
      row({ netSales: 0.1, cost: 0.05 }),
      row({ netSales: 0.2, cost: 0.05 }),
    ]);
    expect(out.netSales).toBe(0.3);
    expect(out.cost).toBe(0.1);
    expect(out.grossProfit).toBe(0.2);
  });

  it("filters before it sums", () => {
    const out = rollupTotals(
      [row({ status: "completed", netSales: 50 }),
       row({ status: "cancelled", netSales: 99 })],
      (r) => r.status !== "cancelled");
    expect(out.netSales).toBe(50);
  });

  it("carries how much of the margin it could not see", () => {
    /* A margin computed over half-costed lines is a lie with a decimal
       point. The count travels with the figure so a screen can say so. */
    const out = rollupTotals([row({ linesWithoutCost: 0 }), row({ linesWithoutCost: 3 })]);
    expect(out.linesWithoutCost).toBe(3);
  });

  it("sums nothing to zero rather than to NaN", () => {
    expect(rollupTotals([])).toEqual({
      orders: 0, qty: 0, netSales: 0, cost: 0, discount: 0,
      grossProfit: 0, linesWithoutCost: 0,
    });
  });
});

describe("a shop that has not run the migration", () => {
  const READER = code("src/lib/data/salesRollup.ts");
  const CRON = code("src/app/api/cron/refresh-analytics/route.ts");

  it("gets an unready answer, not an exception", () => {
    /* The dashboard it already had must keep working exactly as it did.
       This is an addition, and it has to behave like one on the day the
       code ships and the SQL has not been pasted yet. */
    expect(READER).toMatch(/const EMPTY: Rollup = \{ ready: false, rows: \[\], orders: \[\] \};/);
    expect(READER).toMatch(/if \(error \|\| !data\) return EMPTY;/);
    expect(READER).toMatch(/\} catch \{\s*\n?\s*return EMPTY;/);
  });

  it("makes callers branch on ready rather than on emptiness", () => {
    // No rows is a real answer for a shop with no sales. "There is no
    // view" is not the same answer and must not look like it.
    expect(READER).toMatch(/ready: boolean;/);
    expect(READER).toMatch(/ready: true,/);
  });

  it("does not page anybody every hour for a file nobody ran", () => {
    expect(CRON).toMatch(/code === "42883" \|\| code === "PGRST202"/);
    expect(CRON).toMatch(/skipped: "migration not run"/);
  });
});

describe("the refresh behaves like the other crons", () => {
  const CRON = code("src/app/api/cron/refresh-analytics/route.ts");

  it("fails closed without a secret", () => {
    expect(CRON).toMatch(/const secret = process\.env\.CRON_SECRET \|\| "";/);
    expect(CRON).toMatch(/if \(!secret\) return false;/);
    expect(CRON).toMatch(/crypto\.timingSafeEqual/);
  });

  it("is scheduled, and not on top of another cron's minute", () => {
    /* A materialized view nothing rebuilds holds the figures from the day
       it was created for ever, and says nothing about it. */
    const vercel = JSON.parse(read("vercel.json")) as
      { crons: Array<{ path: string; schedule: string }> };
    const mine = vercel.crons.find((c) => c.path === "/api/cron/refresh-analytics");
    expect(mine, "the refresh cron in vercel.json").toBeTruthy();
    const minutes = vercel.crons.map((c) => c.schedule.split(" ")[0]);
    expect(new Set(minutes).size, "two crons on the same minute").toBe(minutes.length);
  });
});

describe("what the view promises about itself", () => {
  const SQL = read("supabase/sales-rollup.sql");

  it("can be rebuilt without locking the dashboard out", () => {
    /* A plain REFRESH takes an exclusive lock and every reader waits
       behind it -- which on an hourly schedule means the dashboard is
       unavailable at twenty past, every hour, for as long as the rebuild
       takes. */
    expect(SQL).toMatch(/refresh materialized view concurrently sales_daily/);
  });

  it("has the unique index a concurrent refresh needs", () => {
    // On a column, not an expression: Postgres refuses an expression index
    // for this, which is how the first version failed.
    expect(SQL).toMatch(/create unique index if not exists sales_daily_grain on sales_daily \(grain\)/);
  });

  it("populates itself the first time, when concurrent is not allowed yet", () => {
    // A view that has never been populated cannot be refreshed
    // concurrently, so a shop that has just run the file would otherwise
    // get an error instead of its first set of figures.
    expect(SQL).toMatch(/relispopulated/);
    expect(SQL).toMatch(/else\s*\n\s*refresh materialized view sales_daily;/);
  });

  it("is not readable with the public key", () => {
    // Every row is the shop's takings and its margin.
    expect(SQL).toMatch(/revoke all on sales_daily from anon, authenticated/);
    expect(SQL).toMatch(/revoke all on function refresh_sales_daily\(\) from public, anon, authenticated/);
  });
});

describe("which source the dashboard reads", () => {
  const PAGE = code("src/app/admin/page.tsx");

  it("does not ask a daily rollup for an hourly chart", () => {
    /* "1d" is the one range bucketed by hour. A rollup by DAY cannot draw
       one, and the decision is made from the range alone -- before any
       read -- so the page never pays for orders it will not use, and never
       asks the rollup for something it cannot answer. */
    expect(PAGE).toMatch(/const daily = canSales && rangeSpec\(range\)\.bucket !== "hour";/);
  });

  it("still reads the order book when the view is not there", () => {
    // A shop that has not pasted the SQL must see exactly the dashboard it
    // had yesterday.
    expect(PAGE).toMatch(/const fromRollup = daily && rollup\.ready;/);
    expect(PAGE).toMatch(/adminSalesData\(\{ withOrders: !fromRollup \}\)/);
  });

  it("counts orders from the view built to count them", () => {
    /* sales_daily groups by seller and category: an order holding a shirt
       and a football is a row in each, so summing its `orders` column
       would say two. */
    expect(PAGE).toMatch(/rollupOrderCount\(rollup\.orders, from, to,/);
    /* EVERY use of the grouped rows goes to rollupLines and nowhere else.
       A window-based "does not contain" was the first attempt and it was
       loose: the page legitimately mentions rollup.rows and rollup.orders
       within a few lines of each other. */
    const uses = PAGE.match(/rollup\.rows/g) ?? [];
    expect(uses.length).toBe(1);
    expect(PAGE).toMatch(/rollupLines\(rollup\.rows, sales\.categories, sales\.sellers\)/);
  });

  it("builds the lines once, not twice", () => {
    /* The profit and loss called buildSalesLines a SECOND time over the
       same orders -- the same work twice a load, and a standing invitation
       for it to be computed from a different set than the revenue card
       above it. */
    expect((PAGE.match(/buildSalesLines\(/g) ?? []).length).toBe(1);
  });

  it("does not read the returns map it no longer nets with", () => {
    // The rollup is already netted; asking would be a second read of a
    // table nothing on that path consults.
    expect(PAGE).toMatch(/canSales && !fromRollup \? returnedUnits\(\)/);
  });
});
