-- ===========================================================================
-- Loja AIAI -- stock, per size
--
-- Run AFTER supabase/stock-reservation.sql and supabase/procurement.sql.
-- Safe to re-run.
--
-- THE SHOP HAS THIRTY T-SHIRTS AND CANNOT SAY HOW MANY ARE MEDIUM.
--
-- products.sizes has always been a list of labels -- S, M, L -- and
-- products.qty a single number for all of them together. So a shopper is
-- offered Large on a product with none left in Large, the shelf runs out of
-- one size while the reorder alert stays quiet because the total still looks
-- healthy, and nobody can answer "how many Medium do we have" without going
-- to look.
--
-- WHAT THIS DOES NOT DO: invent a split for the stock already on the shelf.
-- The database does not know how those thirty shirts divide, and guessing
-- would put fabricated inventory in front of somebody ordering from it.
-- Existing stock stays UNSIZED, which is an honest third state, and the shop
-- converts it by counting -- see section 6.
--
-- THE SHAPE. stock_movements gains a size, and that is the whole mechanism:
-- the ledger already is the truth and products.qty already is its running
-- total. Per-size balances are the same sum grouped one column further, so
--
--   * products.qty keeps meaning exactly what it meant, and every screen,
--     view and trigger that reads it keeps working untouched;
--   * history stays reconstructable, per size, back to the first movement;
--   * there is still exactly ONE writer of stock.
--
-- A separate per-size table would have been a second source of truth, and
-- the two would have disagreed the first time anything failed midway.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The ledger learns the size
-- ---------------------------------------------------------------------------
-- '' rather than null for "no size", and the column is NOT NULL. A nullable
-- size would make every aggregate below need `is not distinct from`, and one
-- forgotten `= ''` would silently split a product's stock into two piles.
-- Empty string is one value that groups, compares and indexes like any other.

alter table stock_movements
  add column if not exists size text not null default '';

comment on column stock_movements.size is
  'Which size this movement is of, or '''' for goods that have no size (a fridge) and for stock counted before sizes were tracked. See supabase/size-stock.sql.';

-- The question every screen below asks: what is the balance of this product
-- in this size.
create index if not exists stock_movements_product_size_idx
  on stock_movements (product_id, size);

-- ---------------------------------------------------------------------------
-- 2. What is on the shelf, per size
-- ---------------------------------------------------------------------------
-- A view, not a table. It is a GROUP BY over the ledger, so it cannot drift
-- from the ledger, cannot be written to by mistake, and needs no trigger to
-- keep it honest.

create or replace view product_size_stock as
  select m.product_id,
         m.size,
         sum(m.delta)::int as qty
    from stock_movements m
   group by m.product_id, m.size;

comment on view product_size_stock is
  'Balance per product per size, summed from the ledger. size = '''' is stock with no size recorded -- either goods that have none, or stock counted before sizes were tracked.';

-- security_invoker so the view cannot be a way around the caller's own
-- permissions on stock_movements, which anon has none of.
alter view product_size_stock set (security_invoker = on);
revoke all on product_size_stock from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What a shopper may take
-- ---------------------------------------------------------------------------
-- THE RULE, and the reason it is not simply "the balance for that size":
--
--   available(product, size) = balance(size) + balance('')
--
-- Unsized stock is not stock of no size; it is stock whose size nobody has
-- recorded. Thirty shirts counted before this file existed can still be sold
-- as Medium, because some of them are Medium. So the unsized pool backs
-- every size, and a shop that has never tracked sizes behaves exactly as it
-- did yesterday -- which is the only acceptable behaviour on the day this
-- runs.
--
-- The TOTAL check in reserve_order_stock stays as well, and both must pass.
-- Together they can only ever refuse more than before, never allow more,
-- which is the safe direction for the one function standing between this
-- shop and overselling.

create or replace function size_available(p_product_id uuid, p_size text)
returns int language sql stable as $$
  select coalesce(sum(m.delta) filter (
           where m.size = coalesce(p_size, '') or m.size = ''), 0)::int
    from stock_movements m
   where m.product_id = p_product_id;
$$;

comment on function size_available is
  'Units of one size a shopper may take: that size plus the unsized pool, which is stock whose size was never recorded and could be any of them.';

revoke all on function size_available(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Holding and selling the right size
-- ---------------------------------------------------------------------------
-- sync_order_stock_state grouped by product and said so in a comment:
-- "the same product can appear twice under two sizes, and stock does not
-- care about sizes". It does now. Grouping one column further is the whole
-- change; the reconciliation logic underneath -- write only the difference,
-- so calling it twice is harmless -- is untouched.

create or replace function sync_order_stock_state(p_order_id uuid, p_state text)
returns void language plpgsql as $$
begin
  if p_state not in ('reserved', 'sold', 'released') then
    raise exception 'sync_order_stock_state: unknown state %', p_state;
  end if;

  with want as (
    -- Per product AND per size. Two lines of the same shirt in M and L are
    -- two rows here, and each moves its own size's balance.
    select (i->>'product_id')::uuid        as product_id,
           coalesce(i->>'size', '')        as size,
           sum((i->>'qty')::int)::int      as want,
           max(o.ref)                      as ref
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
       and exists (select 1 from products p where p.id = (i->>'product_id')::uuid)
     group by 1, 2
  ),
  done as (
    select m.product_id,
           m.size,
           sum(m.delta) filter (where m.reason = 'reservation')       as held,
           sum(m.delta) filter (where m.reason in ('sale','return'))  as sold
      from stock_movements m
     where m.order_id = p_order_id
     group by 1, 2
  ),
  move as (
    select w.product_id,
           w.size,
           w.ref,
           (case when p_state = 'reserved' then -w.want else 0 end)
             - coalesce(d.held, 0) as need_hold,
           (case when p_state = 'sold' then -w.want else 0 end)
             - coalesce(d.sold, 0) as need_sale
      from want w
      left join done d
        on d.product_id = w.product_id and d.size = w.size
  ),
  rows_to_write as (
    select product_id, size, need_hold as delta, 'reservation'::text as reason, ref
      from move where need_hold <> 0
    union all
    select product_id, size, need_sale,
           case when need_sale < 0 then 'sale' else 'return' end, ref
      from move where need_sale <> 0
  )
  insert into stock_movements (product_id, size, delta, reason, order_id, note)
  select r.product_id, r.size, r.delta, r.reason, p_order_id,
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
  'Moves an order stock effect to one of three targets: reserved, sold, or released -- per product AND per size. Writes only the difference, so it is safe to call any number of times and in any order.';

-- ---------------------------------------------------------------------------
-- 5. Refusing a size that is not there
-- ---------------------------------------------------------------------------
-- The total check is kept exactly as it was and a per-size one added beside
-- it. Both must pass. On a shop with no sizes recorded the second is vacuous
-- (the unsized pool backs every size, so it equals the total), which is what
-- makes this safe to run on a live database in the middle of a trading day.

create or replace function reserve_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_qty    int;
  v_name   text;
  v_out    boolean;
  v_pre    boolean;
  v_avail  int;
begin
  select coalesce(is_preorder, false) into v_pre from orders where id = p_order_id;
  if v_pre then return; end if;

  -- THE PRODUCT ROW IS STILL LOCKED ONCE PER PRODUCT, not once per size.
  -- Locking per size would let two baskets for two sizes of the same shirt
  -- pass the total check at the same time and oversell it between them --
  -- which is the exact race the lock exists to close.
  for r in
    select (i->>'product_id')::uuid   as product_id,
           sum((i->>'qty')::int)::int as want
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
     group by 1
     order by 1                      -- deadlock avoidance
  loop
    select p.qty, p.name, p.stock_status = 'out'
      into v_qty, v_name, v_out
      from products p
     where p.id = r.product_id
     for update;

    if not found then
      raise exception 'A product in your basket is no longer available'
        using errcode = 'no_data_found';
    end if;

    if v_out or r.want > v_qty then
      raise exception 'Only % left of "%"', greatest(v_qty, 0), v_name
        using errcode = 'check_violation';
    end if;
  end loop;

  -- Now the sizes, under the locks taken above.
  for r in
    select (i->>'product_id')::uuid   as product_id,
           coalesce(i->>'size', '')   as size,
           sum((i->>'qty')::int)::int as want
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
     group by 1, 2
     order by 1, 2
  loop
    -- An unsized line on a product the shop tracks by size is not checked
    -- against any particular size -- there is none to check -- and the
    -- total check above already covered it.
    if r.size = '' then continue; end if;

    select size_available(r.product_id, r.size) into v_avail;
    select p.name into v_name from products p where p.id = r.product_id;

    if r.want > v_avail then
      raise exception 'Only % left of "%" in size %', greatest(v_avail, 0), v_name, r.size
        using errcode = 'check_violation';
    end if;
  end loop;
end $$;

comment on function reserve_order_stock is
  'Locks each product row, verifies the basket fits BOTH the product total and each size, and holds the units. Raises with the product name, and the size when it is a size that ran out.';

revoke all on function reserve_order_stock(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Buying by size
-- ---------------------------------------------------------------------------
-- A purchase order line already carries a free-text `sizes` ("S, M, L"),
-- which says which sizes the product will HAVE and not how many of each.
-- This is how many of each.
--
-- jsonb rather than a child table: the line already owns its sizes as one
-- field, the object is written and read whole, and a child table would add a
-- join to every purchasing screen to hold what is always exactly one small
-- map. {"S": 5, "M": 10, "L": 15}.
--
-- qty stays the line's total and stays the number the money is calculated
-- from. The breakdown has to agree with it; the application adds the
-- breakdown up and writes the result into qty rather than trusting somebody
-- to keep two fields in step.

alter table purchase_order_items
  add column if not exists size_qty jsonb not null default '{}'::jsonb;

comment on column purchase_order_items.size_qty is
  'How many of each size this line buys, e.g. {"S":5,"M":10,"L":15}. Empty for goods with no sizes. Sums to qty -- see lib/sizeStock.ts.';

-- ---------------------------------------------------------------------------
-- 6b. Receiving the same line once PER SIZE
-- ---------------------------------------------------------------------------
-- stock_movements_receipt_once is unique on po_item_id alone. That is what
-- makes receiving idempotent -- a second click is rejected by Postgres
-- rather than by a check the application has to remember to do -- and it is
-- exactly wrong now: a line buying 5 S, 10 M and 15 L writes THREE
-- movements, and the old index would accept the first and reject the other
-- two. The shop would receive five shirts and believe it had thirty.
--
-- Replaced, not added to: two overlapping unique indexes would both have to
-- be satisfied, and the old one would still reject the second size.
--
-- The guarantee is unchanged in the case it was written for -- one receipt
-- per line per size, and an unsized line has exactly one size ('') so it is
-- still once per line.

drop index if exists stock_movements_receipt_once;

create unique index if not exists stock_movements_receipt_once
  on stock_movements (po_item_id, size)
  where reason = 'purchase_receipt' and po_item_id is not null;

comment on index stock_movements_receipt_once is
  'Receiving is idempotent per purchase-order line PER SIZE. A second receipt of the same line and size is rejected by Postgres, not by a check-then-insert that two concurrent clicks could both pass.';

-- ---------------------------------------------------------------------------
-- 7. Who the goods are for, decided when they are bought
-- ---------------------------------------------------------------------------
-- products.audience (men / women / unisex / unset) is set by hand in the
-- catalog today, which means every product created by receiving a purchase
-- order arrives unlabelled and has to be edited afterwards -- a second job,
-- done from memory, on a product whose buyer already knew the answer when
-- they ordered it.
--
-- Recorded on the LINE rather than on the order: one delivery routinely
-- carries men's and women's stock, and forcing a whole purchase order to be
-- one or the other would just move the re-editing somewhere else.
--
-- Null means "not said", which is also what it means on products: a fridge
-- is not unisex, it is simply not a question that applies. See
-- src/lib/audience.ts, which has documented that distinction since the
-- filter shipped.

alter table purchase_order_items
  add column if not exists audience text
    check (audience is null or audience in ('men','women','unisex'));

comment on column purchase_order_items.audience is
  'Who the goods on this line are for. Copied onto the product at receipt so the catalog does not have to be edited afterwards. Null = not said, which is not the same as unisex.';

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;
-- Still nothing: a sized movement is a movement like any other, and
-- products.qty is still the sum of all of them.
--
--   select p.name, s.size, s.qty
--     from product_size_stock s join products p on p.id = s.product_id
--    order by p.name, s.size;
-- Everything will read size '' until the shop counts its shelves in, which
-- is correct: nothing here invented a split for stock it cannot see.
-- ---------------------------------------------------------------------------
