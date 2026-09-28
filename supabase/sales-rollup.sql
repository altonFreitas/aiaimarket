-- ---------------------------------------------------------------------------
-- The dashboard's arithmetic, done once a day instead of once a page load
-- ---------------------------------------------------------------------------
-- Run AFTER schema.sql, returns.sql, sales.sql and analytics-freshness.sql.
-- Safe to re-run.
--
-- WHAT WAS ACTUALLY WRONG, measured before writing any of this. The admin
-- dashboard read up to 20,000 orders and aggregated them in JavaScript, and
-- the obvious diagnosis -- "the database is doing too much work" -- was
-- wrong:
--
--     reading 20,000 orders in Postgres            36 ms
--     aggregating the same rows entirely in SQL    35 ms
--
-- The database was never the bottleneck. The bottleneck is the PAYLOAD: 11
-- MB per dashboard load, of which 7,656 kB is the `items` jsonb, shipped
-- over PostgREST and parsed into JavaScript objects on every render. Cutting
-- the column list saves 1 MB of that, because the lines ARE the payload.
--
-- So the fix is not an index and not a narrower select. It is to stop
-- SHIPPING the lines: this view is ~one row per day per status per seller
-- per category, which for two years of trading is hundreds of rows rather
-- than tens of thousands of orders.
--
-- ---------------------------------------------------------------------------
-- IT READS orders.items, AND THAT IS THE WHOLE POINT
-- ---------------------------------------------------------------------------
-- The first version of this file read `order_items` instead, on the
-- reasoning that the expensive half -- exploding the jsonb -- was already
-- materialised there by sync_order_items(). The reasoning was sound and the
-- result was wrong, and here is the bug it caused, reported from the shop:
--
--     admin home      net profit  $102.20
--     Settings ->     net profit  $259.43
--     Finance
--
-- Both screens run the SAME arithmetic (profitAndLoss, from the same
-- commission, delivery fees, refunds and expenses). Only the LINES differed:
-- Finance flattens orders.items, this view read order_items -- and those are
-- not the same ledger.
--
-- order_items is DERIVED from orders.items by a trigger, and the first
-- version of that trigger, and of its backfill, dropped any line naming a
-- product or a seller that no longer existed:
--
--     and (nullif(i->>'seller_id','') is null or exists (select 1 from sellers ...))
--     and (nullif(i->>'product_id','') is null or exists (select 1 from products ...))
--
-- supabase/legal-currency-tax.sql has since fixed the trigger -- it nulls
-- the unknown reference and keeps the line. But a trigger only fires on new
-- writes. Every line already dropped stayed dropped, and re-running
-- supabase/order-items.sql could not bring it back, because its backfill
-- refused the same lines on the same grounds. That backfill is repaired in
-- the same change as this file, so a shop that runs the SQL again gets its
-- lines returned to order_items -- which is what the seller earnings and
-- the payout ledger read.
--
-- Measured on a real Postgres, reproducing a shop migrated before that fix:
--
--     orders.items         total  257.00     <- what Finance reports
--     sales_daily          total  100.00     <- what the dashboard reported
--     analytics_freshness()        t         <- and it called that current
--
-- REPAIRING THE DATA IS NOT ENOUGH, which is why this file changed too. A
-- repair fixes the rows that exist today; it does not stop a derived table
-- drifting from the order book again, and it cannot, because the dashboard
-- would still be reading a copy. So the rollup is built from orders.items,
-- the column both screens already treat as authoritative and the one the
-- buyer's own order is printed from. The two sources cannot disagree about
-- which lines exist, because there is only one set of lines.
--
-- THE COST IS ONE jsonb EXPLOSION PER REFRESH, once a day, inside the
-- database -- the half that was never the bottleneck. Nothing extra crosses
-- the wire.
--
-- EVERY EXPRESSION BELOW MIRRORS buildSalesLines() IN src/lib/sales.ts, line
-- for line: the same returns netting, the same cost precedence, the same
-- list-price reconstruction, the same "a seller id naming no seller is the
-- shop's own". tests/rls/salesRollup.test.ts pins the two against each other
-- on a real database, including the deleted-product case above.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A DAY IS THE SHOP'S DAY
-- ---------------------------------------------------------------------------
-- Timor-Leste is UTC+9. A sale rung up at 07:15 in Dili is 22:15 the
-- previous day in UTC, so bucketing by UTC files about a third of trading
-- hours under yesterday -- which is the exact bug src/lib/tz.ts was written
-- to end, and it would come straight back here if this view used ::date on a
-- timestamptz without saying in which zone.
--
-- THE ZONE IS WRITTEN TWICE, here and as STORE_TZ in src/lib/tz.ts, and the
-- two must agree or every figure on the dashboard moves by nine hours.
-- tests/salesRollup.test.ts fails when they drift. A shop that sets
-- NEXT_PUBLIC_STORE_TZ to something else has to change this line and refresh
-- the view.
-- ---------------------------------------------------------------------------

drop materialized view if exists sales_daily;

create materialized view sales_daily as
with returned as (
  -- Units handed back, per order line. Summed before the join so a line
  -- returned twice does not multiply the row it is joined to.
  select ri.product_id, r.order_id, sum(ri.qty)::numeric as qty
    from order_return_items ri
    join order_returns r on r.id = ri.return_id
   where ri.product_id is not null
   group by ri.product_id, r.order_id
), line as (
  /* ONE ROW PER ORDER LINE, straight out of the snapshot. The same
     flattening buildSalesLines() does, expressed once here.
   *
   * jsonb_typeof GUARDS THE EXPLOSION. jsonb_array_elements() raises on
   * anything that is not an array, and one order carrying `null` or `{}`
   * in `items` would take the whole view down with it -- which on this
   * file means the migration aborts and the shop has no dashboard.
   *
   * THE UUID CASTS ARE GUARDED FOR THE SAME REASON. `::uuid` on a value
   * that is not one raises, and a single imported or hand-repaired order
   * would cost every figure on the page. A product_id that is not a uuid
   * names no product, which is exactly what a failed lookup means in
   * buildSalesLines -- so it resolves to null here rather than throwing. */
  select
    o.id                                                       as order_id,
    o.created_at                                               as created_at,
    o.status                                                   as status,
    case when i->>'product_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (i->>'product_id')::uuid end                     as product_id,
    case when i->>'seller_id'  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (i->>'seller_id')::uuid end                      as seller_id,
    -- Number(x) || 0, in SQL. A line with no qty or no price is a line
    -- worth nothing, not a line that stops the view building.
    coalesce(nullif(i->>'qty', '')::numeric, 0)                as sold_qty,
    coalesce(nullif(i->>'price', '')::numeric, 0)              as unit_price,
    -- Null means "not recorded", and stays distinguishable from "cost
    -- nothing" all the way to the margin.
    nullif(i->>'cost', '')::numeric                            as snapshot_cost
    from orders o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i
)
select
  /* THE KEY, AS A COLUMN. A concurrent refresh needs a unique index, and
     Postgres will not accept one built from expressions -- the first
     attempt indexed coalesce(seller_id, ...) and the refresh failed with
     "create a unique index with no WHERE clause". The grain is therefore
     materialised as a column that is never null, and the nullable
     seller_id and category_id stay beside it for readers, where null keeps
     meaning "the shop's own" and "uncategorised". */
  (l.created_at at time zone 'Asia/Dili')::date::text
    || '|' || l.status
    || '|' || coalesce(s.id::text, '')
    || '|' || coalesce(p.category_id::text, '')
    || '|' || (coalesce(l.snapshot_cost, pc.cost_price) is not null)::text as grain,
  (l.created_at at time zone 'Asia/Dili')::date          as day,
  l.status                                               as status,
  /* s.id, NOT l.seller_id. A SELLER ID THAT NAMES NO SELLER IS THE
     MARKETPLACE'S OWN -- products.seller_id has been NOT NULL since
     schema.sql and defaults to settings.seller_id, so the shop's own
     catalogue carries a real uuid that matches no row in `sellers`.
     Reported as-is it becomes a group of its own, and since the label
     falls back to "Store's own" for want of a store name, the seller
     table prints TWO rows both called "Store's own" with the shop's
     takings split between them. buildSalesLines resolves it to null; so
     does this, by taking the id from the JOIN rather than from the line. */
  s.id                                                   as seller_id,
  p.category_id                                          as category_id,
  /* WHETHER THESE LINES HAD A COST AT ALL, and part of the grain rather
     than a summary of it.
     .
     Gross profit is computed over the revenue that HAS a cost behind it --
     see totals() in src/lib/sales.ts, which adds a line's revenue to the
     margin base only when its cost is known. A row mixing costed and
     uncosted lines cannot express that: coalescing the missing ones to
     zero lets their revenue into the base at no cost and inflates the
     margin, which is exactly what the dashboard's own headline metrics
     disagreed about until this column existed.
     .
     Split into the grain, every row is wholly one or the other, and a row
     with no cost reports cost as absent rather than as zero. */
  (coalesce(l.snapshot_cost, pc.cost_price) is not null)  as has_cost,
  count(distinct l.order_id)                             as orders,
  -- NET OF RETURNS, and floored at zero. A return larger than the order is
  -- a data error, and it must not become negative revenue that quietly
  -- cancels out a real sale somewhere else in the total. Same rule as
  -- buildSalesLines() in src/lib/sales.ts, which this has to agree with.
  sum(greatest(l.sold_qty - least(l.sold_qty, greatest(coalesce(rt.qty, 0), 0)), 0))
                                                         as qty,
  sum(greatest(l.sold_qty - least(l.sold_qty, greatest(coalesce(rt.qty, 0), 0)), 0)
      * l.unit_price)                                    as net_sales,
  -- THE SNAPSHOT WINS. The line's own `cost` is what the goods cost when
  -- they were sold; product_costs is today's, and is the fallback only so
  -- that orders placed before costs were ever recorded still report
  -- something.
  sum(greatest(l.sold_qty - least(l.sold_qty, greatest(coalesce(rt.qty, 0), 0)), 0)
      * coalesce(l.snapshot_cost, pc.cost_price, 0))     as cost,
  -- How many of those lines had no cost at all. A margin computed over
  -- lines that are half-costed is a lie with a decimal point, so the
  -- reader can see how much of the figure is real.
  sum(case when l.snapshot_cost is null and pc.cost_price is null then 1 else 0 end)
                                                         as lines_without_cost,
  -- The list price the line was sold against, reconstructed the way
  -- buildSalesLines does: the order line has no list price of its own, and
  -- greatest() stops a later price CUT manufacturing a negative discount
  -- out of an old order.
  sum(greatest(l.sold_qty - least(l.sold_qty, greatest(coalesce(rt.qty, 0), 0)), 0)
      * (greatest(l.unit_price, coalesce(p.price, l.unit_price)) - l.unit_price))
                                                         as discount,
  count(*)                                               as lines
  from line l
  left join products p  on p.id = l.product_id
  left join sellers  s  on s.id = l.seller_id
  left join product_costs pc on pc.product_id = l.product_id
  left join returned rt on rt.order_id = l.order_id and rt.product_id = l.product_id
 group by 1, 2, 3, 4, 5, 6;

comment on materialized view sales_daily is
  'One row per shop-day, order status, seller and category, netted for returns. Built from orders.items -- the same ledger the Finance screen flattens -- so the two cannot disagree. Refreshed by refresh_sales_daily(); see /api/cron/refresh-analytics.';

-- REQUIRED FOR A CONCURRENT REFRESH, which is the only kind worth having:
-- a plain REFRESH takes an exclusive lock and the dashboard blocks behind
-- it. On the `grain` column rather than on (day, status, seller, category),
-- because a unique index treats nulls as distinct -- so the shop's own
-- sales, whose seller is null, could be inserted twice without the index
-- objecting.
create unique index if not exists sales_daily_grain on sales_daily (grain);

create index if not exists sales_daily_day on sales_daily (day desc);

-- ---------------------------------------------------------------------------
-- HOW MANY ORDERS, which the view above cannot answer
-- ---------------------------------------------------------------------------
-- sales_daily counts orders per day PER SELLER PER CATEGORY, so an order
-- holding a shirt and a football contributes a row to each and summing that
-- column across a day counts it twice. Money, units and discount are
-- additive across the grain; "how many orders" is not, and no amount of
-- care at the reading end fixes a number that was already wrong when it was
-- grouped.
--
-- So it gets its own view at the only grain where the answer is exact. Day
-- and status, which is what the dashboard's order-count card asks for.
--
-- EVERY ORDER, INCLUDING ONE WITH NO LINES. This used to carry
--
--     where exists (select 1 from order_items oi where oi.order_id = o.id)
--
-- which is the second half of the bug at the top of this file: an order
-- whose lines the sync trigger had skipped was not merely mis-valued, it
-- was not an order at all. The shop counted four orders on the front page
-- and listed ten on the orders screen. An order is an order; what it
-- contains is the other view's question.
-- ---------------------------------------------------------------------------
drop materialized view if exists sales_daily_orders;

create materialized view sales_daily_orders as
select
  (o.created_at at time zone 'Asia/Dili')::date::text || '|' || o.status  as grain,
  (o.created_at at time zone 'Asia/Dili')::date                           as day,
  o.status                                                                as status,
  count(*)                                                                as orders
  from orders o
 group by 1, 2, 3;

comment on materialized view sales_daily_orders is
  'Orders per shop-day and status, all of them. Separate from sales_daily because that view''s grain makes an order count non-additive, and unconditional because an order with no readable lines is still an order.';

create unique index if not exists sales_daily_orders_grain
  on sales_daily_orders (grain);

revoke all on sales_daily_orders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Refreshing it
-- ---------------------------------------------------------------------------
-- CONCURRENTLY, so the dashboard keeps answering from the previous contents
-- while the new ones are built. It needs the unique index above and it
-- cannot run inside a transaction block -- which is why this is a function
-- the cron calls rather than a line in a migration.
--
-- Falls back to a plain refresh the FIRST time only: a materialized view
-- that has never been populated cannot be refreshed concurrently, and a
-- shop that has just run this file would otherwise get an error instead of
-- its first set of numbers.
create or replace function refresh_sales_daily() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from pg_class
              where relname = 'sales_daily' and relkind = 'm' and relispopulated) then
    refresh materialized view concurrently sales_daily;
  else
    refresh materialized view sales_daily;
  end if;

  -- BOTH, from one call. Two views that the dashboard reads together must
  -- be rebuilt together, or a page shows this hour's revenue beside last
  -- hour's order count and the average order value between them is
  -- arithmetic on two different days.
  if exists (select 1 from pg_class
              where relname = 'sales_daily_orders' and relkind = 'm' and relispopulated) then
    refresh materialized view concurrently sales_daily_orders;
  else
    refresh materialized view sales_daily_orders;
  end if;

  /* WHEN IT RAN, recorded AFTER the rebuild -- a refresh that throws must
     not leave behind a record saying it succeeded.
   *
   * The dashboard compares this against orders.updated_at before it will
   * read money out of the rollup. Without it, `ready` only ever meant
   * "the view can be read", and the admin home served a week-old net
   * profit on every range except the one bucketed by hour. See
   * supabase/analytics-freshness.sql, which creates the table and runs
   * before this file.
   *
   * Tolerated, because this file is applied on shops that have not got
   * that one yet: a missing table must not fail the refresh. */
  begin
    insert into analytics_refresh (view_name, refreshed_at)
         values ('sales_daily', now())
    on conflict (view_name) do update set refreshed_at = excluded.refreshed_at;
  exception when undefined_table then
    null;
  end;
end $$;

comment on function refresh_sales_daily is
  'Rebuilds both sales rollups, together. Concurrent once each has been populated, so the dashboard is never locked out of its own figures.';

-- Nobody reaches this with the public key. Every row is the shop's takings
-- and its margin: the two things the storefront must never be able to ask
-- for. The admin screens read it with the service-role client, which
-- bypasses these grants entirely.
revoke all on sales_daily from anon, authenticated;
revoke all on function refresh_sales_daily() from public, anon, authenticated;
