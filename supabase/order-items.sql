-- ===========================================================================
-- Loja AIAI -- order lines become rows
--
-- Run AFTER supabase/schema.sql and supabase/marketplace-v2.sql.
--
-- THE ROOT OF FOUR SEPARATE FINDINGS. Order lines live in `orders.items`
-- as JSONB. JSONB is a fine way to keep a SNAPSHOT -- what this line was
-- called, what it cost, what rate applied -- and a hopeless way to answer
-- "which orders belong to seller X", because there is no index into the
-- inside of a document.
--
-- So every seller-facing screen scanned the 5,000 newest orders
-- MARKETPLACE-WIDE and filtered them in JavaScript. That one choice is:
--
--   * the earnings cap. Past 5,000 total orders a seller's older completed
--     orders fall out of the window and stop counting toward gross sales,
--     while every dollar already paid to them still counts. The dashboard
--     now refuses to show a figure it cannot stand behind, which is honest
--     and is not a fix.
--   * the cost of every seller screen, which is the same full scan whether
--     the seller has two orders or two hundred.
--   * the best-sellers ranking, which scans completed orders to add up
--     units per product.
--   * and the reason a mixed-seller order is read-only for everyone in it:
--     status lives on the order, so there is nowhere to put "I have
--     dispatched my half".
--
-- WHAT THIS FILE DOES NOT DO. It does not remove `orders.items`. That
-- column stays exactly as it is and stays authoritative for display: it is
-- the snapshot, written once, never migrated, and every existing reader of
-- it keeps working untouched. This table is an INDEX INTO it, derived from
-- it, and kept in step by a trigger rather than by a second write in
-- application code that somebody will one day forget.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,

  -- SET NULL, not CASCADE. Deleting a product must never delete the record
  -- of having sold it -- that would rewrite history and every total derived
  -- from it. The name and price below are what keep the line readable
  -- afterwards.
  product_id   uuid references products(id) on delete set null,
  seller_id    uuid references sellers(id) on delete set null,

  -- SNAPSHOTS, all four. Same rule the JSONB already follows and the same
  -- reason purchase orders capture fx_rate: a line records the deal as it
  -- was on the day, so re-pricing a product or renegotiating a rate cannot
  -- silently rewrite what was sold or what was owed.
  name         text not null default '',
  size         text not null default '',
  qty          int not null check (qty > 0),
  unit_price   numeric(10,2) not null,
  -- The platform's purchase cost. Null means "not recorded", which stays
  -- distinguishable from "cost nothing" forever.
  cost         numeric(14,4),
  -- Null for the marketplace's own goods: there is no commission on selling
  -- to yourself, and that is different from a rate nobody wrote down.
  commission_rate numeric(5,2),

  -- WHERE THIS SELLER'S HALF OF THE ORDER HAS GOT TO.
  --
  -- The order's own status is one column shared by everyone in it, which is
  -- why a mixed-seller order has always been read-only for the sellers in
  -- it: there was nowhere for one of them to say "mine has gone out" without
  -- claiming it for the other. This is that somewhere.
  --
  -- Deliberately a SHORTER vocabulary than orders.status. A seller is not
  -- running the delivery and cannot know that a package arrived; what they
  -- know is whether they have packed it and handed it over.
  fulfilment_status text not null default 'pending'
    check (fulfilment_status in ('pending','preparing','ready','dispatched','cancelled')),

  -- Copied from the order, not defaulted to now(). It is what makes
  -- (seller_id, created_at) answer "this seller's recent orders" without
  -- joining back to orders at all.
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. The index the whole file exists for
-- ---------------------------------------------------------------------------
-- "This seller's lines, newest first" -- which is every seller screen, the
-- earnings aggregate and the payout ledger, all served by one index instead
-- of one marketplace-wide scan each.
create index if not exists order_items_seller_idx
  on order_items (seller_id, created_at desc);

-- Reading one order's lines back, which is the join behind the seller's
-- order list.
create index if not exists order_items_order_idx on order_items (order_id);

-- GROUP BY product_id, for the best-sellers ranking and demand planning.
create index if not exists order_items_product_idx on order_items (product_id);

-- ONE ROW PER LINE, and what makes the trigger below idempotent. A line is
-- identified by its order, its product and its size -- the same product in
-- two sizes is two lines, which is exactly how the basket treats it.
--
-- coalesce on product_id because a null is not equal to a null in a unique
-- index, and a line whose product was later deleted must still be unique.
create unique index if not exists order_items_line_uq
  on order_items (order_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), size);

comment on table order_items is
  'One row per order line, derived from orders.items and kept in step by a trigger. orders.items stays authoritative for display; this is the index into it. See supabase/order-items.sql.';

-- ---------------------------------------------------------------------------
-- 3. Kept in step by the database, not by remembering
-- ---------------------------------------------------------------------------
-- A second write in placeOrder() would work until the day something else
-- writes an order -- a backfill script, a support fix, an import -- and
-- then the two would disagree with nothing to say which was right.
--
-- ON CONFLICT DO NOTHING rather than DO UPDATE: fulfilment_status is owned
-- by the seller who set it, and re-running this must never walk somebody's
-- "dispatched" back to "pending".

create or replace function sync_order_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into order_items (
    order_id, product_id, seller_id, name, size, qty,
    unit_price, cost, commission_rate, created_at
  )
  select new.id,
         nullif(i->>'product_id', '')::uuid,
         nullif(i->>'seller_id', '')::uuid,
         coalesce(i->>'name', ''),
         coalesce(i->>'size', ''),
         (i->>'qty')::int,
         (i->>'price')::numeric,
         nullif(i->>'cost', '')::numeric,
         nullif(i->>'commission_rate', '')::numeric,
         new.created_at
    from jsonb_array_elements(new.items) i
   where coalesce((i->>'qty')::int, 0) > 0
     -- A line naming a seller that no longer exists would fail the foreign
     -- key and take the whole order insert down with it. The line is worth
     -- more than the attribution.
     and (nullif(i->>'seller_id', '') is null
          or exists (select 1 from sellers s where s.id = (i->>'seller_id')::uuid))
     and (nullif(i->>'product_id', '') is null
          or exists (select 1 from products p where p.id = (i->>'product_id')::uuid))
  on conflict do nothing;

  return null;
end $$;

comment on function sync_order_items is
  'Derives order_items rows from orders.items. Never updates an existing line: fulfilment_status belongs to the seller who set it.';

drop trigger if exists trg_sync_order_items on orders;
create trigger trg_sync_order_items
  after insert or update of items on orders
  for each row execute function sync_order_items();

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
-- Every order already in the table, turned into lines. Without this the
-- new queries would report that every seller's history began the day this
-- ran -- which is the earnings bug again, wearing a different hat.

do $$
declare n bigint;
begin
  insert into order_items (
    order_id, product_id, seller_id, name, size, qty,
    unit_price, cost, commission_rate, created_at
  )
  select o.id,
         nullif(i->>'product_id', '')::uuid,
         nullif(i->>'seller_id', '')::uuid,
         coalesce(i->>'name', ''),
         coalesce(i->>'size', ''),
         (i->>'qty')::int,
         (i->>'price')::numeric,
         nullif(i->>'cost', '')::numeric,
         nullif(i->>'commission_rate', '')::numeric,
         o.created_at
    from orders o
    cross join lateral jsonb_array_elements(o.items) i
   where coalesce((i->>'qty')::int, 0) > 0
     and (nullif(i->>'seller_id', '') is null
          or exists (select 1 from sellers s where s.id = (i->>'seller_id')::uuid))
     and (nullif(i->>'product_id', '') is null
          or exists (select 1 from products p where p.id = (i->>'product_id')::uuid))
  on conflict do nothing;
  get diagnostics n = row_count;
  raise notice 'order_items backfill: % line(s)', n;
end $$;

-- A cancelled order's lines are cancelled too. Backfilled once here;
-- from now on the trigger in section 6 keeps it true.
update order_items oi
   set fulfilment_status = 'cancelled'
  from orders o
 where o.id = oi.order_id
   and o.status = 'cancelled'
   and oi.fulfilment_status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 5. Earnings, as one indexed aggregate instead of a scan
-- ---------------------------------------------------------------------------
-- What computeSellerEarnings() was doing in JavaScript over 5,000 orders,
-- expressed once, correctly, over an index.
--
-- COMPLETED ORDERS ONLY, which is the rule that has always applied: a
-- pending order is a possible future sale, not a realised one.
--
-- The commission falls back to the rate in force NOW for lines placed
-- before rates were recorded on them -- the same precedence the TypeScript
-- applied, and the same reason: those lines were always computed that way,
-- so nothing about the past changes on the day this ships.

create or replace function seller_earnings(p_seller_id uuid)
returns table (
  completed_order_count bigint,
  gross_sales numeric,
  commission numeric,
  earnings numeric
) language sql stable security definer set search_path = public as $$
  with rate as (
    select coalesce(
      (select s.commission_rate from sellers s where s.id = p_seller_id),
      (select st.commission_rate from settings st where st.id = 1),
      0) as fallback
  ),
  lines as (
    select oi.order_id,
           oi.unit_price * oi.qty as line_total,
           oi.unit_price * oi.qty
             * coalesce(oi.commission_rate, (select fallback from rate)) / 100 as line_commission
      from order_items oi
      join orders o on o.id = oi.order_id
     where oi.seller_id = p_seller_id
       and o.status = 'completed'
  )
  select (select count(distinct order_id) from lines),
         coalesce((select sum(line_total) from lines), 0),
         coalesce((select sum(line_commission) from lines), 0),
         coalesce((select sum(line_total) - sum(line_commission) from lines), 0);
$$;

comment on function seller_earnings is
  'Gross sales, commission and net earnings for one seller across completed orders. One indexed aggregate; replaces a 5,000-row marketplace-wide scan.';

revoke all on function seller_earnings(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. A cancelled order cancels its lines
-- ---------------------------------------------------------------------------
-- Without this a seller's screen would keep showing "ready to dispatch" for
-- an order the buyer cancelled yesterday, and the seller would pack it.

create or replace function sync_order_item_cancellation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' then
    update order_items
       set fulfilment_status = 'cancelled'
     where order_id = new.id and fulfilment_status <> 'cancelled';
  end if;
  return null;
end $$;

drop trigger if exists trg_sync_order_item_cancellation on orders;
create trigger trg_sync_order_item_cancellation
  after update of status on orders
  for each row execute function sync_order_item_cancellation();

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
-- Buyer names and phone numbers are not in this table, but unit costs and
-- commission rates are -- the platform's margin on every line it has ever
-- sold. Nothing public reads it; every reader goes through the service role.
alter table order_items enable row level security;
revoke all on order_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify the derivation agrees with its source:
--
--   select count(*) from orders o
--    cross join lateral jsonb_array_elements(o.items) i
--    where coalesce((i->>'qty')::int, 0) > 0;
--   select count(*) from order_items;
--
-- The second may be smaller by exactly the lines whose product or seller
-- no longer exists, which are skipped on purpose.
--
-- Until this file is run, every reader falls back to the JSONB scan it has
-- always used. Nothing half-migrates.
-- ---------------------------------------------------------------------------
