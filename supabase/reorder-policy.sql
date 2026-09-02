-- ===========================================================================
-- Loja AIAI -- the reorder policy belongs to the shop
--
-- The reorder plan works from four numbers: how far back to measure demand,
-- how long a delivery takes when the supplier has not said, how much buffer
-- to hold, and how often orders are placed. They were constants in
-- lib/replenishment.ts, which is fine for a default and wrong as a rule:
-- a shop buying weekly from Dili and one buying quarterly from Jakarta want
-- different answers, and neither should have to edit code to get one.
--
-- Defaults match the constants they replace exactly, so a store that runs
-- this and changes nothing sees the same plan it saw yesterday.
--
-- Safe to re-run.
-- ===========================================================================

alter table settings
  -- Eight weeks: long enough to survive one quiet fortnight, short enough
  -- to notice a product that has started moving.
  add column if not exists reorder_window_days int not null default 56
    check (reorder_window_days between 7 and 365);

alter table settings
  -- How often orders are placed. Stock has to cover the wait for the NEXT
  -- order as well as this one, or every line is reordered at the last
  -- possible moment.
  add column if not exists reorder_review_days int not null default 14
    check (reorder_review_days between 1 and 180);

alter table settings
  -- Buffer on top of the lead time, for the week the boat is late.
  add column if not exists reorder_safety_days int not null default 7
    check (reorder_safety_days between 0 and 180);

alter table settings
  -- Used when a supplier has never delivered and states no lead time.
  add column if not exists reorder_default_lead_days int not null default 14
    check (reorder_default_lead_days between 1 and 365);

comment on column settings.reorder_window_days is
  'Days of sales history the reorder plan measures demand over.';
comment on column settings.reorder_review_days is
  'Days between placing purchase orders. Sets how far past the lead time an order must last.';
comment on column settings.reorder_safety_days is
  'Buffer held on top of the lead time.';
comment on column settings.reorder_default_lead_days is
  'Delivery time assumed for a supplier that states none.';

-- ---------------------------------------------------------------------------
-- Done. The reorder plan reads these; nothing else does.
-- ---------------------------------------------------------------------------
