-- ===========================================================================
-- Loja AIAI -- complete the stock ledger
--
-- stock_movements already calls itself "the history behind products.qty".
-- It was not. Only purchase receipts were ever written to it: a sale changed
-- products.qty through decrement_stock_on_confirm(), marking a line out of
-- stock in the admin set qty to 0 directly, and typing a number into the
-- product form overwrote the balance outright. The ledger therefore did not
-- sum to the balance, and the question a stock ledger exists to answer --
-- "why does this say 7?" -- had no answer.
--
-- This makes the ledger the ONLY way products.qty ever moves. Every change
-- becomes a row; apply_stock_movement() turns rows into the balance. After
-- this, sum(delta) = qty for every product, and stock_reconciliation says so
-- out loud.
--
-- Also fixes a real loss: cancelling a confirmed order never gave its units
-- back. They were decremented on confirmation and stayed gone.
--
-- Safe to re-run. Run AFTER supabase/stock-receipt.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. One function that makes an order's stock effect match its status
-- ---------------------------------------------------------------------------
-- Not "decrement on confirm, add back on cancel". That phrasing is what
-- makes stock drift: every transition has to fire exactly once, in order,
-- forever, and an order that is cancelled and then confirmed again breaks it.
--
-- Instead this states the TARGET and moves to it. A live order should have
-- taken its units; a cancelled one should have taken nothing. The function
-- compares that target with what the ledger already says this order did and
-- writes only the difference.
--
-- Every sequence therefore converges, however many times it fires and in
-- whatever order: confirming twice writes nothing the second time, cancelling
-- twice refunds once, and cancel-then-confirm-again takes the stock properly
-- instead of leaving the shop believing in units it has already sold.

create or replace function sync_order_stock(p_order_id uuid, p_take boolean)
returns void language plpgsql as $$
begin
  with want as (
    -- What this order asks of each product, with its lines added up: the
    -- same product can appear twice under two sizes, and stock does not
    -- care about sizes.
    select (i->>'product_id')::uuid      as product_id,
           sum((i->>'qty')::int)::int    as want,
           max(o.ref)                    as ref
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
       -- a line pointing at a product that no longer exists has no stock
       -- to move, and would fail the foreign key if it tried
       and exists (select 1 from products p where p.id = (i->>'product_id')::uuid)
     group by 1
  ),
  done as (
    -- What this order has already done to each product, whichever way.
    select m.product_id, sum(m.delta)::int as done
      from stock_movements m
     where m.order_id = p_order_id
       and m.reason in ('sale','return')
     group by 1
  ),
  move as (
    select w.product_id,
           w.ref,
           (case when p_take then -w.want else 0 end) - coalesce(d.done, 0) as needed
      from want w
      left join done d on d.product_id = w.product_id
  )
  insert into stock_movements (product_id, delta, reason, order_id, note)
  select m.product_id,
         m.needed,
         case when m.needed < 0 then 'sale' else 'return' end,
         p_order_id,
         case when m.needed < 0 then 'order ' else 'returned to stock, order ' end
           || coalesce(m.ref, '')
    from move m
   where m.needed <> 0;
end $$;

comment on function sync_order_stock is
  'Moves an order stock effect to its target: p_take true means it should have taken its units, false means none. Writes only the difference, so it is safe to call any number of times.';

-- ---------------------------------------------------------------------------
-- 2. A sale writes a ledger row instead of touching products
-- ---------------------------------------------------------------------------
create or replace function decrement_stock_on_confirm() returns trigger as $$
begin
  -- A pre-order has no stock to take -- that is the whole point of it -- and
  -- must not be handed back on cancellation either, so it is excluded from
  -- both directions rather than only from the taking.
  if coalesce(new.is_preorder, false) then return new; end if;

  if new.status = 'cancelled' then
    perform sync_order_stock(new.id, false);
  elsif new.status in ('confirmed','preparing','out','arrived','completed') then
    perform sync_order_stock(new.id, true);
  end if;

  return new;
end;
$$ language plpgsql;

comment on function decrement_stock_on_confirm is
  'Keeps an order stock effect in step with its status. products.qty is moved by apply_stock_movement(), never here.';

-- ---------------------------------------------------------------------------
-- 3. The old trigger is replaced, not supplemented
-- ---------------------------------------------------------------------------
-- Reinstalled rather than left alone because it now has to fire on a
-- cancellation too, and the original was registered for status changes only.

drop trigger if exists trg_decrement_stock on orders;
create trigger trg_decrement_stock
  after update of status on orders
  for each row execute function decrement_stock_on_confirm();

-- ---------------------------------------------------------------------------
-- 3b. The balance stops being floored at zero
-- ---------------------------------------------------------------------------
-- apply_stock_movement() clamped products.qty with greatest(0, ...). That
-- looks protective and is the one thing that can silently break a ledger:
-- confirm an order for 500 units of a product with 96 on hand and the ledger
-- records -500 while the balance stops at 0, so the two disagree by 404 and
-- stock_reconciliation can never come back to zero.
--
-- A negative balance is not a bug to be hidden. It is the shop having
-- promised units it does not have, which is exactly the thing someone needs
-- to be told. So the balance now says so, and stock_status still reads 'out'
-- to anyone shopping, who should see no difference.

create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
begin
  update products
     set qty = qty + new.delta,
         stock_status = case
           when qty + new.delta <= 0 then 'out'
           when qty + new.delta <= 2 then 'low'
           else 'in' end
   where id = new.product_id;
  return new;
end $$;

comment on function apply_stock_movement is
  'The only thing that moves products.qty. Never clamps: a negative balance is an oversell, and hiding it would put the ledger and the balance permanently out of step.';

-- ---------------------------------------------------------------------------
-- 4. Reconciliation
-- ---------------------------------------------------------------------------
-- The ledger is only worth having if it agrees with the balance. This view
-- is the proof, and the thing to look at first if a count is ever disputed.

create or replace view stock_reconciliation as
select p.id                                  as product_id,
       p.ref,
       p.name,
       p.qty                                 as balance,
       coalesce(sum(m.delta), 0)::int        as ledger,
       p.qty - coalesce(sum(m.delta), 0)::int as drift,
       count(m.id)                           as movements
  from products p
  left join stock_movements m on m.product_id = p.id
 group by p.id, p.ref, p.name, p.qty;

comment on view stock_reconciliation is
  'One row per product: the balance, what the ledger sums to, and the drift between them. drift <> 0 means something wrote products.qty without a movement.';

-- ---------------------------------------------------------------------------
-- 5. Backfill: past sales first, then whatever is left as an opening balance
-- ---------------------------------------------------------------------------
-- Both inserts run with apply_stock_movement() switched off. These rows
-- RECORD history that has already happened to products.qty; letting the
-- trigger apply them again would move every balance a second time.

do $$
declare sales int; opening int;
begin
  alter table stock_movements disable trigger trg_apply_stock_movement;

  -- 5a. Every order that has already taken its stock gets its sale rows.
  --
  -- Those statuses are exactly the ones an order can only reach by passing
  -- through 'confirmed', which is where the old trigger decremented. A
  -- cancelled order is deliberately left out: under the old trigger it was
  -- decremented on confirmation and never given back, so a cancelled order
  -- MAY have consumed stock -- but the row no longer says whether it was
  -- ever confirmed, and inventing a sale that never happened is worse than
  -- leaving it in the opening balance below, where it is at least honest.
  insert into stock_movements (product_id, delta, reason, order_id, note, created_at)
  select (i->>'product_id')::uuid,
         -sum((i->>'qty')::int),
         'sale',
         o.id,
         'order ' || coalesce(o.ref, '') || ' (recorded when the ledger was completed)',
         o.created_at
    from orders o
    cross join lateral jsonb_array_elements(o.items) i
   where o.status in ('confirmed','preparing','out','arrived','completed')
     and not coalesce(o.is_preorder, false)
     and nullif(i->>'product_id', '') is not null
     and coalesce((i->>'qty')::int, 0) > 0
     and exists (select 1 from products p where p.id = (i->>'product_id')::uuid)
     -- Skip any order the ledger already accounts for, which is what makes
     -- this file safe to run twice.
     and not exists (select 1 from stock_movements m
                      where m.order_id = o.id and m.reason in ('sale','return'))
   group by (i->>'product_id')::uuid, o.id, o.ref, o.created_at;
  get diagnostics sales = row_count;

  -- 5b. What is still unexplained becomes one dated opening row.
  --
  -- Positive is ordinary: stock the shop held before it kept a ledger.
  -- Negative means units left without a document -- breakage, a miscount, a
  -- cancelled order that had been confirmed. It is labelled as unexplained
  -- rather than dressed up as an opening balance, because that is what it is.
  insert into stock_movements (product_id, delta, reason, note, created_at)
  select r.product_id, r.drift, 'correction',
         case when r.drift > 0 then 'opening balance, held before the ledger existed'
              else 'unexplained shortfall, recorded when the ledger was completed' end,
         -- Dated before every movement it explains, so a history read top to
         -- bottom starts at the opening balance rather than ending at it.
         coalesce((select min(m.created_at) - interval '1 second'
                     from stock_movements m where m.product_id = r.product_id),
                  now())
    from stock_reconciliation r
   where r.drift <> 0;
  get diagnostics opening = row_count;

  alter table stock_movements enable trigger trg_apply_stock_movement;

  raise notice 'backfill: % past sales, % opening rows', sales, opening;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants -- the ledger is admin-only, like the rest of purchasing
-- ---------------------------------------------------------------------------
revoke all on stock_reconciliation from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;
-- It should return nothing, now and after every sale, receipt, cancellation
-- and adjustment from here on.
-- ---------------------------------------------------------------------------
