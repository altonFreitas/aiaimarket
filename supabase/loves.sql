-- ===========================================================================
-- Loja AIAI -- "I like this", from someone who is not buying it today
--
-- A shop learns two things from its catalog today: what sold, and what was
-- looked at. Both are late. A product people keep opening and never buying
-- is either priced wrong or photographed badly, and by the time the sales
-- figures say so the season is over.
--
-- This is the signal in between: a heart on the card, tapped by someone who
-- is not going to buy it now but wants it seen. It costs the shopper
-- nothing and tells the shop what to restock, what to discount, and what to
-- put on the homepage.
--
-- WHAT THIS IS NOT. It is not a vote and it is not per-person. There is no
-- row per shopper, no account required, and no way to stop the same phone
-- loving something twice after clearing its browser storage -- exactly like
-- products.views, which this sits beside and is measured the same way. It
-- is a POPULARITY SIGNAL, and every screen that shows it treats it as one.
-- A per-user table is the thing to build if it ever needs to be a vote;
-- until then this is one integer and no new table.
--
-- Safe to re-run.
-- ===========================================================================

alter table products
  add column if not exists loves int not null default 0;

comment on column products.loves is
  'How many times the heart on this product has been tapped. A popularity signal, not a per-person vote -- see supabase/loves.sql.';

-- Partial, like products_audience_idx: the homepage asks for the most-loved
-- few, and the products nobody has loved are never the answer.
create index if not exists products_loves_idx
  on products (loves desc) where loves > 0;

-- ---------------------------------------------------------------------------
-- The two counters.
--
-- SECURITY DEFINER for the same reason increment_views is: an anonymous
-- visitor may move this number and nothing else. Granting them UPDATE on
-- products to let them tap a heart would also let them rewrite every price
-- in the shop.
--
-- greatest(loves - 1, 0) rather than a plain subtraction: a browser that
-- has forgotten it already un-loved something must not be able to push the
-- count below zero, and a negative popularity is not a thing.
-- ---------------------------------------------------------------------------
create or replace function increment_loves(p_id uuid) returns void
  language sql security definer set search_path = public as $$
  update products set loves = loves + 1 where id = p_id;
$$;

create or replace function decrement_loves(p_id uuid) returns void
  language sql security definer set search_path = public as $$
  update products set loves = greatest(loves - 1, 0) where id = p_id;
$$;

revoke all on function increment_loves(uuid) from public;
revoke all on function decrement_loves(uuid) from public;
grant execute on function increment_loves(uuid) to anon, authenticated;
grant execute on function decrement_loves(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- The heart appears on every product card straight away; until this file is
-- run it works for the person tapping it (their browser remembers) and the
-- shop's count stays at zero, which is what a missing column honestly means.
-- The homepage's "Most loved" row and the admin's figure appear as soon as
-- there is something to count.
-- ---------------------------------------------------------------------------
