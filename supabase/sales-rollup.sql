-- ---------------------------------------------------------------------------
-- The dashboard's arithmetic, done once a day instead of once a page load
-- ---------------------------------------------------------------------------
-- Run AFTER order-items.sql (which creates the rows this reads), returns.sql
-- and sales.sql. Safe to re-run.
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
-- shipping the lines: this view is ~one row per day per status per seller
-- per category, which for two years of trading is hundreds of rows rather
-- than tens of thousands of orders.
--
-- IT READS order_items, NOT orders.items. Those rows already exist --
-- sync_order_items has built them at placement since order-items.sql -- so
-- the expensive half, exploding the jsonb, is already materialised and has
-- been all along. Nothing here re-parses anything.
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
)
select
  /* THE KEY, AS A COLUMN. A concurrent refresh needs a unique index, and
     Postgres will not accept one built from expressions -- the first
     attempt indexed coalesce(seller_id, ...) and the refresh failed with
     "create a unique index with no WHERE clause". The grain is therefore
     materialised as a column that is never null, and the nullable
     seller_id and category_id stay beside it for readers, where null keeps
     meaning "the shop's own" and "uncategorised". */
  (o.created_at at time zone 'Asia/Dili')::date::text
    || '|' || o.status
    || '|' || coalesce(oi.seller_id::text, '')
    || '|' || coalesce(p.category_id::text, '')           as grain,
  (o.created_at at time zone 'Asia/Dili')::date          as day,
  o.status                                               as status,
  oi.seller_id                                           as seller_id,
  p.category_id                                          as category_id,
  count(distinct o.id)                                   as orders,
  -- NET OF RETURNS, and floored at zero. A return larger than the order is
  -- a data error, and it must not become negative revenue that quietly
  -- cancels out a real sale somewhere else in the total. Same rule as
  -- buildSalesLines() in src/lib/sales.ts, which this has to agree with.
  sum(greatest(oi.qty - least(oi.qty, greatest(coalesce(rt.qty, 0), 0)), 0))
                                                         as qty,
  sum(greatest(oi.qty - least(oi.qty, greatest(coalesce(rt.qty, 0), 0)), 0)
      * oi.unit_price)                                   as net_sales,
  -- THE SNAPSHOT WINS. order_items.cost is what the goods cost when they
  -- were sold; product_costs is today's, and is the fallback only so that
  -- orders placed before costs were ever recorded still report something.
  sum(greatest(oi.qty - least(oi.qty, greatest(coalesce(rt.qty, 0), 0)), 0)
      * coalesce(oi.cost, pc.cost_price, 0))             as cost,
  -- How many of those lines had no cost at all. A margin computed over
  -- lines that are half-costed is a lie with a decimal point, so the
  -- reader can see how much of the figure is real.
  sum(case when oi.cost is null and pc.cost_price is null then 1 else 0 end)
                                                         as lines_without_cost,
  -- The list price the line was sold against, reconstructed the way
  -- buildSalesLines does: the order line has no list price of its own, and
  -- greatest() stops a later price CUT manufacturing a negative discount
  -- out of an old order.
  sum(greatest(oi.qty - least(oi.qty, greatest(coalesce(rt.qty, 0), 0)), 0)
      * (greatest(oi.unit_price, coalesce(p.price, oi.unit_price)) - oi.unit_price))
                                                         as discount,
  count(*)                                               as lines
  from order_items oi
  join orders   o  on o.id = oi.order_id
  left join products p  on p.id = oi.product_id
  left join product_costs pc on pc.product_id = oi.product_id
  left join returned rt on rt.order_id = oi.order_id and rt.product_id = oi.product_id
 group by 1, 2, 3, 4, 5;

comment on materialized view sales_daily is
  'One row per shop-day, order status, seller and category, netted for returns. What the admin dashboard reads instead of the order book. Refreshed by refresh_sales_daily(); see /api/cron/refresh-analytics.';

-- REQUIRED FOR A CONCURRENT REFRESH, which is the only kind worth having:
-- a plain REFRESH takes an exclusive lock and the dashboard blocks behind
-- it. On the `grain` column rather than on (day, status, seller, category),
-- because a unique index treats nulls as distinct -- so the shop's own
-- sales, whose seller is null, could be inserted twice without the index
-- objecting.
create unique index if not exists sales_daily_grain on sales_daily (grain);

create index if not exists sales_daily_day on sales_daily (day desc);

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
end $$;

comment on function refresh_sales_daily is
  'Rebuilds sales_daily. Concurrent once the view has been populated, so the dashboard is never locked out of its own figures.';

-- Nobody reaches this with the public key. Every row is the shop's takings
-- and its margin: the two things the storefront must never be able to ask
-- for. The admin screens read it with the service-role client, which
-- bypasses these grants entirely.
revoke all on sales_daily from anon, authenticated;
revoke all on function refresh_sales_daily() from public, anon, authenticated;
