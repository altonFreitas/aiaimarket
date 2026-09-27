-- ===========================================================================
-- Two more ways to order the catalogue: what people look at, and what is
-- most reduced.
-- ===========================================================================
-- The shop could sort by newest, cheapest, dearest and best-rated. Two of
-- the things a shopper most often wants were missing, and neither can be
-- done in the application: the search is paginated and COUNTED in the
-- database (see the cap below), so ordering a page of twenty-four in
-- JavaScript would order the wrong twenty-four.
--
--   'popular'  products.views, then products.wa_clicks.
--
--              Both are the shop's own counters, and both are
--              DEDUPLICATED before they are written -- one bump per
--              caller per product per fifteen minutes, see
--              src/lib/counterGuard.ts. That is what makes this an
--              honest sort rather than a refresh contest: it is closer to
--              "how many people looked" than to "how many page loads".
--              wa_clicks breaks the tie because somebody who pressed
--              Order via WhatsApp wanted it more than somebody who
--              looked.
--
--              NOT products.loves, deliberately, although it is the
--              better signal: supabase/loves.sql is optional, and a
--              function naming a column a database may not have would
--              fail on every search rather than on this sort.
--
--   'deal'     how far the price is actually reduced, as a FRACTION, not
--              as an amount. $5 off $10 beats $5 off $500, and the
--              shopper reading "-50%" agrees. Products with no discount
--              sort last rather than as zero: they are not bad deals,
--              they are not deals.
--
-- Everything else in the function is the definition from
-- supabase/drop-audience.sql, reproduced exactly: the prefix tsquery built
-- by hand, the effective-price filter and sort, the id_filter, the capped
-- window count. The signature is UNCHANGED, which is why this is a plain
-- `create or replace` with no drop -- adding a sort name is a change to
-- the body, and an unknown sort was always and still is "newest first".
--
-- Safe to re-run.
-- ===========================================================================

-- 1. Two indexes, because both new sorts scan ------------------------------
--
-- Neither is required for correctness; both turn a sort of the whole
-- catalogue into a walk of an index. The deal one is PARTIAL -- most of a
-- shop is not on offer at any moment, and an index over the rows that are
-- is a fraction of the size.
create index if not exists products_views_idx
  on products (views desc) where views > 0;

create index if not exists products_deal_idx
  on products (((price - discount_price) / nullif(price, 0)) desc)
  where discount_price is not null and discount_price > 0;

-- 2. The search learns the two sort names ----------------------------------
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
  -- HOW DEEP THE RESULT SET IS COUNTED AND PAGED. One more than the cap is
  -- fetched, so the caller can tell "exactly this many" from "more than
  -- this many" and say so. Must equal SEARCH_TOTAL_CAP in
  -- src/lib/data/search.ts -- tests/searchCap.test.ts fails if they drift.
  v_cap     constant int := 1000;
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

  /* ORDERED INSIDE, so the cap keeps the RIGHT rows: `limit` without an
     order takes an arbitrary thousand, and sorting those would put the
     fourth-cheapest product on page one. Ordered again outside because a
     CTE's row order is not guaranteed to survive; over at most 1,001 rows
     that costs nothing. The two orderings have to agree, which is why
     every branch below appears twice. */
  return query
  with matched as (
    select p,
           case when v_tsquery is null then 0::real
                else ts_rank(p.search_vector, v_tsquery) end as r,
           case when p.discount_price is not null and p.discount_price > 0
                then p.discount_price else p.price end as effective_price,
           -- How far off, as a fraction of the asking price. Null when
           -- there is no discount, which sorts last rather than as zero.
           case when p.discount_price is not null and p.discount_price > 0
                     and p.price > 0 and p.discount_price < p.price
                then (p.price - p.discount_price) / p.price end as deal_frac
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
     order by
       -- Sort by the price a buyer would actually pay, not the list price:
       -- a discounted item belongs where its discounted price puts it.
       case when sort = 'low'  then (case when p.discount_price is not null
              and p.discount_price > 0 then p.discount_price else p.price end) end asc,
       case when sort = 'high' then (case when p.discount_price is not null
              and p.discount_price > 0 then p.discount_price else p.price end) end desc,
       case when sort = 'rating'
            then p.rating_sum::numeric / nullif(p.rating_count, 0) end desc nulls last,
       case when sort = 'popular' then p.views end desc,
       case when sort = 'popular' then p.wa_clicks end desc,
       case when sort = 'deal' then
              (case when p.discount_price is not null and p.discount_price > 0
                         and p.price > 0 and p.discount_price < p.price
                    then (p.price - p.discount_price) / p.price end) end desc nulls last,
       case when sort = 'relevance' then
              (case when v_tsquery is null then 0::real
                    else ts_rank(p.search_vector, v_tsquery) end) end desc,
       -- Final tiebreaker, and the whole ordering for sort = 'new'.
       p.created_at desc
     limit v_cap + 1
  )
  select m.p, count(*) over () as total_count, m.r
    from matched m
   order by
     case when sort = 'low'  then m.effective_price end asc,
     case when sort = 'high' then m.effective_price end desc,
     case when sort = 'rating'
          then (m.p).rating_sum::numeric / nullif((m.p).rating_count, 0) end desc nulls last,
     case when sort = 'popular' then (m.p).views end desc,
     case when sort = 'popular' then (m.p).wa_clicks end desc,
     case when sort = 'deal' then m.deal_frac end desc nulls last,
     case when sort = 'relevance' then m.r end desc,
     (m.p).created_at desc
   limit v_limit offset v_offset;
end;
$$;

grant execute on function search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int, uuid[]) to anon, authenticated;

comment on function search_products is
  'Catalogue search: filtered, ordered and counted in the database. Sorts: relevance, new, low, high, rating, popular, deal -- see src/lib/data/search.ts, whose in-memory fallback has to agree with this.';
