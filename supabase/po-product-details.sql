-- ===========================================================================
-- po-product-details.sql — carry size and description from the purchase
--                          order onto the product it creates.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor -> New query.
--
-- A product created by receiving a purchase order arrived with a name, a
-- category and a price and nothing else, so its page showed "SIZE —" and an
-- empty description until someone went and typed them in. But the buyer
-- already knew both when they placed the order: that is exactly the moment
-- the sizes and the description are in front of them.
--
-- So they are captured on the line, and flow onto the product at receipt.
-- Two rules make that safe:
--
--   * a product CREATED by the receipt gets both, always;
--   * a product that already exists is only ever FILLED IN, never
--     overwritten. Someone may have written a careful description on the
--     shop's own listing, and a restock must not silently replace it with
--     whatever the supplier called it.
-- ===========================================================================

-- Free text, matching how the buyer writes it on the supplier's order:
-- "S, M, L, XL". Split into the product's sizes array at receipt, so the
-- shape stored here stays whatever the buyer typed and the parsing lives in
-- one tested place (parseSizes in lib/procurement.ts).
alter table purchase_order_items
  add column if not exists sizes text not null default '';

alter table purchase_order_items
  add column if not exists description text not null default '';

comment on column purchase_order_items.sizes is
  'Sizes as typed, e.g. "S, M, L, XL". Parsed into products.sizes at receipt.';
comment on column purchase_order_items.description is
  'Product description, used when this line creates a product, or to fill a blank one. Never overwrites an existing description.';

-- ---------------------------------------------------------------------------
-- Done. Nothing else changes: both columns default to empty, so every
-- existing purchase order stays valid and behaves exactly as before.
-- ---------------------------------------------------------------------------
