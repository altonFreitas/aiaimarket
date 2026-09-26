import { describe, it, expect, beforeAll } from "vitest";
import { DATABASE_URL, sql, scalar } from "./db";
import { buildSalesLines, LIVE_STATUSES, returnKey } from "@/lib/sales";
import { headlineMetrics, overviewSeries } from "@/lib/overview";
import { rollupLines, rollupOrderCount, type DayOrders, type RollupRow } from "@/lib/data/salesRollup";
import { STORE_TZ } from "@/lib/tz";
import fs from "node:fs";
import path from "node:path";
import type { Category, Order, Product, Seller } from "@/lib/types";

/* THE VIEW HAS TO AGREE WITH THE ARITHMETIC IT REPLACES.
 *
 * sales_daily exists so the dashboard stops shipping 11 MB of order lines
 * to compute figures it could be handed. That is only worth having if the
 * figures are the SAME figures: a faster dashboard that quietly disagrees
 * with the one the shop has been reading for a year is worse than a slow
 * one, because nobody can tell which number is the takings.
 *
 * So this seeds a small awkward shop -- two categories, a seller that
 * exists and one that does not, a costed line, an uncosted line, a
 * discount, a partial return, a cancellation, and an order placed at 07:15
 * in Dili which is the previous day in UTC -- and asserts that grouping
 * buildSalesLines() in JavaScript gives exactly what the view gives.
 *
 * Only a real Postgres can answer this. A mock would return whatever this
 * file told it to.
 */

const RUN = Boolean(DATABASE_URL);
const describeDb = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "\n  Sales rollup tests SKIPPED: set TEST_DATABASE_URL to a database\n" +
    "  with supabase/ci-bootstrap.sql + supabase/run-all.sql applied.\n");
}

const SELLER = "e1111111-1111-1111-1111-111111111111";
/* A SECOND REAL SELLER, so a line can name a different one from the
   product it points at. That happens whenever a product is reassigned
   after a sale, and the line is the one that was true at the time --
   mutating the view to group by the PRODUCT's seller instead survived the
   first version of this fixture, because every line in it agreed with its
   product. */
const SELLER2 = "e2222222-2222-2222-2222-222222222222";
const GHOST_SELLER = "f1111111-1111-1111-1111-111111111111";
const P1 = "a0000000-0000-0000-0000-000000000001";
const P2 = "a0000000-0000-0000-0000-000000000002";
const P3 = "a0000000-0000-0000-0000-000000000003";
const C1 = "c1111111-1111-1111-1111-111111111111";
const C2 = "c2222222-2222-2222-2222-222222222222";

function json<T>(statement: string): T[] {
  /* jsonb_agg, not json_agg. json_agg prints its elements across several
     lines, and db.ts splits psql's output into rows -- so the first line of
     a multi-line array came back as the whole answer and JSON.parse threw.
     jsonb normalises to one compact line. */
  const raw = scalar(`select coalesce(jsonb_agg(t), '[]'::jsonb)::text from (${statement}) t`);
  return raw ? (JSON.parse(raw) as T[]) : [];
}

/** The view's own grain, computed in JavaScript from a line.
 *
 * `hasCost` is part of it because gross profit is computed over the revenue
 * that has a cost behind it: a group mixing costed and uncosted lines
 * cannot say what its margin base is, so the view splits them. */
const grainOf = (
  day: string, status: string, seller: string | null, cat: string | null,
  hasCost: boolean,
) => `${day}|${status}|${seller ?? ""}|${cat ?? ""}|${hasCost}`;

const money = (n: number) => Math.round(n * 1e6) / 1e6;

describeDb("sales_daily says what buildSalesLines says", () => {
  beforeAll(() => {
    sql(`delete from order_return_items; delete from order_returns;
         delete from order_items; delete from orders;`);
    sql(`insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555')
           on conflict do nothing`);
    sql(`insert into categories (id, name, slug, sort_order) values
           ('${C1}','Clothing','clothing',1), ('${C2}','Fitness','fitness',2)
           on conflict do nothing`);
    sql(`insert into auth.users (id) values ('66666666-6666-6666-6666-666666666666')
           on conflict do nothing`);
    sql(`insert into sellers (id, user_id, store_name, slug, status, phone, email) values
           ('${SELLER}','55555555-5555-5555-5555-555555555555','Loja A','loja-a',
            'approved','+6701','a@x.tl'),
           ('${SELLER2}','66666666-6666-6666-6666-666666666666','Loja B','loja-b',
            'approved','+6702','b@x.tl') on conflict do nothing`);
    sql(`insert into products (id, ref, name, slug, price, qty, status, stock_status,
                               description, images, category_id, seller_id) values
           ('${P1}','R1','Kamiza','kamiza',20,100,'approved','in','','{}','${C1}','${SELLER}'),
           ('${P2}','R2','Bola','bola',15,100,'approved','in','','{}','${C2}','${SELLER}'),
           -- A seller id naming no seller row: the marketplace's own stock.
           ('${P3}','R3','Xapeu','xapeu',9,100,'approved','in','','{}',null,'${GHOST_SELLER}')
         on conflict do nothing`);
    /* P2 has a live cost and no snapshot; P1 has BOTH, and they differ --
       which is what makes "the snapshot wins" a testable claim. With only
       one of the two present, reversing the coalesce changed nothing and
       the mutation survived. */
    sql(`insert into product_costs (product_id, cost_price) values
           ('${P2}', 6), ('${P1}', 3) on conflict do nothing`);

    /* 22:15 UTC on the 2nd is 07:15 on the 3rd in Dili. If the view buckets
       by UTC this order files under the wrong day and the totals below
       disagree -- which is the bug src/lib/tz.ts exists to prevent, moved
       into SQL. */
    sql(`insert into orders (id, ref, buyer_name, buyer_phone, items, subtotal, fee,
                             total, status, mode, pay_method, created_at) values
      ('b0000000-0000-0000-0000-000000000001','O1','Ana','+6701',
       '[{"product_id":"${P1}","name":"Kamiza","qty":3,"price":18,"cost":11,"size":"M","seller_id":"${SELLER}"},
         {"product_id":"${P2}","name":"Bola","qty":2,"price":15,"size":"","seller_id":"${SELLER}"}]'::jsonb,
       84,1,85,'completed','delivery','cod','2026-09-02T22:15:00Z'),
      ('b0000000-0000-0000-0000-000000000002','O2','Beto','+6702',
       '[{"product_id":"${P3}","name":"Xapeu","qty":5,"price":9,"size":""}]'::jsonb,
       45,1,46,'confirmed','delivery','cod','2026-09-03T05:00:00Z'),
      ('b0000000-0000-0000-0000-000000000003','O3','Caio','+6703',
       '[{"product_id":"${P1}","name":"Kamiza","qty":4,"price":20,"cost":11,"size":"L","seller_id":"${SELLER}"}]'::jsonb,
       80,1,81,'cancelled','delivery','cod','2026-09-04T03:00:00Z'),
      /* SOLD ABOVE TODAY'S PRICE, by a seller who no longer owns the
         product. The shirt went out at 25 and has since been cut to 20:
         reconstructing the list price as "whatever the product says now"
         would turn that into a discount of MINUS five a unit. And the line
         names Loja B while the product now belongs to Loja A. */
      ('b0000000-0000-0000-0000-000000000004','O4','Dita','+6704',
       '[{"product_id":"${P1}","name":"Kamiza","qty":3,"price":25,"cost":11,"size":"S","seller_id":"${SELLER2}"}]'::jsonb,
       75,1,76,'completed','delivery','cod','2026-09-05T03:00:00Z'),
      /* MORE COMES BACK THAN WENT OUT. A data error, and the view must
         floor it at zero rather than let it become negative revenue that
         quietly cancels a real sale somewhere else in the total. */
      ('b0000000-0000-0000-0000-000000000005','O5','Edu','+6705',
       '[{"product_id":"${P2}","name":"Bola","qty":3,"price":15,"size":"","seller_id":"${SELLER}"}]'::jsonb,
       45,1,46,'completed','delivery','cod','2026-09-06T03:00:00Z')`);

    sql(`insert into order_returns (id, order_id, ref, reason, refund_total) values
           ('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
            'RET1','changed_mind',36) on conflict do nothing`);
    sql(`insert into order_return_items (return_id, product_id, product_name, qty) values
           ('d0000000-0000-0000-0000-000000000001','${P1}','Kamiza',2)`);
    sql(`insert into order_returns (id, order_id, ref, reason, refund_total) values
           ('d0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000005',
            'RET2','damaged',75) on conflict do nothing`);
    sql(`insert into order_return_items (return_id, product_id, product_name, qty) values
           ('d0000000-0000-0000-0000-000000000002','${P2}','Bola',5)`);

    sql(`select refresh_sales_daily()`);
  });

  it("agrees on every figure, for every group", () => {
    const orders = json<Order>(`select * from orders`);
    const products = json<Product>(`select * from products`);
    const categories = json<Category>(`select * from categories`);
    const sellers = json<Seller>(`select * from sellers`);
    const costRows = json<{ product_id: string; cost_price: number }>(
      `select product_id, cost_price from product_costs`);
    const returnRows = json<{ order_id: string; product_id: string; qty: number }>(
      `select r.order_id, ri.product_id, sum(ri.qty) as qty
         from order_return_items ri join order_returns r on r.id = ri.return_id
        where ri.product_id is not null group by 1, 2`);

    const returns = new Map(
      returnRows.map((r) => [returnKey(r.order_id, r.product_id), Number(r.qty)]));
    const costs = new Map(costRows.map((c) => [c.product_id, Number(c.cost_price)]));

    const lines = buildSalesLines(orders, {
      products, categories, sellers, costs, returns,
    });
    expect(lines.length, "the fixture produced lines").toBeGreaterThan(0);

    /* THE SAME GROUPING THE VIEW DOES. Note sellerId: buildSalesLines
       resolves a seller id naming no seller row to null, and
       sync_order_items nulls the same reference when it builds the row --
       the two have to agree on that, and this is where it is proved. */
    const mine = new Map<string, { qty: number; net: number; cost: number; disc: number }>();
    for (const l of lines) {
      const key = grainOf(l.date, l.status, l.sellerId, l.categoryId, l.cost != null);
      const at = mine.get(key) ?? { qty: 0, net: 0, cost: 0, disc: 0 };
      at.qty += l.qty;
      at.net += l.netSales;
      at.cost += l.cost ?? 0;
      at.disc += l.discount;
      mine.set(key, at);
    }

    const theirs = json<{
      grain: string; qty: string; net_sales: string; cost: string; discount: string;
    }>(`select grain, qty, net_sales, cost, discount from sales_daily`);

    expect(theirs.length, "the view produced rows").toBe(mine.size);
    for (const row of theirs) {
      const want = mine.get(row.grain);
      expect(want, `the view has a group JavaScript does not: ${row.grain}`).toBeTruthy();
      expect(Number(row.qty), `qty for ${row.grain}`).toBe(want!.qty);
      expect(money(Number(row.net_sales)), `net sales for ${row.grain}`).toBe(money(want!.net));
      expect(money(Number(row.cost)), `cost for ${row.grain}`).toBe(money(want!.cost));
      expect(money(Number(row.discount)), `discount for ${row.grain}`).toBe(money(want!.disc));
    }
  });

  it("files a sale on the shop's day, not on UTC's", () => {
    /* The order placed at 22:15 UTC on the 2nd was rung up at 07:15 on the
       3rd in Dili. Bucketing by UTC would file about a third of trading
       hours under yesterday. */
    /* Ana's order, by the shirt she bought: placed at 22:15 UTC on the
       2nd, which is 07:15 on the 3rd where the shop is. */
    const day = scalar(
      `select day::text from sales_daily
        where status = 'completed' and category_id = '${C1}' and qty = 1`);
    expect(day).toBe("2026-09-03");
  });

  it("keeps a cancelled order visible rather than dropping it", () => {
    // The callers filter by status. A view that silently excluded them
    // would make "cancelled" unanswerable rather than zero.
    expect(scalar(`select qty::text from sales_daily where status = 'cancelled'`)).toBe("4");
  });

  it("nets a return out of the day it was sold on", () => {
    // Three shirts sold, two returned: one shirt of revenue, not three.
    const row = scalar(
      `select qty || ' ' || net_sales from sales_daily
        where status = 'completed' and category_id = '${C1}'`);
    expect(row).toBe("1 18.00");
  });

  it("says how much of the cost figure is real", () => {
    /* A margin computed over lines that are half-costed is a lie with a
       decimal point. The hat has no cost anywhere -- no snapshot, no
       product_costs row -- and the view says so instead of calling it
       free. */
    expect(scalar(
      `select lines_without_cost::text from sales_daily where status = 'confirmed'`)).toBe("1");
    expect(Number(scalar(
      `select cost from sales_daily where status = 'confirmed'`))).toBe(0);
  });

  it("does not invent a discount out of a later price cut", () => {
    /* The shirt was sold at 25 and the shop has since cut it to 20.
       Reconstructing the list price as "whatever it says now" would make
       that a discount of minus five a unit, which would show up as
       NEGATIVE money given away. */
    const disc = scalar(
      `select discount from sales_daily where day = '2026-09-05'`);
    expect(Number(disc)).toBe(0);
  });

  it("credits the seller the line names, not the one the product has now", () => {
    // A product reassigned after a sale does not move last month's takings
    // to its new owner.
    expect(scalar(
      `select seller_id::text from sales_daily where day = '2026-09-05'`)).toBe(SELLER2);
  });

  it("floors a return bigger than the order at zero", () => {
    // Three went out, five came back: a data error, and it must not become
    // negative revenue cancelling out a real sale elsewhere.
    expect(Number(scalar(`select qty from sales_daily where day = '2026-09-06'`))).toBe(0);
    expect(Number(scalar(`select net_sales from sales_daily where day = '2026-09-06'`))).toBe(0);
  });

  it("prefers the cost snapshot to today's cost", () => {
    /* The shirt cost 11 when it was sold and product_costs now says 3.
       What it cost then is what the margin for then is made of. */
    expect(Number(scalar(`select cost from sales_daily where day = '2026-09-05'`))).toBe(33);
  });

  it("can be refreshed again without locking the dashboard out", () => {
    // The second refresh is the concurrent one; the first populated it.
    const r = sql(`select refresh_sales_daily()`);
    expect(r.ok, r.error).toBe(true);
  });
});

describe("the shop's day is one definition", () => {
  it("is the same zone in the view as in the code", () => {
    /* WRITTEN TWICE and it has to be. A materialized view cannot read an
       environment variable, so the zone is a literal in the SQL and a
       constant in tz.ts -- and if they drift every figure on the dashboard
       moves by nine hours, silently, with no error anywhere. */
    const SQL_FILE = fs.readFileSync(
      path.join(process.cwd(), "supabase/sales-rollup.sql"), "utf8");
    const m = /at time zone '([^']+)'/.exec(SQL_FILE);
    expect(m, "the timezone literal in sales-rollup.sql").not.toBeNull();
    expect(m![1]).toBe(STORE_TZ);
  });
});


/* ---------------------------------------------------------------------------
   THE DASHBOARD ITSELF, COMPUTED BOTH WAYS
   ---------------------------------------------------------------------------
   The test above proves the VIEW sums to what buildSalesLines sums to. That
   is necessary and it is not sufficient: the dashboard does not print sums,
   it prints headlineMetrics and a chart, over a window, against the period
   before it. What matters to a shop is that those come out the same
   whichever source answered -- so this runs the real functions over both.
   ------------------------------------------------------------------------ */

describeDb("the dashboard reads the same either way", () => {
  function bothSides() {
    const orders = json<Order>(`select * from orders`);
    const products = json<Product>(`select * from products`);
    const categories = json<Category>(`select * from categories`);
    const sellers = json<Seller>(`select * from sellers`);
    const costRows = json<{ product_id: string; cost_price: number }>(
      `select product_id, cost_price from product_costs`);
    const returnRows = json<{ order_id: string; product_id: string; qty: number }>(
      `select r.order_id, ri.product_id, sum(ri.qty) as qty
         from order_return_items ri join order_returns r on r.id = ri.return_id
        where ri.product_id is not null group by 1, 2`);

    const lines = buildSalesLines(orders, {
      products, categories, sellers,
      costs: new Map(costRows.map((c) => [c.product_id, Number(c.cost_price)])),
      returns: new Map(returnRows.map((r) =>
        [returnKey(r.order_id, r.product_id), Number(r.qty)])),
    });

    const rows = json<Record<string, unknown>>(
      `select day::text as day, status, seller_id, category_id, has_cost, orders,
              qty, net_sales, cost, discount, lines_without_cost, lines
         from sales_daily`).map((r): RollupRow => ({
      day: String(r.day), status: String(r.status),
      sellerId: (r.seller_id as string | null) ?? null,
      categoryId: (r.category_id as string | null) ?? null,
      hasCost: r.has_cost === true,
      orders: Number(r.orders), qty: Number(r.qty),
      netSales: Number(r.net_sales), cost: Number(r.cost),
      discount: Number(r.discount),
      linesWithoutCost: Number(r.lines_without_cost), lines: Number(r.lines),
    }));

    return { lines, rolled: rollupLines(rows, categories, sellers) };
  }

  /* Every range except 1d, which is bucketed by hour: a rollup by DAY
     cannot answer an intraday chart and the dashboard does not ask it to. */
  const RANGES = ["5d", "1m", "6m", "ytd", "1y", "5y", "max"] as const;
  const TODAY = "2026-09-10";

  it("gives the same headline metrics at every range it serves", () => {
    const { lines, rolled } = bothSides();
    for (const range of RANGES) {
      const a = headlineMetrics(lines, [], range, TODAY);
      const b = headlineMetrics(rolled, [], range, TODAY);
      expect(b, `headline metrics at ${range}`).toEqual(a);
    }
  });

  it("draws the same chart at every range it serves", () => {
    const { lines, rolled } = bothSides();
    for (const range of RANGES) {
      const a = overviewSeries(lines, [], range, TODAY);
      const b = overviewSeries(rolled, [], range, TODAY);
      expect(b, `the series at ${range}`).toEqual(a);
    }
  });

  it("counts the same orders, from the view that can count them", () => {
    /* NOT from the rolled-up rows. sales_daily groups by seller and
       category, so an order holding a shirt and a football is a row in
       each -- summing its `orders` column would say two. */
    const { lines } = bothSides();
    const counts = json<Record<string, unknown>>(
      `select day::text as day, status, orders from sales_daily_orders`)
      .map((r): DayOrders => ({
        day: String(r.day), status: String(r.status), orders: Number(r.orders),
      }));

    const from = "2026-09-01", to = "2026-09-30";
    const live = new Set<string>(LIVE_STATUSES as readonly string[]);
    const fromLines = new Set(
      lines.filter((l) => l.date >= from && l.date <= to && live.has(l.status))
        .map((l) => l.orderId)).size;

    expect(rollupOrderCount(counts, from, to, (st) => live.has(st))).toBe(fromLines);
    expect(fromLines, "the fixture has orders to count").toBeGreaterThan(0);
  });

  it("would double-count if it summed the wrong view", () => {
    /* The mistake this guards against, demonstrated rather than asserted:
       an order spanning two categories IS two rows in sales_daily, so a
       reader that summed `orders` there would report more orders than
       exist. */
    const summedWrongly = json<{ n: string }>(
      `select sum(orders)::text as n from sales_daily
        where day = '2026-09-03' and status = 'completed'`)[0];
    const exact = json<{ n: string }>(
      `select orders::text as n from sales_daily_orders
        where day = '2026-09-03' and status = 'completed'`)[0];
    expect(Number(summedWrongly.n)).toBeGreaterThan(Number(exact.n));
    expect(Number(exact.n)).toBe(1);
  });
});
