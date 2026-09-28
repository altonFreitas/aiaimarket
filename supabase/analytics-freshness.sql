-- ===========================================================================
-- Loja AIAI -- WHEN THE ROLLUP LAST LOOKED AT THE ORDER BOOK
--
-- REPORTED FROM THE SHOP: the admin home said net profit $102.20 on every
-- range except "1D", where it said $259.43 -- and $259.43 is what the
-- Finance screen says. Two screens, two answers, both labelled net profit.
--
-- The cause is not arithmetic. "1D" is the only range bucketed by HOUR, so
-- it is the only one a rollup grouped by DAY cannot answer -- and the only
-- one that therefore reads the live order book, which is also what the
-- Finance screen reads. Every other range reads sales_daily, a MATERIALIZED
-- view that is only as current as the last run of refresh_sales_daily().
-- Nothing recorded when that was, so nothing could tell the difference
-- between a rollup that agrees with the order book and one that is a week
-- behind it. `ready: true` only ever meant "the view can be read".
--
-- A figure that is silently out of date is worse than a missing one: it
-- looks like an answer. So this records the refresh, and the dashboard
-- falls back to the order book when the rollup has not seen the latest
-- change.
--
-- WHY orders.updated_at IS PART OF THIS. Comparing the refresh against the
-- newest order's created_at is not enough: cancelling a month-old order
-- changes the takings and moves no created_at. The dashboard would go on
-- showing a cancelled sale as revenue until something newer was ordered.
--
-- APPLIED BEFORE sales-rollup.sql, which is where the stamping itself
-- lives. Defining refresh_sales_daily() a second time here would have
-- worked, and would also have made this file the last one to create it --
-- at which point the health panel, which checks that function to decide
-- whether the ROLLUP is installed, would report a rollup that was never
-- built. One definition, in the file that owns it.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- WHEN AN ORDER LAST CHANGED
-- ---------------------------------------------------------------------------
alter table orders
  add column if not exists updated_at timestamptz not null default now();

comment on column orders.updated_at is
  'Last time anything about this order changed. Read by analytics_freshness() to tell whether the sales rollup has seen it yet.';

create or replace function touch_order_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists orders_touch_updated_at on orders;
create trigger orders_touch_updated_at
  before update on orders
  for each row execute function touch_order_updated_at();

-- Backfilled from the order's own creation, which is the only honest
-- answer for rows that existed before this column: nothing recorded when
-- they were last touched, and now() would claim every one of them changed
-- the moment this file ran.
update orders set updated_at = created_at where updated_at < created_at;

create index if not exists idx_orders_updated on orders (updated_at desc);

-- ---------------------------------------------------------------------------
-- WHEN A ROLLUP LAST RAN
-- ---------------------------------------------------------------------------
create table if not exists analytics_refresh (
  view_name    text primary key,
  refreshed_at timestamptz not null default now()
);

comment on table analytics_refresh is
  'One row per materialized analytics view, stamped by refresh_sales_daily(). The dashboard compares it against orders.updated_at before trusting the rollup with money.';

-- ---------------------------------------------------------------------------
-- THE ONE QUESTION THE DASHBOARD ASKS
--
-- Every part in a single round trip, and as a function so the comparison is
-- not assembled from separate reads that could straddle a refresh.
--
-- ---------------------------------------------------------------------------
-- WHY A TIMESTAMP IS NOT ENOUGH, learned the hard way
-- ---------------------------------------------------------------------------
-- The first version of this function returned the two timestamps alone, and
-- the shop reported the same divergence again: home $102.20, Finance
-- $259.43, with this function reporting `t` -- current.
--
-- It was telling the truth. The rollup HAD seen every change the order book
-- had; it simply could not see all of what it had seen, because it was
-- built from order_items -- a derived table that an early version of
-- sync_order_items() had dropped lines from, and that no later migration
-- put back. Measured: orders.items totalled 257 and the rollup totalled
-- 100, with both timestamps in agreement.
--
-- A clock catches a rollup that is BEHIND. Nothing about a clock catches a
-- rollup that is INCOMPLETE. So the counts travel with the timestamps: how
-- many orders the book holds, and how many the rollup accounts for. They
-- are equal by construction now that sales_daily_orders is built from
-- `orders` itself -- and a guard that can only fire when something else has
-- already broken is exactly the guard worth having, because the thing it
-- watches for has happened once.
--
-- BOTH ARE CHEAP. count(*) on orders is one aggregate over a table the
-- dashboard is refusing to read in full, and sales_daily_orders is one row
-- per day per status -- hundreds of rows for years of trading.
--
-- plpgsql RATHER THAN sql, and not a style choice: this file is applied
-- BEFORE sales-rollup.sql, so sales_daily_orders does not exist the first
-- time this runs. A `language sql` body is parsed at creation and would
-- fail; a plpgsql body is not, which lets the missing view be handled as
-- what it is -- an unknown, not an error.
-- ---------------------------------------------------------------------------

-- The return type gains two columns, and Postgres will not replace a
-- function whose OUT parameters have changed. Dropped rather than renamed,
-- so a shop re-running this file lands on one definition instead of two.
drop function if exists analytics_freshness();

create function analytics_freshness()
returns table (refreshed_at timestamptz, orders_changed_at timestamptz,
               orders_in_book bigint, orders_in_rollup bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  select r.refreshed_at into refreshed_at
    from analytics_refresh r where r.view_name = 'sales_daily';

  -- One pass for both: the newest change and how many orders there are.
  select max(o.updated_at), count(*) into orders_changed_at, orders_in_book
    from orders o;

  begin
    select coalesce(sum(d.orders), 0) into orders_in_rollup
      from sales_daily_orders d;
  exception when undefined_table then
    -- The rollup has not been installed. NULL, meaning "no answer", which
    -- the dashboard reads as "nothing to compare" rather than as zero --
    -- zero would say the rollup holds no orders, which is a different and
    -- much more alarming claim.
    orders_in_rollup := null;
  end;

  return next;
end $$;

comment on function analytics_freshness is
  'When the sales rollup last ran, when an order last changed, and how many orders each side accounts for. The dashboard refuses to read money out of the rollup unless the refresh is newer than the last change AND the two counts agree.';

-- ---------------------------------------------------------------------------
-- AND NOBODY REACHES IT WITH THE PUBLIC KEY
-- ---------------------------------------------------------------------------
-- RLS ON, WITH NO POLICY, which is deny-by-default and is the point: the
-- service-role client the admin screens use bypasses RLS entirely, so a
-- table with row security and no policy is readable by exactly the caller
-- that should read it and by nobody else.
--
-- Caught by tests/rls/rls.test.ts, which fails on any public table without
-- row security -- and it was right to. The revokes below are a grant-level
-- answer and this is the row-level one; the pair is what every other table
-- in this schema carries, and a table that is the odd one out is the one
-- somebody later grants access to by accident.
alter table analytics_refresh enable row level security;

-- The storefront must never reach any of this: every row is the shop's
-- takings. The admin screens read it with the service-role client.
revoke all on analytics_refresh from anon, authenticated;
revoke all on function analytics_freshness() from public, anon, authenticated;
