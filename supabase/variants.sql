-- ===========================================================================
-- Loja AIAI -- product variants
--
-- Run AFTER supabase/taxonomy.sql, supabase/size-stock.sql and
-- supabase/product-attributes.sql. Safe to re-run.
--
-- THE SHOP CAN SAY "THIRTY SHIRTS, TEN MEDIUM". IT CANNOT SAY "TEN BLACK
-- MEDIUM". Stock has one axis -- size, a text column on the ledger -- and
-- that was the right shape while every product varied one way. A catalogue
-- that also sells phones in 128GB and 256GB, and shirts in black and white
-- AND medium and large, needs more than one.
--
-- WHAT THIS FILE IS CAREFUL ABOUT, above everything else. reserve_order_stock
-- is the one function standing between this shop and overselling: it locks
-- each product row, checks the basket fits, and holds the units, all inside
-- one transaction. It has been got wrong before -- an earlier rewrite dropped
-- the line that actually held the stock, so two orders for the last shirt
-- were both accepted. So this file does not rewrite the size logic. It ADDS a
-- variant check beside it and leaves every existing line exactly where it
-- was. A basket with no variants behaves identically, instruction for
-- instruction, to the way it behaved yesterday.
--
-- PHASED, NOT SWAPPED. stock_movements and order_items gain variant_id
-- ALONGSIDE size, not instead of it. Existing rows keep working, existing
-- reads keep working, and `size` retires only once variants have carried the
-- shop for a while. A migration that turned the ledger inside out in one
-- step would be betting the shelf on getting it right first time.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The variants themselves
-- ---------------------------------------------------------------------------
-- One row per sellable combination: "Black / M", "256GB / Blue".
--
-- price, discount_price, cost_price and weight are all NULLABLE, and null
-- means "whatever the product says". A t-shirt whose sizes all cost the same
-- -- which is most t-shirts -- carries null in every one of them, and
-- changing the product's price still changes all of them at once. Copying the
-- product price into every variant at creation would look identical on day
-- one and quietly stop tracking on day two.

create table if not exists product_variants (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,

  -- What this combination is called: "Black / M". Built from the variant's
  -- own attribute values, and stored rather than derived because it is
  -- shown on order lines and in the ledger, which must still read
  -- correctly years after somebody renames an option.
  label          text not null,

  sku            text,
  barcode        text,

  -- Null means "as the product". See the note above.
  price          numeric(10,2) check (price is null or price >= 0),
  discount_price numeric(10,2) check (discount_price is null or discount_price > 0),
  cost_price     numeric(14,4) check (cost_price is null or cost_price >= 0),
  weight         numeric(10,3) check (weight is null or weight >= 0),

  status         text not null default 'active'
                   check (status in ('active', 'hidden')),
  display_order  int  not null default 0,
  created_at     timestamptz not null default now(),

  -- Two variants of one product cannot share a label: it is what the order
  -- line and the picker show, and two identical ones would be
  -- indistinguishable to everybody including the shop.
  unique (product_id, label)
);

create index if not exists product_variants_product_idx
  on product_variants (product_id, display_order);

-- A SKU is the shop's own handle for a variant and has to be unique when it
-- is given. Partial, because most variants never get one.
create unique index if not exists product_variants_sku_idx
  on product_variants (sku) where sku is not null;

comment on table product_variants is
  'One row per sellable combination of a product. price/cost/weight null means "as the product" -- see supabase/variants.sql.';

-- ---------------------------------------------------------------------------
-- 2. What distinguishes each variant
-- ---------------------------------------------------------------------------
-- "Black / M" is Colour=Black and Size=M: two rows here. Only attributes
-- flagged is_variant may appear, which is what stops somebody building a
-- variant per Brand and multiplying the catalogue by nothing.

create table if not exists variant_attribute_values (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references product_variants(id) on delete cascade,
  attribute_id  uuid not null references attributes(id) on delete cascade,
  value         text not null,
  created_at    timestamptz not null default now(),

  -- One value per axis per variant. A variant cannot be both Black and
  -- White; that is two variants.
  unique (variant_id, attribute_id)
);

create index if not exists vav_variant_idx
  on variant_attribute_values (variant_id);
create index if not exists vav_filter_idx
  on variant_attribute_values (attribute_id, value);

-- ---------------------------------------------------------------------------
-- 3. The ledger and the order line learn the variant
-- ---------------------------------------------------------------------------
-- ALONGSIDE size, deliberately. Every existing row has a size and no
-- variant, every existing query still reads size, and nothing about today's
-- behaviour changes. New rows carry both once the catalogue has variants.
--
-- ON DELETE SET NULL, not CASCADE: deleting a variant must never delete
-- ledger history. The balance it contributed is part of how the shop's
-- stock got where it is, and a movement with a null variant is the same
-- honest "no variant recorded" as an unsized one.

alter table stock_movements
  add column if not exists variant_id uuid
    references product_variants(id) on delete set null;

alter table order_items
  add column if not exists variant_id uuid
    references product_variants(id) on delete set null;

create index if not exists stock_movements_variant_idx
  on stock_movements (product_id, variant_id);
create index if not exists order_items_variant_idx
  on order_items (variant_id) where variant_id is not null;

comment on column stock_movements.variant_id is
  'Which variant this movement is of, or null for stock with no variant recorded -- goods that have none, and everything counted before variants existed. Sits beside `size`, which is still written; see supabase/variants.sql.';

-- ---------------------------------------------------------------------------
-- 4. What is on the shelf, per variant
-- ---------------------------------------------------------------------------
-- The same GROUP BY the per-size view is, one column further. A view rather
-- than a table, so it cannot drift from the ledger and needs no trigger.

create or replace view product_variant_stock as
  select m.product_id,
         m.variant_id,
         sum(m.delta)::int as qty
    from stock_movements m
   where m.variant_id is not null
   group by m.product_id, m.variant_id;

comment on view product_variant_stock is
  'Balance per product per variant, summed from the ledger.';

alter view product_variant_stock set (security_invoker = on);
revoke all on product_variant_stock from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. What a shopper may take of one variant
-- ---------------------------------------------------------------------------
-- THE RULE, and it is the same one size_available() uses, for the same
-- reason:
--
--   available(product, variant) = balance(variant) + balance(no variant)
--
-- Stock with no variant recorded is not stock of no variant; it is stock
-- whose variant nobody wrote down. Thirty shirts counted before this file
-- existed can still be sold as Black/M, because some of them are. So the
-- unrecorded pool backs every variant, and a shop that has never used
-- variants behaves exactly as it did yesterday -- which is the only
-- acceptable behaviour on the day this runs.

create or replace function variant_available(p_product_id uuid, p_variant_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(m.delta), 0)::int
    from stock_movements m
   where m.product_id = p_product_id
     and (m.variant_id = p_variant_id or m.variant_id is null);
$$;

comment on function variant_available is
  'Units of one variant a shopper may take: its own balance plus the pool whose variant was never recorded. Mirrors size_available().';

revoke all on function variant_available(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5b. Row level security
-- ---------------------------------------------------------------------------
-- READABLE BY ANYONE, because the storefront needs it: a product page
-- cannot offer "Black / M" without reading the variants, and that runs as
-- anon. Nothing here is a secret -- it is the shape of what is for sale.
--
-- Hidden variants are NOT readable, the same way a hidden product type is
-- not: `status` is how a shop takes a combination off sale without
-- deleting its history, and a policy that ignored it would leave the
-- picker still offering it.
--
-- COST PRICE IS THE ONE THING THAT MUST NOT LEAK. It is on this table
-- because a variant can cost a different amount to buy, and a storefront
-- that could read it would be publishing the shop's margin. Column-level
-- grants, not a policy: a policy filters ROWS, and the row has to be
-- readable for the picker to work at all.

alter table product_variants          enable row level security;
alter table variant_attribute_values  enable row level security;

drop policy if exists product_variants_public_read on product_variants;
create policy product_variants_public_read on product_variants
  for select using (status = 'active');

drop policy if exists vav_public_read on variant_attribute_values;
create policy vav_public_read on variant_attribute_values
  for select using (
    exists (
      select 1 from product_variants v
       where v.id = variant_attribute_values.variant_id
         and v.status = 'active'
    )
  );

revoke all on product_variants         from anon, authenticated;
revoke all on variant_attribute_values from anon, authenticated;

-- Everything the picker draws with, and cost_price is deliberately absent.
grant select (id, product_id, label, sku, barcode, price, discount_price,
              weight, status, display_order, created_at)
  on product_variants to anon, authenticated;
grant select on variant_attribute_values to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The reservation learns about variants
-- ---------------------------------------------------------------------------
-- THIS FUNCTION IS THE ONE THING STANDING BETWEEN THE SHOP AND OVERSELLING,
-- and it has been got wrong before: an earlier rewrite dropped the line that
-- actually HELD the stock, so the check passed, nothing was written, the lock
-- was released at commit, and the next shopper passed the same check against
-- the same unit. Two orders for the last shirt were both accepted.
--
-- So this definition is the previous one (supabase/size-stock.sql) with ONE
-- loop added and NOTHING removed:
--
--   * the per-product lock, in product_id order, unchanged;
--   * the total check, unchanged;
--   * the per-size check, unchanged;
--   * the per-VARIANT check, new, in the same shape as the size one;
--   * sync_order_stock_state(..., 'reserved'), unchanged and still last,
--     still inside this function, still under the locks taken above.
--
-- A basket carrying no variant_id skips the new loop entirely and behaves
-- exactly as it did before this file was run.
--
-- THE PRODUCT ROW IS STILL LOCKED ONCE PER PRODUCT, never per variant.
-- Locking per variant would let two baskets for two variants of one shirt
-- pass the total check simultaneously and oversell it between them -- the
-- exact race the lock exists to close, reintroduced one level down.

create or replace function reserve_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_qty    int;
  v_name   text;
  v_out    boolean;
  v_pre    boolean;
  v_avail  int;
  v_label  text;
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

  -- And the variants, under the same locks. A basket line that names no
  -- variant is skipped: the total check above already covered it, exactly
  -- as an unsized line is skipped by the loop before this one.
  for r in
    select (i->>'product_id')::uuid            as product_id,
           nullif(i->>'variant_id', '')::uuid  as variant_id,
           sum((i->>'qty')::int)::int          as want
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and nullif(i->>'variant_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
     group by 1, 2
     order by 1, 2
  loop
    select variant_available(r.product_id, r.variant_id) into v_avail;
    select p.name into v_name from products p where p.id = r.product_id;
    select v.label into v_label from product_variants v where v.id = r.variant_id;

    if r.want > v_avail then
      raise exception 'Only % left of "%" in %',
        greatest(v_avail, 0), v_name, coalesce(v_label, 'that option')
        using errcode = 'check_violation';
    end if;
  end loop;

  /* AND THEN ACTUALLY HOLD THEM.
   *
   * This line was in stock-reservation.sql's version and was lost when
   * size-stock.sql replaced it to add the per-size check. Checking without
   * holding is not a reservation: the check passes, nothing is written, the
   * lock is dropped at commit, and the next shopper passes the same check
   * against the same unit. Two orders for the last shirt were both accepted
   * and both confirmed, and the shelf went to -1 -- the exact oversell the
   * lock four screens up exists to prevent.
   *
   * It must stay INSIDE this function and after the loops, so it runs under
   * the row locks taken above. Writing the hold from anywhere else would
   * put it outside them, which is the same race wearing a different hat. */
  perform sync_order_stock_state(p_order_id, 'reserved');
end $$;

comment on function reserve_order_stock is
  'Locks each product row, verifies the basket fits the product total, each size AND each variant, and holds the units. Raises with the product name, and the size or variant when it is one of those that ran out.';

revoke all on function reserve_order_stock(uuid) from public, anon, authenticated;
