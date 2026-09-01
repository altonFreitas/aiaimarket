-- ===========================================================================
-- preorders.sql — let a shopper order something that is out of stock.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor -> New query.
--
-- A PRE-ORDER IS AN ORDER, not a second kind of thing.
--
-- It is the same row in the same table, with one flag set. That is the whole
-- design, and it is what makes the feature small: tracking links, the buyer
-- SMS, the admin order screens, the sales dashboard and the payout ledger
-- all keep working with no changes at all. A parallel "preorders" table
-- would have needed every one of those rebuilt, and would have drifted from
-- the real thing the first time either side changed.
--
-- What tells them apart is the reference prefix (PRO...) and this flag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------

alter table orders add column if not exists is_preorder boolean not null default false;

comment on column orders.is_preorder is
  'True when the order was placed for goods that were out of stock. Set by the SERVER from live stock, never from the browser.';

create index if not exists orders_preorder_idx on orders (is_preorder) where is_preorder;

-- ---------------------------------------------------------------------------
-- 2. Per-product opt-out, and the promised date
-- ---------------------------------------------------------------------------
-- Enabled by default: an out-of-stock product a shopper wants is a sale
-- waiting to happen, and the shop's own screens already show which those
-- are. Turn it off for a line being discontinued, where taking money for
-- something that will never arrive is the wrong answer.

alter table products add column if not exists preorder_enabled boolean not null default true;

-- When the shop expects to have it. Optional, and shown to the buyer when
-- set: "we don't know yet" is a legitimate answer and better than inventing
-- a date that will be missed.
alter table products add column if not exists preorder_eta date;

comment on column products.preorder_eta is
  'Expected availability. NULL means genuinely unknown, which is shown as such rather than guessed.';

-- ---------------------------------------------------------------------------
-- 3. Stock must not move for a pre-order
-- ---------------------------------------------------------------------------
-- The original trigger (schema.sql) decrements on confirm. For a pre-order
-- there is nothing to decrement -- that is the entire point -- and letting
-- it run would quietly hide the shortage: greatest(0, ...) floors at zero,
-- so the shelf would keep reading "0" while the promises pile up invisibly.
-- Stock moves when the goods actually arrive, through the purchase receipt.

create or replace function decrement_stock_on_confirm() returns trigger as $$
declare item jsonb;
begin
  if new.status = 'confirmed' and old.status = 'new' and not coalesce(new.is_preorder, false) then
    for item in select * from jsonb_array_elements(new.items) loop
      update products
        set qty = greatest(0, qty - (item->>'qty')::int),
            stock_status = case
              when greatest(0, qty - (item->>'qty')::int) = 0 then 'out'
              when greatest(0, qty - (item->>'qty')::int) <= 2 then 'low'
              else stock_status end
        where id = (item->>'product_id')::uuid;
    end loop;
  end if;
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing else changes. A pre-order gets a PRO reference, appears in the
-- admin order list beside every other order, sends the same tracking SMS,
-- and is fulfilled the same way once the stock arrives.
-- ---------------------------------------------------------------------------
