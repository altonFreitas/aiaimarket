-- ===========================================================================
-- Loja AIAI -- who a product is for, and a warning before a shelf empties
--
-- Two unrelated features in one file because they are one afternoon's
-- migration and splitting them would mean asking you to run two.
--
--   1. products.audience   -- men / women / unisex, or null for "does not
--                             apply". Powers the Men|Women filter in the
--                             shop.
--   2. products.restock_level + settings.restock_alert_pct
--                          -- how much was on the shelf after the last
--                             delivery, and how far it may fall before the
--                             admin says something.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Who it is for
--
-- Nullable, and null is not "unisex". A saucepan is not unisex; it is
-- simply not a question that applies to it. The application shows unset
-- products when no filter is set and hides them when one is -- see
-- src/lib/audience.ts, which explains why collapsing the two would have
-- made the filter useless on the day it shipped.
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists audience text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_audience_check') then
    alter table products
      add constraint products_audience_check
      check (audience is null or audience in ('men', 'women', 'unisex'));
  end if;
end $$;

-- The shop filters on it, so it is worth an index. Partial: the rows with
-- no audience are the majority in most catalogs and are never the ones
-- being looked up by it.
create index if not exists products_audience_idx
  on products (audience) where audience is not null;

comment on column products.audience is
  'men | women | unisex, or null when the question does not apply. Null is NOT unisex -- see src/lib/audience.ts.';

-- ---------------------------------------------------------------------------
-- 2. How full the shelf was last time
--
-- The reference the alert compares against: quantity on hand immediately
-- after the most recent delivery or count-up.
--
-- Maintained by the trigger below rather than by the application. Stock
-- arrives through several paths -- receiving a purchase order, a manual
-- adjustment, an order being cancelled and its units returned -- and every
-- one of them ends in a stock_movements row. Writing it in one trigger is
-- the only version that cannot be bypassed by adding a path later.
--
-- NOT a high-water mark. A shop that once held 500 of something and now
-- deliberately stocks 20 would sit permanently in alert.
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists restock_level int;

comment on column products.restock_level is
  'Quantity on hand just after the last movement that ADDED stock. The reference for the low-stock alert; maintained by apply_stock_movement().';

-- ---------------------------------------------------------------------------
-- The trigger, extended
--
-- This is the same function from supabase/stock-ledger.sql that moves
-- products.qty, with one added line. It is repeated in full because
-- Postgres has no way to add a statement to an existing function, and
-- because a copy that silently drifts from the original would be worse
-- than an obvious one. If you change stock-ledger.sql, change this too.
-- ---------------------------------------------------------------------------
create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
begin
  update products
     set qty = qty + new.delta,
         -- Only a delivery moves the reference. A sale must not, or the
         -- alert would re-baseline itself downward on every purchase and
         -- never fire at all.
         restock_level = case when new.delta > 0
                              then qty + new.delta
                              else restock_level end
   where id = new.product_id;
  return new;
end $$;

comment on function apply_stock_movement is
  'Turns a stock_movements row into the products.qty balance, and records restock_level whenever stock is added. The ONLY thing that writes products.qty.';

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Existing products have no reference, so nothing alerts until their next
-- delivery. Seeding it from what is currently on the shelf is the honest
-- starting point: "as full as it is right now" is exactly what a shop
-- would say if you asked them today. It does mean nothing alerts until
-- something sells, which is correct.
--
-- Only rows that have none, so re-running never resets a real one.
-- ---------------------------------------------------------------------------
update products
   set restock_level = qty
 where restock_level is null and qty > 0;

-- ---------------------------------------------------------------------------
-- 3. How far it may fall
--
-- 75 means "tell me once a quarter of the last delivery has gone". Early
-- on purpose: it is a heads-up for ordering, not a warning that the shelf
-- is nearly bare.
-- ---------------------------------------------------------------------------
alter table settings
  add column if not exists restock_alert_pct int not null default 75;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_restock_alert_pct_check') then
    alter table settings
      add constraint settings_restock_alert_pct_check
      check (restock_alert_pct between 1 and 99);
  end if;
end $$;

comment on column settings.restock_alert_pct is
  'Alert when a product falls to this percentage of its last delivery. 1-99; 75 means "a quarter has gone".';


-- ---------------------------------------------------------------------------
-- 4. Search, taught about the audience
--
-- The filter has to happen INSIDE the query. Filtering the page after it
-- comes back would leave the total count and the page numbers describing a
-- different set of products than the one on screen.
--
-- The old signature is dropped first. Postgres treats a different argument
-- list as a different function, so "create or replace" with an added
-- parameter would leave BOTH versions in place and PostgREST would have no
-- way to choose between them.
-- ---------------------------------------------------------------------------
-- BOTH signatures. The nine-argument one is the original. The ten-argument
-- one exists on any database where an earlier version of this file ran --
-- and "create or replace" cannot rename a parameter, so without this drop a
-- re-run fails with "cannot change name of input parameter". A migration
-- that only works once is not one you can safely re-run.
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int);
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int, text);

create or replace function search_products(
  q             text    default '',
  category_ids  uuid[]  default null,
  seller_ids    uuid[]  default null,
  min_price     numeric default null,
  max_price     numeric default null,
  in_stock_only boolean default false,
  sort          text    default 'relevance',
  lim           int     default 24,
  off           int     default 0,
  -- Added by supabase/audience-restock.sql. Last, and defaulted, so a call
  -- that does not mention it behaves exactly as it did before.
  --
  -- NOT named "audience": a parameter sharing a name with a column of the
  -- table being queried is ambiguous inside PL/pgSQL, and every call fails
  -- at run time rather than at definition time.
  audience_filter text  default null
)
returns table (product products, total_count bigint, rank real)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_terms   text;
  v_tsquery tsquery := null;
  v_limit   int := least(greatest(coalesce(lim, 24), 1), 100);
  v_offset  int := greatest(coalesce(off, 0), 0);
begin
  -- Build a prefix tsquery by hand rather than using websearch_to_tsquery:
  -- shoppers type partial words ("kame" for "kamera") far more often than
  -- they type boolean operators. Splitting on non-alphanumerics first means
  -- nothing reaching to_tsquery can be a tsquery operator, so no amount of
  -- punctuation in `q` can produce a syntax error.
  select string_agg(word || ':*', ' & ')
    into v_terms
    from regexp_split_to_table(lower(unaccent(coalesce(q, ''))), '[^[:alnum:]]+') as word
   where word <> '';

  if v_terms is not null and v_terms <> '' then
    v_tsquery := to_tsquery('simple', v_terms);
  end if;

  return query
  with matched as (
    select p,
           case when v_tsquery is null then 0::real
                else ts_rank(p.search_vector, v_tsquery) end as r,
           case when p.discount_price is not null and p.discount_price > 0
                then p.discount_price else p.price end as effective_price
      from products p
     where p.archived = false
       and p.status = 'approved'
       and (v_tsquery is null or p.search_vector @@ v_tsquery)
       and (category_ids is null or p.category_id = any(category_ids))
       and (seller_ids is null or p.seller_id = any(seller_ids))
       and (not in_stock_only or p.stock_status <> 'out')
       -- Who it is for. A filter shows that audience plus unisex, and
       -- hides both the other one and the products nobody has labelled --
       -- p.audience = audience is null for those, which is not true, which
       -- excludes them. That is the intended behaviour and not an
       -- oversight: see src/lib/audience.ts.
       and (audience_filter is null
            or p.audience = audience_filter
            or p.audience = 'unisex')
       and (min_price is null or
            (case when p.discount_price is not null and p.discount_price > 0
                  then p.discount_price else p.price end) >= min_price)
       and (max_price is null or
            (case when p.discount_price is not null and p.discount_price > 0
                  then p.discount_price else p.price end) <= max_price)
  )
  select m.p, count(*) over () as total_count, m.r
    from matched m
   order by
     -- Sort by the price a buyer would actually pay, not the list price:
     -- a discounted item belongs where its discounted price puts it.
     case when sort = 'low'  then m.effective_price end asc,
     case when sort = 'high' then m.effective_price end desc,
     case when sort = 'rating'
          then (m.p).rating_sum::numeric / nullif((m.p).rating_count, 0) end desc nulls last,
     case when sort = 'relevance' then m.r end desc,
     -- Final tiebreaker, and the whole ordering for sort = 'new'.
     (m.p).created_at desc
   limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing changes on screen until you set an audience on a product, and
-- the restock alert appears on the admin home the first time something
-- sells down past the threshold.
-- ---------------------------------------------------------------------------
