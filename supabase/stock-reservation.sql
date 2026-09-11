-- ===========================================================================
-- Loja AIAI -- stock held from the moment it is ordered
--
-- Run AFTER supabase/stock-ledger.sql.
--
-- THE LAST CRITICAL FINDING. Stock only ever moved when an ADMIN confirmed
-- an order, so between placing and confirming -- which is minutes at best
-- and overnight in practice -- nothing held the units. Two consequences,
-- and the second is the one that bites at today's volume rather than at
-- scale:
--
--   1. placeOrder() read products.qty, decided the order fit, and inserted.
--      Read-then-write: n buyers arriving together all read qty = 1, all
--      pass, all get an order. Closing the `row.qty > 0 &&` short-circuit
--      removed the UNBOUNDED case; it did nothing about the race.
--   2. Even with no concurrency at all, the last unit stayed purchasable by
--      everybody until a human noticed. That is not a race, it is just the
--      shop advertising something it has already promised away.
--
-- WHY THIS IS A SMALLER CHANGE THAN IT LOOKS. sync_order_stock() already
-- states a TARGET and moves to it rather than applying deltas on each
-- transition -- which is what makes it safe to call repeatedly and in any
-- order. That design absorbs a third state cleanly: an order now targets a
-- RESERVATION while it is new, a SALE once it is live, and nothing once it
-- is cancelled. Every transition between those still converges, because
-- the function keeps writing only the difference.
--
-- WHAT A RESERVATION IS. A stock_movements row like any other, with
-- reason = 'reservation', and it moves products.qty exactly the way a sale
-- does. That is deliberate: it means "available" needs no new definition
-- and no new query. products.qty already IS availability, because
-- everything holding a unit has taken it out of the balance. The catalog,
-- the quantity ceiling and the reconciliation view all keep working with
-- no idea this file exists.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The ledger learns the word
-- ---------------------------------------------------------------------------
-- A check constraint listing the reasons has to be replaced, not added to.
-- Dropped by name and rebuilt so re-running this is a no-op rather than a
-- second constraint saying something subtly different.

alter table stock_movements
  drop constraint if exists stock_movements_reason_check;

alter table stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('purchase_receipt','sale','adjustment','return',
                    'correction','reservation'));

comment on column stock_movements.reason is
  'purchase_receipt, sale, return, adjustment, correction, or reservation -- units held for an order that has been placed and not yet confirmed. A reservation moves the balance exactly like a sale; see supabase/stock-reservation.sql.';

-- The sweep in section 4 asks "which orders are still holding units", which
-- is a question about a handful of rows in a table that only grows.
create index if not exists stock_movements_open_reservation_idx
  on stock_movements (order_id)
  where reason = 'reservation';

-- ---------------------------------------------------------------------------
-- 2. Three targets instead of two
-- ---------------------------------------------------------------------------
-- The old signature took a boolean, which could only express two states.
-- This one names the state, and tracks the two kinds of holding SEPARATELY
-- so that confirming an order writes the pair that converts one into the
-- other:
--
--     reservation  -3    (placed)
--     reservation  +3    (confirmed: the hold is released...)
--     sale         -3    (...and becomes a sale)
--
-- Net movement on confirmation: zero. The units never come back onto the
-- shelf and are never taken twice. And the ledger says, in order, exactly
-- what happened to them -- which is the entire reason for having one.
--
-- Cancelling from either state releases whichever is outstanding, so an
-- order cancelled before confirmation gives back its reservation and one
-- cancelled after gives back its sale, with no special case for either.

create or replace function sync_order_stock_state(p_order_id uuid, p_state text)
returns void language plpgsql as $$
begin
  if p_state not in ('reserved', 'sold', 'released') then
    raise exception 'sync_order_stock_state: unknown state %', p_state;
  end if;

  with want as (
    -- What this order asks of each product, lines added up: the same
    -- product can appear twice under two sizes, and stock does not care
    -- about sizes.
    select (i->>'product_id')::uuid   as product_id,
           sum((i->>'qty')::int)::int as want,
           max(o.ref)                 as ref
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
       and exists (select 1 from products p where p.id = (i->>'product_id')::uuid)
     group by 1
  ),
  done as (
    -- Held and sold are summed apart, because the target for each is
    -- different in every state and netting them would make 'reserved' and
    -- 'sold' indistinguishable -- which is exactly the distinction the
    -- sweep in section 4 depends on.
    select m.product_id,
           sum(m.delta) filter (where m.reason = 'reservation')       as held,
           sum(m.delta) filter (where m.reason in ('sale','return'))  as sold
      from stock_movements m
     where m.order_id = p_order_id
     group by 1
  ),
  move as (
    select w.product_id,
           w.ref,
           (case when p_state = 'reserved' then -w.want else 0 end)
             - coalesce(d.held, 0) as need_hold,
           (case when p_state = 'sold' then -w.want else 0 end)
             - coalesce(d.sold, 0) as need_sale
      from want w
      left join done d on d.product_id = w.product_id
  ),
  rows_to_write as (
    select product_id, need_hold as delta, 'reservation'::text as reason, ref
      from move where need_hold <> 0
    union all
    select product_id, need_sale,
           case when need_sale < 0 then 'sale' else 'return' end, ref
      from move where need_sale <> 0
  )
  insert into stock_movements (product_id, delta, reason, order_id, note)
  select r.product_id, r.delta, r.reason, p_order_id,
         case
           when r.reason = 'reservation' and r.delta < 0
             then 'held for order ' || coalesce(r.ref, '')
           when r.reason = 'reservation'
             then 'hold released, order ' || coalesce(r.ref, '')
           when r.delta < 0 then 'order ' || coalesce(r.ref, '')
           else 'returned to stock, order ' || coalesce(r.ref, '')
         end
    from rows_to_write r;
end $$;

comment on function sync_order_stock_state is
  'Moves an order stock effect to one of three targets: reserved (held, not yet confirmed), sold, or released. Writes only the difference, so it is safe to call any number of times and in any order.';

-- The old two-argument form stays, delegating, so anything still calling it
-- keeps working and keeps meaning the same thing. Not dropped: a function
-- signature is an interface, and this file should not be able to break a
-- caller it has not been shown.
create or replace function sync_order_stock(p_order_id uuid, p_take boolean)
returns void language plpgsql as $$
begin
  perform sync_order_stock_state(p_order_id, case when p_take then 'sold' else 'released' end);
end $$;

comment on function sync_order_stock is
  'Legacy two-state wrapper around sync_order_stock_state(). p_take true means sold, false means released.';

-- ---------------------------------------------------------------------------
-- 3. Reserving, with the check and the write in one place
-- ---------------------------------------------------------------------------
-- THE POINT OF THIS FUNCTION IS THE LOCK. Everything else it does was
-- already being done in TypeScript; what could not be done there is holding
-- the product row still between deciding there is enough and taking it.
--
-- SELECT ... FOR UPDATE makes concurrent callers queue on the row rather
-- than all reading the same number. Two orders for the last unit therefore
-- resolve as one success and one refusal, in some order, instead of two
-- successes -- which is the whole finding.
--
-- Rows are locked in product_id order. Two orders containing the same two
-- products in opposite basket order would otherwise take the two locks in
-- opposite orders and deadlock; sorting makes that impossible rather than
-- unlikely.
--
-- Raises on insufficient stock, naming the product and what is actually
-- left, so the caller can put a real sentence in front of the buyer. The
-- raise aborts the whole function, so a basket that fails on its third line
-- leaves no hold behind from the first two.

create or replace function reserve_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_qty    int;
  v_name   text;
  v_out    boolean;
  v_pre    boolean;
begin
  -- A pre-order has no stock to hold -- that is what makes it a pre-order --
  -- and holding some would be the shop taking units it has already said it
  -- does not have.
  select coalesce(is_preorder, false) into v_pre from orders where id = p_order_id;
  if v_pre then return; end if;

  for r in
    select (i->>'product_id')::uuid   as product_id,
           sum((i->>'qty')::int)::int as want
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
     group by 1
     order by 1                      -- deadlock avoidance; see above
  loop
    select p.qty, p.name, p.stock_status = 'out'
      into v_qty, v_name, v_out
      from products p
     where p.id = r.product_id
     for update;                     -- the lock this function exists for

    if not found then
      raise exception 'A product in your basket is no longer available'
        using errcode = 'no_data_found';
    end if;

    -- An out-of-stock line in a non-pre-order basket should have been
    -- refused before the order was written. Reaching here means the product
    -- sold out between then and now, which is precisely the race.
    if v_out or r.want > v_qty then
      raise exception 'Only % left of "%"', greatest(v_qty, 0), v_name
        using errcode = 'check_violation';
    end if;
  end loop;

  -- Every row is locked and every line fits. Nothing else can take these
  -- units until this transaction ends.
  perform sync_order_stock_state(p_order_id, 'reserved');
end $$;

comment on function reserve_order_stock is
  'Locks each product row, verifies the whole basket fits, and holds the units. Raises with the product name if it does not. Called by RPC from placeOrder so the check and the write cannot be separated.';

revoke all on function reserve_order_stock(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The status trigger, taught the third state
-- ---------------------------------------------------------------------------
-- 'new' is now a state that HOLDS stock rather than one that does nothing.
-- Everything from 'confirmed' onward converts the hold into a sale, and
-- 'cancelled' releases whichever is outstanding.

create or replace function decrement_stock_on_confirm() returns trigger as $$
begin
  if coalesce(new.is_preorder, false) then return new; end if;

  if new.status = 'cancelled' then
    perform sync_order_stock_state(new.id, 'released');
  elsif new.status = 'new' then
    perform sync_order_stock_state(new.id, 'reserved');
  else
    perform sync_order_stock_state(new.id, 'sold');
  end if;

  return new;
end;
$$ language plpgsql;

comment on function decrement_stock_on_confirm is
  'Keeps an order stock effect in step with its status: new holds a reservation, live states hold a sale, cancelled holds nothing. products.qty is moved by apply_stock_movement(), never here.';

-- ---------------------------------------------------------------------------
-- 5. Giving back what was never confirmed
-- ---------------------------------------------------------------------------
-- A reservation with nothing behind it is worse than no reservation: it
-- takes a real unit off the shelf on behalf of somebody who has gone. An
-- order placed for cash-on-delivery and then abandoned would otherwise hold
-- its units until a human noticed, which is the same failure as the one
-- this file fixes, only slower.
--
-- So a hold has a lifetime. Anything still sitting at 'new' after
-- p_hours goes back on the shelf, and the order is cancelled with a reason
-- rather than left looking live with no stock behind it -- an order the shop
-- believes in and cannot fill is the state to avoid.
--
-- The window is a parameter and not a constant here because it is a
-- business decision (how long do you give somebody to pay by transfer?) and
-- belongs with whoever schedules the sweep. See
-- src/app/api/cron/release-reservations.

create or replace function release_stale_reservations(p_hours int default 48)
returns table (order_id uuid, order_ref text, released int)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_units int;
begin
  if p_hours is null or p_hours < 1 then
    raise exception 'release_stale_reservations: p_hours must be at least 1 (got %)', p_hours;
  end if;

  for r in
    select o.id, o.ref
      from orders o
     where o.status = 'new'
       and o.created_at < now() - make_interval(hours => p_hours)
       -- Only orders actually holding something. An order that never
       -- reserved (a pre-order, or one placed before this file was run)
       -- is not stale stock and is not this function's business.
       and exists (select 1 from stock_movements m
                    where m.order_id = o.id and m.reason = 'reservation')
       -- and still net-holding, rather than one already released by hand
       and coalesce((select sum(m.delta) from stock_movements m
                      where m.order_id = o.id and m.reason = 'reservation'), 0) < 0
     order by o.created_at
  loop
    select coalesce(-sum(m.delta), 0)::int into v_units
      from stock_movements m
     where m.order_id = r.id and m.reason = 'reservation';

    -- Cancelling fires the trigger in section 4, which releases the hold.
    -- Done through the status rather than by writing movements directly, so
    -- there is exactly one path that ends a reservation and the order does
    -- not survive as a live order with no stock behind it.
    update orders
       set status = 'cancelled',
           cancel_reason = coalesce(nullif(cancel_reason, ''),
             'Reservation expired: not confirmed within ' || p_hours || ' hours')
     where id = r.id;

    insert into order_log (order_id, text)
    values (r.id, 'Rezerva liu tempu (' || p_hours || 'h). Stok fila ba prateleira.');

    order_id := r.id; order_ref := r.ref; released := v_units;
    return next;
  end loop;
end $$;

comment on function release_stale_reservations is
  'Cancels orders left unconfirmed past p_hours and gives their held units back. Returns one row per order released.';

revoke all on function release_stale_reservations(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. What is being held right now
-- ---------------------------------------------------------------------------
-- The reconciliation view answers "does the ledger agree with the balance".
-- This answers the other question a shopkeeper asks: "how much of what I
-- appear not to have is actually just waiting on somebody to pay?"

create or replace view stock_reservations as
select m.order_id,
       o.ref,
       o.buyer_name,
       o.created_at,
       p.id                          as product_id,
       p.ref                         as product_ref,
       p.name                        as product_name,
       (-sum(m.delta))::int          as held,
       (now() - o.created_at)        as waiting
  from stock_movements m
  join orders   o on o.id = m.order_id
  join products p on p.id = m.product_id
 where m.reason = 'reservation'
 group by m.order_id, o.ref, o.buyer_name, o.created_at, p.id, p.ref, p.name
having sum(m.delta) < 0;

comment on view stock_reservations is
  'Units currently held by orders that have been placed and not yet confirmed. Empty is the healthy steady state for a shop that confirms promptly.';

revoke all on stock_reservations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Existing unconfirmed orders start holding their stock
-- ---------------------------------------------------------------------------
-- Without this, every order already sitting at 'new' when this file runs
-- would keep its units on the shelf forever -- the old behaviour, silently
-- preserved for exactly the orders most likely to be affected by it.
--
-- Runs with the balance trigger LIVE, on purpose: these holds have not been
-- applied to products.qty yet and should be. A balance that goes negative
-- here is not this file misbehaving, it is the oversell that had already
-- happened becoming visible, which is what the ledger is for.

do $$
declare o record; n int := 0;
begin
  for o in
    select id from orders
     where status = 'new'
       and not coalesce(is_preorder, false)
       and not exists (select 1 from stock_movements m
                        where m.order_id = orders.id and m.reason = 'reservation')
  loop
    perform sync_order_stock_state(o.id, 'reserved');
    n := n + 1;
  end loop;
  raise notice 'reservation backfill: % unconfirmed order(s) now holding stock', n;
end $$;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;   -- still nothing
--   select * from stock_reservations order by waiting desc; -- what is held
--
-- Until this file is run, placeOrder's RPC call finds no such function,
-- treats it as "this database does not reserve yet", and the shop behaves
-- exactly as it did before -- stock moving on confirmation, and the race
-- still open. There is no half-applied state.
-- ---------------------------------------------------------------------------
