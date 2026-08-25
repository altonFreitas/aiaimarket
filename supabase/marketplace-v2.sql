-- ===========================================================================
-- marketplace-v2.sql — search, product reviews, seller payouts
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Requires schema.sql (and, for the reviews' order check, its `orders`
-- table) to have been run first.
--
-- Everything here is additive. The application degrades to its previous
-- behaviour if this file has NOT been run: catalog search falls back to the
-- old in-memory filter, product ratings render as "no reviews yet", and the
-- payout panels show nothing. Nothing below is load-bearing for checkout.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Full-text search
--
-- The old search was `products.filter(p => (name+description+tags).includes(q))`
-- running in Node over the whole catalog. That has three problems that matter
-- more here than in an English-language store:
--
--   * Accents. A buyer typing "telemovel" or "cafe" got nothing back for
--     "telemóvel" / "café". Portuguese loanwords are everywhere in a
--     Timorese catalog, and phone keyboards do not make accents easy.
--   * Substring, not word, matching -- and no ranking at all, so a match in
--     a 500-word description outranked nothing and sorted the same as a
--     match in the product's own name.
--   * It required every live product in memory on every keystroke-driven
--     page load.
--
-- The 'simple' text search configuration is deliberate: 'english' would stem
-- Tetun and Portuguese words into nonsense. 'simple' just lowercases and
-- splits, which is what a trilingual catalog actually wants. Accent folding
-- is done explicitly with unaccent() instead.
-- ---------------------------------------------------------------------------
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- Weighted document for one product. Kept as a function so the trigger and
-- the backfill below cannot drift apart. STABLE, not IMMUTABLE: unaccent()
-- depends on a dictionary, which is why the tsvector is maintained by a
-- trigger rather than declared as a GENERATED column.
--   A = name       (what people actually search for)
--   B = tags, ref  (utility terms and the printed reference)
--   D = description
create or replace function product_search_document(
  p_name text, p_tags text[], p_ref text, p_description text
) returns tsvector
language sql stable
-- unaccent lives in `extensions` on Supabase and in `public` elsewhere;
-- naming both means this resolves either way. A schema in search_path that
-- does not exist is ignored, not an error.
set search_path = public, extensions
as $$
  select setweight(to_tsvector('simple', unaccent(coalesce(p_name, ''))), 'A')
      || setweight(to_tsvector('simple', unaccent(coalesce(array_to_string(p_tags, ' '), ''))), 'B')
      || setweight(to_tsvector('simple', unaccent(coalesce(p_ref, ''))), 'B')
      || setweight(to_tsvector('simple', unaccent(coalesce(p_description, ''))), 'D');
$$;

alter table products add column if not exists search_vector tsvector;

create or replace function products_search_vector_sync() returns trigger
language plpgsql as $$
begin
  new.search_vector := product_search_document(new.name, new.tags, new.ref, new.description);
  return new;
end;
$$;

drop trigger if exists trg_products_search_vector on products;
create trigger trg_products_search_vector
  before insert or update of name, tags, ref, description on products
  for each row execute function products_search_vector_sync();

-- Backfill. Written as a direct expression rather than a no-op UPDATE
-- because the trigger above only fires on the four columns it watches.
update products
   set search_vector = product_search_document(name, tags, ref, description)
 where search_vector is null;

create index if not exists idx_products_search on products using gin(search_vector);
-- Trigram index on the raw name, for the "did you mean" suggestion path
-- only (see suggest_products below). Not accent-folded: unaccent() is not
-- IMMUTABLE so it cannot appear in an index expression, and the full-text
-- path above already covers accents.
create index if not exists idx_products_name_trgm on products using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. Product reviews
--
-- The store already had SELLER ratings. It had nothing at the level a buyer
-- actually decides at: this product, from this seller, was it what the photo
-- promised. Same trust model as seller_ratings and lookupOrder(): knowing an
-- order's reference AND the phone it was placed with proves you are the
-- buyer. The server action additionally checks the order is completed and
-- actually contained this product, so a review cannot be written for
-- something that was never bought.
-- ---------------------------------------------------------------------------
create table if not exists product_reviews (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  order_id    uuid references orders(id) on delete set null,
  buyer_phone text not null,
  buyer_name  text not null default '',
  rating      int not null check (rating between 1 and 5),
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  -- One review per product per order. Resubmitting updates the existing
  -- row (see submitProductReview's upsert) instead of stacking duplicates.
  unique (order_id, product_id)
);
create index if not exists idx_product_reviews_product on product_reviews(product_id, created_at desc);
alter table product_reviews enable row level security;

-- Public by design -- that is the point of a review. buyer_phone is not:
-- column grants keep it out of what the browser's anon key can read, the
-- same pattern settings.totp_secret and seller_ratings.buyer_phone use.
drop policy if exists product_reviews_public_read on product_reviews;
create policy product_reviews_public_read on product_reviews for select using (true);
revoke select on product_reviews from anon, authenticated;
grant select (id, product_id, order_id, buyer_name, rating, comment, created_at)
  on product_reviews to anon, authenticated;
-- No public insert/update/delete: every write goes through
-- submitProductReview (service role), which verifies the order first.

-- Denormalised aggregates on products, maintained by trigger.
--
-- Every product card in every grid shows a star rating. Computing that with
-- an aggregate query per card, or one big GROUP BY joined into the catalog
-- read, costs a round trip to Singapore that these two columns make
-- unnecessary. Same approach the schema already takes for views/wa_clicks.
alter table products add column if not exists rating_sum   int not null default 0;
alter table products add column if not exists rating_count int not null default 0;

create or replace function product_reviews_sync_aggregate() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update products set rating_sum = rating_sum + new.rating,
                        rating_count = rating_count + 1
      where id = new.product_id;
  elsif tg_op = 'UPDATE' then
    if new.product_id = old.product_id then
      update products set rating_sum = rating_sum + new.rating - old.rating
        where id = new.product_id;
    else
      update products set rating_sum = rating_sum - old.rating,
                          rating_count = greatest(0, rating_count - 1)
        where id = old.product_id;
      update products set rating_sum = rating_sum + new.rating,
                          rating_count = rating_count + 1
        where id = new.product_id;
    end if;
  elsif tg_op = 'DELETE' then
    update products set rating_sum = greatest(0, rating_sum - old.rating),
                        rating_count = greatest(0, rating_count - 1)
      where id = old.product_id;
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_product_reviews_aggregate on product_reviews;
create trigger trg_product_reviews_aggregate
  after insert or update or delete on product_reviews
  for each row execute function product_reviews_sync_aggregate();

-- Recompute from scratch, so re-running this file repairs any drift rather
-- than doubling the totals.
update products p set
  rating_sum   = coalesce(r.total, 0),
  rating_count = coalesce(r.n, 0)
from (
  select product_id, sum(rating) as total, count(*) as n
    from product_reviews group by product_id
) r
where r.product_id = p.id;

update products set rating_sum = 0, rating_count = 0
 where id not in (select product_id from product_reviews)
   and (rating_sum <> 0 or rating_count <> 0);

-- ---------------------------------------------------------------------------
-- 3. Seller payouts
--
-- The platform's commission was being *calculated* (computeSellerEarnings)
-- and never *recorded*. That is fine for a single-owner store and untenable
-- for a marketplace: nothing in the database said how much a seller was
-- owed, how much had actually been handed over, or when.
--
-- Deliberately a single-entry ledger, not double-entry accounting. Money
-- owed is derived (net earnings on completed orders minus payouts recorded
-- here), which means there is exactly one writable fact -- "we paid X on
-- day Y" -- and no way for two stored numbers to disagree.
-- ---------------------------------------------------------------------------
create table if not exists seller_payouts (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null references sellers(id) on delete cascade,
  amount       numeric(10,2) not null check (amount > 0),
  method       text not null default 'bank' check (method in ('bank','wallet','cash','other')),
  reference    text not null default '',   -- bank transfer ref / wallet txn id
  note         text not null default '',
  paid_at      timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_seller_payouts_seller on seller_payouts(seller_id, paid_at desc);
alter table seller_payouts enable row level security;

-- A seller may read their own payout history. No public read policy: what
-- the platform pays whom is nobody else's business. Writes are admin-only
-- through the service-role client.
drop policy if exists seller_payouts_self_read on seller_payouts;
create policy seller_payouts_self_read on seller_payouts for select using (
  seller_id in (select id from sellers where user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- 4. search_products() — one ranked, filtered, paginated query
--
-- SECURITY INVOKER (the default) on purpose: called with the anon key, it
-- runs as `anon`, so the products_public_read RLS policy still decides which
-- rows exist. The archived/status predicates below are belt and braces, not
-- the security boundary.
--
-- Returns the whole product row as a composite plus the unpaginated total,
-- so the caller gets pagination counts without a second round trip and this
-- signature does not have to change every time products gains a column.
-- ---------------------------------------------------------------------------
create or replace function search_products(
  q             text    default '',
  category_ids  uuid[]  default null,
  seller_ids    uuid[]  default null,
  min_price     numeric default null,
  max_price     numeric default null,
  in_stock_only boolean default false,
  sort          text    default 'relevance',
  lim           int     default 24,
  off           int     default 0
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

-- "Did you mean" — only ever called when search_products returned nothing,
-- so the trigram scan stays off the hot path. Threshold is deliberately
-- loose: a shopper who got zero results is better served by a wrong guess
-- than by an empty page.
create or replace function suggest_products(q text, lim int default 5)
returns table (name text, slug text, score real)
language sql
stable
set search_path = public, extensions
as $$
  select p.name, p.slug, similarity(p.name, coalesce(q, '')) as score
    from products p
   where p.archived = false
     and p.status = 'approved'
     and coalesce(q, '') <> ''
     and similarity(p.name, q) > 0.15
   order by score desc
   limit least(greatest(coalesce(lim, 5), 1), 20);
$$;

revoke all on function search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int) from public;
revoke all on function suggest_products(text, int) from public;
grant execute on function search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int) to anon, authenticated;
grant execute on function suggest_products(text, int) to anon, authenticated;
