-- ===========================================================================
-- Loja AIAI -- returns and refunds
--
-- The system could take an order and cancel one. It could not accept goods
-- back. orders.pay_status has listed 'refunded' since the first schema and
-- nothing ever set it; stock_movements has allowed reason = 'return' since
-- the ledger was added and only a cancellation ever wrote one. So a customer
-- handing back a pair of shoes had nowhere to be recorded, the pair could
-- not go back on the shelf, and the money going out did not exist.
--
-- A return is its own document, not a flag on the order. One order can be
-- returned in parts, on different days, for different reasons, and only some
-- of what comes back is fit to sell again.
--
-- Safe to re-run. Run AFTER supabase/stock-ledger.sql.
-- ===========================================================================

create table if not exists order_returns (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  -- RET + year + last four of the phone + six random, the same shape as an
  -- order reference so the two can be read out over the same phone call.
  ref          text not null unique,
  reason       text not null check (reason in
                 ('damaged','wrong_item','not_as_described','changed_mind','other')),
  note         text not null default '',
  -- What is actually being handed back, in the order's currency. Stored
  -- rather than derived: a shop may refund the delivery fee, or not, or
  -- settle on a different figure at the counter, and next year nobody will
  -- remember which.
  refund_total numeric(12,2) not null default 0 check (refund_total >= 0),
  refunded_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists order_returns_order_idx on order_returns (order_id, created_at desc);

create table if not exists order_return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references order_returns(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  -- Copied, not joined: a return has to stay readable after a product is
  -- deleted, exactly as an order line does.
  product_name text not null default '',
  qty          int not null check (qty > 0),
  -- Damaged goods come back into the building but not onto the shelf. This
  -- is the difference between a return and a restock, and conflating them
  -- is how a shop ends up selling something it knows is broken.
  restock      boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists order_return_items_return_idx on order_return_items (return_id);

-- ---------------------------------------------------------------------------
-- Restocking goes through the ledger, like everything else
-- ---------------------------------------------------------------------------
-- Per line, not per return: one return can bring back two sellable shirts
-- and one broken lamp, and only the shirts are stock again.

create or replace function apply_return_restock() returns trigger
language plpgsql as $$
declare o_id uuid; r_ref text;
begin
  if not new.restock or new.product_id is null then return new; end if;

  select r.order_id, r.ref into o_id, r_ref
    from order_returns r where r.id = new.return_id;

  insert into stock_movements (product_id, delta, reason, order_id, note)
  values (new.product_id, new.qty, 'return', o_id,
          'returned on ' || coalesce(r_ref, ''));
  return new;
end $$;

drop trigger if exists trg_apply_return_restock on order_return_items;
create trigger trg_apply_return_restock
  after insert on order_return_items
  for each row execute function apply_return_restock();

comment on function apply_return_restock is
  'A returned line that is fit to sell goes back through the ledger, so products.qty still has exactly one writer.';

-- ---------------------------------------------------------------------------
-- The order's payment status follows what has been refunded
-- ---------------------------------------------------------------------------
-- Derived rather than typed, for the same reason stock status is: two people
-- maintaining one fact is how they come to disagree.

create or replace function sync_order_refund_status() returns trigger
language plpgsql as $$
declare o_id uuid; refunded numeric; order_total numeric;
begin
  o_id := coalesce(new.order_id, old.order_id);

  select coalesce(sum(r.refund_total), 0) into refunded
    from order_returns r where r.order_id = o_id;

  select o.total into order_total from orders o where o.id = o_id;

  update orders set pay_status = case
      when refunded <= 0 then pay_status
      -- Refunding everything is 'refunded'. Refunding part of it is still a
      -- deposit position: some money stayed with the shop.
      when refunded >= coalesce(order_total, 0) then 'refunded'
      else 'deposit'
    end
   where id = o_id;

  return null;
end $$;

drop trigger if exists trg_sync_order_refund on order_returns;
create trigger trg_sync_order_refund
  after insert or update or delete on order_returns
  for each row execute function sync_order_refund_status();

-- ---------------------------------------------------------------------------
-- Grants -- a return is admin-only, like purchasing
-- ---------------------------------------------------------------------------
alter table order_returns enable row level security;
alter table order_return_items enable row level security;
revoke all on order_returns from anon, authenticated;
revoke all on order_return_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;
-- Still nothing: a restocked return is a movement like any other.
-- ---------------------------------------------------------------------------
