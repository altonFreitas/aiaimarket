-- ===========================================================================
-- Loja AIAI -- filtering the catalogue by attribute
--
-- Run AFTER supabase/product-attributes.sql and
-- supabase/audience-restock.sql. Safe to re-run.
--
-- Section 19 of the rebuild brief: the filters on a category page are
-- GENERATED from the attributes its product types ask for, not written by
-- hand per category. Shoes offer Brand, Size, Colour, Waterproof; sofas
-- offer Material, Number of Seats, Room Type; and nobody maintains either
-- list, because both are already in the database.
--
-- WHY THIS TOUCHES search_products AT ALL, given how careful the rest of
-- this rebuild has been about replaced functions. The alternative was to
-- fetch the matching product ids separately and filter the RESULT, and
-- that quietly breaks two things the page depends on: the total count
-- becomes the count before filtering, so the pager offers pages that do
-- not exist, and the LIMIT applies before the filter, so page one of a
-- filtered search can come back empty while page four is full.
--
-- The filter has to be inside the query. So it is one more defaulted
-- parameter, added the way audience_filter was added -- last, defaulted,
-- and only ever SENT when there is something to send, so a database that
-- has not run this file keeps the nine-argument function and its fast
-- search rather than falling back to the in-memory path for every query.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Which products answer a given attribute a given way
-- ---------------------------------------------------------------------------
-- The values are on product_attribute_values, one row per value. A product
-- matching "Colour is Black OR White" has at least one row among them.
--
-- Several DIFFERENT attributes are an AND, though: picking Black and then
-- Leather means black leather sofas, not everything black plus everything
-- leather. That intersection is done by the caller, which is why this
-- answers about one attribute at a time -- a single query trying to
-- express "matches all of N groups" needs a join per group.

create or replace function products_with_attribute(
  p_attribute_slug text,
  p_values         text[]
)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select distinct v.product_id
    from product_attribute_values v
    join attributes a on a.id = v.attribute_id
   where a.slug = p_attribute_slug
     and not a.admin_only
     and (p_values is null or v.value = any(p_values));
$$;

comment on function products_with_attribute is
  'Product ids answering one attribute with any of the given values. Several attributes are intersected by the caller -- see src/lib/data/attributeFilters.ts.';

grant execute on function products_with_attribute(text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The search learns one more filter
-- ---------------------------------------------------------------------------
-- This is the definition from supabase/audience-restock.sql with ONE
-- parameter added and one clause in the WHERE. Everything else -- the
-- prefix tsquery built by hand, the effective-price sort, the audience
-- rule, the window count -- is reproduced exactly. A call that does not
-- mention id_filter behaves identically to the way it did before.

-- DROPPED FIRST, AND THIS IS NOT OPTIONAL. `create or replace` cannot
-- change a signature, so adding a parameter creates an OVERLOAD beside the
-- old one rather than replacing it -- and then every call that does not
-- name the new argument matches both and fails with "is not unique". That
-- includes the call the application already makes, so the storefront's
-- search would start erroring on every query, be caught by the fallback in
-- lib/data/search.ts, and quietly run the whole catalogue through the
-- in-memory path instead of the index. A large shop would just get slow.
--
-- supabase/audience-restock.sql does the same thing for the same reason.
-- Every earlier arity is named, because a database may be arriving here
-- from any of them.
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int);
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int, text);
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int, text, uuid[]);

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
  -- Added by supabase/audience-restock.sql. Last, and defaulted, so a call
  -- that does not mention it behaves exactly as it did before.
  --
  -- NOT named "audience": a parameter sharing a name with a column of the
  -- table being queried is ambiguous inside PL/pgSQL, and every call fails
  -- at run time rather than at definition time.
  audience_filter text  default null,
  -- Added by supabase/attribute-filters.sql, for the same reason and in
  -- the same shape: the product ids that survived the attribute filters,
  -- already intersected by the caller. Null means no attribute filter at
  -- all, which is not the same as an EMPTY array -- that means the filters
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
       -- Who it is for. A filter shows that audience plus unisex, and
       -- hides both the other one and the products nobody has labelled --
       -- p.audience = audience is null for those, which is not true, which
       -- excludes them. That is the intended behaviour and not an
       -- oversight: see src/lib/audience.ts.
       and (audience_filter is null
            or p.audience = audience_filter
            or p.audience = 'unisex')
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
