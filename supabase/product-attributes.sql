-- ===========================================================================
-- Loja AIAI -- what each product actually answers
--
-- Run AFTER supabase/taxonomy.sql. Safe to re-run.
--
-- taxonomy.sql says a Sofa HAS a Seat Height. This says THIS sofa's seat
-- height is 45cm.
--
-- ONE ROW PER VALUE, NOT ONE ROW PER ATTRIBUTE. A multi-select -- "Features:
-- Waterproof, Foldable, Washable" -- is three rows here, not one row
-- holding a list. That costs nothing and buys the thing the storefront
-- needs most: a filter is then a join on (attribute_id, value), which an
-- index answers, instead of a LIKE against the inside of an array. The
-- unique key is (product, attribute, value), so a single-valued attribute
-- is simply the case where there happens to be one.
--
-- WHY value_num EXISTS BESIDE value. Everything arrives as text, and text
-- sorts like text: '100' comes before '99', so "sofas under 200cm wide"
-- returns the wrong sofas and a price sort is nonsense. Numbers are
-- therefore ALSO written to a numeric column, and the range filters and
-- sorts read that one. It is filled by the application rather than
-- generated, because whether a value is a number is a property of the
-- ATTRIBUTE (field_type), which this row does not carry -- and a generated
-- column cannot look at another table.
-- ===========================================================================

create table if not exists product_attribute_values (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  attribute_id  uuid not null references attributes(id) on delete cascade,

  -- The stored answer, always as text. For a select this is
  -- attribute_options.value; for a boolean, 'true' or 'false'; for a
  -- colour, the hex.
  value         text not null,

  -- The same answer as a number, where it is one. Null for everything
  -- else. Written by the application -- see the note above.
  value_num     numeric,

  created_at    timestamptz not null default now(),

  -- One row per distinct answer. A multi-select has several; everything
  -- else has one. This is also what makes a re-save idempotent.
  unique (product_id, attribute_id, value)
);

-- Reading a product's whole form back: every value it holds, in one go.
create index if not exists pav_product_idx
  on product_attribute_values (product_id);

-- The storefront filter: "every product whose Colour is Black". Ordered
-- attribute-first because that is how the question is asked.
create index if not exists pav_filter_idx
  on product_attribute_values (attribute_id, value);

-- The range filter: "width between 180 and 220". Partial, because only a
-- minority of values are numbers and an index over the nulls would be
-- mostly empty.
create index if not exists pav_numeric_idx
  on product_attribute_values (attribute_id, value_num)
  where value_num is not null;

comment on table product_attribute_values is
  'What each product answers for each of its product type''s attributes. One row per VALUE, so a multi-select is several rows -- see supabase/product-attributes.sql.';
comment on column product_attribute_values.value_num is
  'The same answer as a number where it is one, so range filters and sorts do not compare ''100'' with ''99'' as text. Null otherwise.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Readable by anyone, for the same reason the taxonomy is: the product page
-- draws these, and it runs as anon. An admin-only attribute is filtered by
-- the application when it builds the page -- but it must ALSO be
-- unreachable here, or the value is one crafted query away.

alter table product_attribute_values enable row level security;

drop policy if exists pav_public_read on product_attribute_values;
create policy pav_public_read on product_attribute_values
  for select using (
    exists (
      select 1 from attributes a
       where a.id = product_attribute_values.attribute_id
         and not a.admin_only
    )
  );

revoke all on product_attribute_values from anon, authenticated;
grant select on product_attribute_values to anon, authenticated;
