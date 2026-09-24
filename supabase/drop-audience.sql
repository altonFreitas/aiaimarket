-- ===========================================================================
-- "Who is it for" is gone. Categories say it instead.
-- ===========================================================================
-- products.audience and purchase_order_items.audience held men / women /
-- unisex / unset. They were the answer to "how do I sell men's jeans and
-- women's jeans without two Jeans categories", and the shop has answered it
-- a different way: Clothing is a category, Men's clothing and Women's
-- clothing are subcategories of it. One tree, one place to file a product,
-- and no second column that has to agree with it.
--
-- THIS ERASES THE VALUES, which is what was asked for. Dropping the column
-- drops the data in it, and there is no keeping one without the other. If
-- this shop ever wants the labels back they are a new column and a new
-- afternoon's typing, not a restore.
--
-- Safe to re-run: every statement is guarded, and the whole point of
-- run-all.sql is that running it twice changes nothing the second time.
-- ===========================================================================

-- 1. The search function, without the filter -------------------------------
--
-- This is the definition from supabase/attribute-filters.sql with the
-- audience_filter parameter and its where-clause removed, and NOTHING else
-- changed. The prefix tsquery built by hand, the effective-price sort, the
-- id_filter, the window-function count: all identical. A function that
-- referenced p.audience could not survive the column being dropped, so the
-- redefinition has to come first and in the same file.
--
-- The old eleven-argument overload is dropped by its exact signature.
-- Postgres overloads on argument types, so creating the ten-argument
-- version would otherwise leave BOTH, and a caller naming audience_filter
-- would keep reaching a function that reads a column no longer there.
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int, text, uuid[]);
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int, uuid[]);

create function search_products(
  q             text    default '',
  category_ids  uuid[]  default null,
  seller_ids    uuid[]  default null,
  min_price     numeric default null,
  max_price     numeric default null,
  in_stock_only boolean default false,
  sort          text    default 'relevance',
  lim           int     default 24,
  off           int     default 0,
  -- The product ids that survived the attribute filters, already
  -- intersected by the caller. Null means no attribute filter at all,
  -- which is not the same as an EMPTY array -- that means the filters
  -- matched nothing, and the correct answer is no products rather than
  -- every product.
  id_filter     uuid[]  default null
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
       -- The attribute filters, already intersected. `is null` means no
       -- filter; an empty array is a filter that matched nothing, and
       -- = any('{}') is false for every row, which is the right answer.
       and (id_filter is null or p.id = any(id_filter))
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

grant execute on function search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int, uuid[]) to anon, authenticated;

-- 2. The columns, and everything hanging off them --------------------------
--
-- Order matters: the index and the check constraint are dropped with the
-- column by `drop column`, but naming them first makes this readable and
-- costs nothing when they are already gone.
drop index if exists products_audience_idx;

alter table products
  drop constraint if exists products_audience_check;
alter table products
  drop column if exists audience;

alter table purchase_order_items
  drop column if exists audience;
