-- ===========================================================================
-- Loja AIAI -- buying and receiving by variant
--
-- Run AFTER supabase/variants.sql. Safe to re-run.
--
-- A purchase order line already says how many of each SIZE it buys --
-- purchase_order_items.size_qty, {"S":5,"M":10,"L":15} -- and receiving
-- writes one ledger movement per size. That is the whole shape of this
-- feature and it works. What it cannot express is "twenty Black M and
-- thirty White L", because size is one axis and a variant is several.
--
-- SO THE LINE GAINS A SECOND MAP, BESIDE THE FIRST, keyed by variant id
-- instead of by size label. A line uses one or the other, never both: an
-- order for shirts by size keeps working exactly as it does today, and an
-- order for shirts by colour-and-size uses the new one.
--
-- THE INDEX IS THE DANGEROUS PART OF THIS FILE, and the reason it is not
-- just a column. Receiving is idempotent because a unique index refuses
-- the second receipt of the same line -- Postgres rejecting it, not a
-- check-then-insert that two concurrent clicks could both pass. That index
-- is on (po_item_id, size). A line buying three variants writes three
-- movements that all share one size, and the index would accept the first
-- and reject the other two: the shop would receive twenty shirts and
-- believe it had seventy.
--
-- This is exactly the bug size-stock.sql had to fix when it added sizes,
-- one axis later. The fix is the same: widen the index rather than add a
-- second one, because two overlapping unique indexes would both have to be
-- satisfied and the narrower one would still do the rejecting.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. How many of each variant a line buys
-- ---------------------------------------------------------------------------
-- {"<variant uuid>": 20, "<variant uuid>": 30}. Empty for a line bought by
-- size, or for goods that have neither.
--
-- jsonb rather than a child table, for the reason size_qty is: the line
-- owns this as one field, it is written and read whole, and a child table
-- would add a join to every purchasing screen to hold what is always one
-- small map. qty stays the line's total and stays what the money is
-- calculated from; the application adds this up and writes the result into
-- qty rather than trusting two fields to be kept in step by hand.

alter table purchase_order_items
  add column if not exists variant_qty jsonb not null default '{}'::jsonb;

comment on column purchase_order_items.variant_qty is
  'How many of each VARIANT this line buys, keyed by product_variants.id. Empty for a line bought by size (see size_qty) or for goods with neither. Sums to qty.';

-- ---------------------------------------------------------------------------
-- 2. Receiving the same line once PER VARIANT
-- ---------------------------------------------------------------------------
-- COALESCE, and it matters. A unique index treats NULLs as distinct, so
-- (po_item_id, size, null) twice would be two different keys and the
-- second receipt of an unsized, unvarianted line would be accepted --
-- which is the idempotency this index exists to provide, silently gone
-- for every line the shop has ever received. The sentinel uuid makes "no
-- variant" one value that compares like any other. order-items.sql does
-- the same thing with the same sentinel, for the same reason.

drop index if exists stock_movements_receipt_once;

create unique index if not exists stock_movements_receipt_once
  on stock_movements (
    po_item_id,
    size,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where reason = 'purchase_receipt' and po_item_id is not null;

comment on index stock_movements_receipt_once is
  'Receiving is idempotent per purchase-order line, per size AND per variant. A second receipt of the same line and the same combination is rejected by Postgres, not by a check-then-insert two concurrent clicks could both pass.';
