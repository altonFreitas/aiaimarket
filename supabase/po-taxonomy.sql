-- ===========================================================================
-- Loja AIAI -- buying a product TYPE, not just a name and a price
--
-- Run AFTER supabase/taxonomy.sql and supabase/product-attributes.sql.
-- Safe to re-run.
--
-- WHAT WAS MISSING. A purchase order line already carried the four things
-- the shop knew when it placed the order -- what the goods are called, what
-- category they go in, what they will sell for, and what sizes they come in
-- -- and receiving turned those into a product. Everything else the listing
-- needs was typed twice: once on the order, and again into the product form
-- afterwards, from memory, by the same person.
--
-- Worse, the "everything else" is now the interesting half. A product type
-- asks eighteen questions about a sofa and fourteen about a t-shirt, and a
-- product that answers none of them shows an empty Specifications panel,
-- appears under no attribute filter, and can have no variants -- because a
-- variant is a combination of attributes and there are none.
--
-- So the LINE carries the type and the answers, and the receipt writes them
-- onto the product it creates. The buyer answers them at the one moment
-- they are holding the supplier's invoice and know them.
--
-- TWO COLUMNS, NOT A CHILD TABLE, for the reason variant_qty is one map and
-- not a table: the line owns this, it is written and read whole, and a
-- child table would add a join to every purchasing screen to hold what is
-- always one small object. The PRODUCT's answers are a real table with real
-- rows (product_attribute_values), because those are queried -- filtered,
-- faceted, sorted. These are not. They are a note to the receipt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. What kind of thing this line buys
-- ---------------------------------------------------------------------------
-- Null for every line written before this, for a line buying something with
-- no type yet, and for every line that is not goods for resale -- an office
-- chair the shop sits on is not a product and has no product type.
--
-- ON DELETE SET NULL, not CASCADE: a product type retired next year must not
-- delete the purchase orders that bought under it. The order is the record
-- of what was actually bought and paid for.
--
-- Guarded, because a shop that has not run taxonomy.sql has no
-- product_types to reference and the constraint would fail the whole file.
do $po_product_type$
begin
  if to_regclass('public.product_types') is not null then
    alter table purchase_order_items
      add column if not exists product_type_id uuid;

    if not exists (
      select 1 from pg_constraint
       where conname = 'purchase_order_items_product_type_id_fkey'
    ) then
      alter table purchase_order_items
        add constraint purchase_order_items_product_type_id_fkey
        foreign key (product_type_id) references product_types(id)
        on delete set null;
    end if;
  end if;
end
$po_product_type$;

-- ---------------------------------------------------------------------------
-- 2. The answers to that type's questions
-- ---------------------------------------------------------------------------
-- {"<attribute uuid>": ["Cotton"], "<attribute uuid>": ["41", "41,5", "42"]}
--
-- ALWAYS A LIST, even for a single-valued field, so one shape covers both
-- and the receipt has no branch. Exactly the shape the product form posts
-- and lib/taxonomy/validate.ts checks, so the same validator runs over the
-- same object on both sides and they cannot drift.
--
-- VALIDATED ON THE WAY IN, never on the way out: savePurchaseOrder() reads
-- the attributes FROM the product type and refuses anything the type did
-- not ask for, so what sits here is already known to fit. A receipt that
-- re-validated could find a line it could not apply months after the buyer
-- had gone home.
alter table purchase_order_items
  add column if not exists attribute_values jsonb not null default '{}'::jsonb;

comment on column purchase_order_items.product_type_id is
  'What kind of thing this line buys. Copied onto products.product_type_id at receipt, which is what makes the new listing draw its own fields. Null for a line with no type and for anything not bought for resale.';
comment on column purchase_order_items.attribute_values is
  'Answers to that product type''s questions, {attribute_id: [value, ...]}. Written into product_attribute_values at receipt. Validated against the type when the order is saved, never at receipt.';

-- ---------------------------------------------------------------------------
-- Done. Both columns are optional and default to empty, so every existing
-- purchase order stays valid and receives exactly as it did before.
-- ---------------------------------------------------------------------------
