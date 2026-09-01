-- ===========================================================================
-- stock-receipt.sql — receiving a purchase order updates the shop.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor -> New query.
--
-- Today a purchase order is a record of what you bought and nothing more:
-- when the goods land you retype the quantity into Stock control and the
-- cost into Unit costs by hand. This migration makes the receipt the single
-- event that writes all of it.
--
-- THREE IDEAS, stated once here.
--
-- 1. TWO KINDS OF CATEGORY, WHICH ARE NOT THE SAME QUESTION.
--    purchase_order_items.category is a SPEND category -- what kind of money
--    is this: packaging, office supplies, equipment. A shop that buys
--    clothes to resell had nowhere to put them, so 'goods_for_resale' is
--    added and becomes the default.
--    A resale line also carries catalog_category_id: where the item sits in
--    the SHOP (Clothes, Shoes). The two never conflict, because they answer
--    different questions -- why we spent it, and where it goes on sale.
--    Only resale lines ever touch stock. An office chair is a real purchase
--    and must never appear in the catalog.
--
-- 2. EVERY STOCK CHANGE IS A LEDGER ROW, NOT JUST A NEW BALANCE.
--    stock_movements records each receipt with its quantity, its cost, the
--    order it came from and the day it landed. products.qty stays the
--    running balance; the ledger is how you answer "where did these 40 come
--    from and what did they cost", which a balance alone can never do.
--
-- 3. RECEIVING IS IDEMPOTENT.
--    A unique index on the line id means moving an order back to in_transit
--    and forward to received again cannot add the stock twice. This is the
--    single most important property here: without it a mis-click silently
--    inflates inventory, and nothing downstream would ever reveal it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Resale lines: the spend category, and the link into the catalog
-- ---------------------------------------------------------------------------

alter table purchase_order_items
  drop constraint if exists purchase_order_items_category_check;

alter table purchase_order_items
  add constraint purchase_order_items_category_check
  check (category in ('goods_for_resale','raw_materials','components','packaging',
                      'office','equipment','services','other'));

-- Where a newly bought product should sit in the shop. Null for a line that
-- links to a product that already exists (it has its own category), and for
-- anything not destined for the catalog at all.
alter table purchase_order_items
  add column if not exists catalog_category_id uuid references categories(id) on delete set null;

-- The intended shelf price for a product this line will CREATE. Purchase
-- price and selling price are unrelated numbers, so the buyer states it;
-- ignored when the line links to an existing product, which already has one.
alter table purchase_order_items
  add column if not exists sell_price numeric(12,2) check (sell_price is null or sell_price >= 0);

comment on column purchase_order_items.category is
  'SPEND category -- what kind of money this is. Distinct from the catalog category, which is where the goods sit in the shop.';

-- ---------------------------------------------------------------------------
-- 2. The stock ledger
-- ---------------------------------------------------------------------------

create table if not exists stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  -- Signed: +40 received, -2 sold. Never a replacement balance, always a
  -- change, so the rows sum to the balance and history stays reconstructable.
  delta        int not null check (delta <> 0),
  reason       text not null check (reason in
                 ('purchase_receipt','sale','adjustment','return','correction')),
  -- Where it came from. Nullable because an adjustment has no document.
  po_id        uuid references purchase_orders(id) on delete set null,
  po_item_id   uuid references purchase_order_items(id) on delete set null,
  order_id     uuid references orders(id) on delete set null,
  -- Landed unit cost in BASE currency (USD) at the moment of receipt:
  -- purchase price plus this line's share of tax, shipping and discount,
  -- converted at the order's fx_rate. Null for movements that are not
  -- purchases. See landedUnitCost() in lib/procurement.ts for the split.
  unit_cost    numeric(14,4),
  note         text not null default '',
  created_at   timestamptz not null default now()
);

comment on table stock_movements is
  'Append-only ledger of stock changes. products.qty is the running balance; this is the history behind it.';

-- The idempotency lock. One receipt row per purchase order line, ever.
-- Partial, so a product may still have many sales and adjustments.
create unique index if not exists stock_movements_receipt_once
  on stock_movements (po_item_id)
  where reason = 'purchase_receipt' and po_item_id is not null;

create index if not exists stock_movements_product_idx on stock_movements (product_id, created_at desc);
create index if not exists stock_movements_po_idx      on stock_movements (po_id);

alter table stock_movements enable row level security;
-- No policies plus an explicit revoke: two independent locks, so forgetting
-- one does not open the door. The service role bypasses RLS, which is how
-- the admin pages read it. Purchase costs are visible here, and those must
-- never reach a browser holding only the anon key.
revoke all on stock_movements from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Applying a movement to the balance
-- ---------------------------------------------------------------------------
-- A trigger, not application code: the balance and the ledger row then move
-- together in one transaction and cannot drift apart, whatever writes the
-- row. Mirrors decrement_stock_on_confirm() in schema.sql, which keeps the
-- same thresholds on the way down.

create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
declare new_qty int;
begin
  update products
     set qty = greatest(0, qty + new.delta),
         stock_status = case
           when greatest(0, qty + new.delta) = 0 then 'out'
           when greatest(0, qty + new.delta) <= 2 then 'low'
           else 'in' end
   where id = new.product_id
   returning qty into new_qty;
  return new;
end $$;

drop trigger if exists trg_apply_stock_movement on stock_movements;
create trigger trg_apply_stock_movement
  after insert on stock_movements
  for each row execute function apply_stock_movement();

-- ---------------------------------------------------------------------------
-- Done.
--
-- Receiving stays a deliberate act: nothing here fires on its own. The admin
-- moves a purchase order to "received" and the application writes one ledger
-- row per resale line, which this trigger turns into stock. Lines with no
-- product link -- office supplies, services -- are skipped, as they should
-- be: they are real spending that never belonged in the catalog.
-- ---------------------------------------------------------------------------
