-- ===========================================================================
-- PRODUCT HIGHLIGHTS -- the short selling points, as a list
-- ===========================================================================
-- The product page shows a handful of ticked one-liners beside the
-- description: "100% breathable cotton", "Classic crew neck", "Machine
-- washable". They are the things a shopper scans before reading a
-- paragraph, and nothing already in the database is them.
--
-- NOT THE DESCRIPTION. That is prose, and a page cannot reliably cut prose
-- into bullets -- splitting on full stops turns one sentence with an
-- abbreviation in it into two bullets, and turns a paragraph into fifteen.
--
-- NOT THE ATTRIBUTES EITHER. Those answer the product type's questions
-- (Material: Cotton) and they already have their own table on the page.
-- "100% breathable cotton" is a claim the shop chooses to make, in its own
-- words, and there is no attribute whose answer it is.
--
-- So: a plain array of short lines, written by whoever writes the listing.
-- Empty on every product that has none, and the block simply does not
-- render -- the same rule the specification table has followed since it
-- was built.
--
-- READABLE BY ANYONE, deliberately. products carries a table-level grant
-- to anon, which covers columns added later (see the note at the top of
-- sales.sql), and this is marketing copy meant for the whole internet.
-- Nothing sensitive may be put here, and nothing here is.
-- ---------------------------------------------------------------------------

alter table products
  add column if not exists highlights text[] not null default '{}';

comment on column products.highlights is
  'Short ticked selling points shown on the product page, one per entry. '
  'Public. Bounded by products_highlights_sane below.';

-- BOUNDED, because a paste is the normal way this column gets filled.
-- Somebody pasting a supplier's sheet into the box would otherwise turn
-- forty lines into the whole page, and a single 8kB "bullet" would break
-- the two-column grid it is drawn in rather than wrap inside it.
--
-- Twelve and 120: twelve ticks is already more than anyone reads, and 120
-- characters is a line that fits one column on a phone. Both are limits on
-- the SHAPE of the thing, not on what the shop may say -- anything longer
-- belongs in the description, which has no limit at all. The same two
-- numbers are in src/lib/highlights.ts, which trims before the save so
-- the shop is told rather than handed a 500.
--
-- THROUGH A FUNCTION, because a CHECK constraint may not contain a
-- subquery -- "cannot use subquery in check constraint" -- and there is
-- no built-in "every element satisfies this" for an array. Written
-- straight into the CHECK, this file aborted the deploy at this line and
-- took every migration after it down with it. A function body has no
-- such restriction, and an IMMUTABLE one is what a constraint is allowed
-- to call.
create or replace function product_highlights_ok(h text[])
returns boolean
language sql
immutable
parallel safe
as $fn$
  select coalesce(array_length(h, 1), 0) <= 12
     and coalesce((select max(length(x)) from unnest(h) as x), 0) <= 120;
$fn$;

comment on function product_highlights_ok(text[]) is
  'Shape check for products.highlights: at most 12 entries, none over 120 '
  'characters. Called from products_highlights_sane.';

-- Dropped first so re-running this file after the numbers change replaces
-- the constraint instead of failing on a duplicate name. This whole file
-- is re-run on every deploy (see supabase/run-all.sql), so every statement
-- in it has to be safe the second time.
alter table products drop constraint if exists products_highlights_sane;
alter table products add constraint products_highlights_sane
  check (product_highlights_ok(highlights));
