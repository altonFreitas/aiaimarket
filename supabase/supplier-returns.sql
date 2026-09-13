-- ===========================================================================
-- Loja AIAI -- sending goods back to the supplier
--
-- Run AFTER supabase/procurement.sql and supabase/stock-reservation.sql.
-- Safe to re-run.
--
-- Goods could come back from a customer and could not go back to a supplier.
-- The shop could record that a pair of shoes arrived broken in a delivery --
-- supabase/receiving.sql has always let a receipt be short or damaged -- but
-- once the box had been received there was no document for "we sent it
-- back". So a carton of faulty stock either sat on the shelf as sellable
-- inventory, or was quietly adjusted away as if it had evaporated, and the
-- money the supplier owed for it was remembered by one person.
--
-- THIS IS NOT A CUSTOMER RETURN POINTING THE OTHER WAY. The two documents
-- share a shape and almost nothing else:
--
--   order_returns     goods arrive, stock goes UP, the shop owes money OUT.
--   supplier_returns  goods leave,  stock goes DOWN, money is owed INWARD
--                     and often as a credit note rather than cash.
--
-- The reasons differ too. A supplier cannot change their mind; a supplier
-- can over-deliver, and can send something already expired. Sharing one
-- vocabulary would have meant a list where half the options are wrong
-- whichever screen you are on.
-- ===========================================================================

create table if not exists supplier_returns (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references suppliers(id) on delete restrict,
  -- restrict, not cascade: the same reasoning purchase_orders uses. Deleting
  -- a supplier must not erase the record of a claim against them.

  -- The purchase order the goods arrived on, where it is known. Optional
  -- because stock predating procurement, or a sample that never had a PO,
  -- can still be faulty and still has to go back.
  po_id         uuid references purchase_orders(id) on delete set null,

  -- SRT + year + six random. Readable over a phone call, like an order
  -- reference and a customer return reference.
  ref           text not null unique,

  reason        text not null check (reason in
                  ('damaged','wrong_item','not_as_described',
                   'over_delivery','expired','other')),
  note          text not null default '',

  -- What the shop expects back, in `currency`, and what actually arrived.
  -- Two columns rather than one, because the gap between them is the whole
  -- point: a claim nobody chased is the reason this table exists.
  currency          text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  fx_rate           numeric(14,6) not null default 1 check (fx_rate > 0),
  credit_expected   numeric(14,2) not null default 0 check (credit_expected >= 0),
  credit_received   numeric(14,2) not null default 0 check (credit_received >= 0),
  -- Null until the money or the credit note actually lands. The same
  -- discipline supabase/refund-settlement.sql imposed on refunds going the
  -- other way: agreed is not settled, and a screen that conflates the two
  -- tells the shop it has money it does not have.
  credited_at       timestamptz,

  -- In USD, so a claim raised in euros can be added to one raised in
  -- dollars without every reader repeating the multiplication. Generated,
  -- so it cannot drift from the figures above.
  credit_expected_usd numeric(14,2)
    generated always as (round(credit_expected * fx_rate, 2)) stored,
  credit_received_usd numeric(14,2)
    generated always as (round(credit_received * fx_rate, 2)) stored,

  -- Where the parcel is. Deliberately short: the shop either still has the
  -- goods, has sent them, or the matter is closed one way or the other.
  status        text not null default 'draft' check (status in
                  ('draft','sent','credited','rejected','cancelled')),

  shipped_on    date,
  created_by    text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists supplier_returns_supplier_idx
  on supplier_returns (supplier_id, created_at desc);
create index if not exists supplier_returns_po_idx on supplier_returns (po_id);
-- The question the dashboard asks most: what is still owed to us.
create index if not exists supplier_returns_open_credit_idx
  on supplier_returns (created_at desc)
  where credited_at is null and status in ('draft','sent');

create table if not exists supplier_return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references supplier_returns(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  -- Copied, not joined, exactly as an order line and a purchase order line
  -- are: the document has to stay readable after a product is deleted.
  product_name  text not null default '',
  qty           numeric(14,3) not null check (qty > 0),
  -- What the shop paid for one, so the claim has a basis. Not read back
  -- from the product's current cost: that changes.
  unit_cost     numeric(14,4) not null default 0 check (unit_cost >= 0),

  -- Do these units leave the shelf?
  --
  -- The mirror image of order_return_items.restock, and it exists for the
  -- same reason. Goods quarantined on arrival were never received into
  -- stock, so sending them back must not decrement a balance they were
  -- never part of. Defaults true, because the ordinary case is faulty
  -- stock discovered after it was put away.
  from_stock    boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists supplier_return_items_return_idx
  on supplier_return_items (return_id);
create index if not exists supplier_return_items_product_idx
  on supplier_return_items (product_id);

-- ---------------------------------------------------------------------------
-- The ledger learns one more word
-- ---------------------------------------------------------------------------
-- Replaced rather than added to, so re-running this file is a no-op rather
-- than leaving two constraints saying subtly different things.

alter table stock_movements
  drop constraint if exists stock_movements_reason_check;

alter table stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('purchase_receipt','sale','adjustment','return',
                    'correction','reservation','supplier_return'));

comment on column stock_movements.reason is
  'purchase_receipt, sale, return (from a customer), supplier_return (back to a supplier), adjustment, correction, or reservation. See supabase/supplier-returns.sql.';

-- ---------------------------------------------------------------------------
-- Goods leaving go through the ledger, like everything else
-- ---------------------------------------------------------------------------
-- Per line, not per return: one parcel back to a supplier can hold two
-- faulty lamps that were on the shelf and one that was quarantined on
-- arrival, and only the two ever counted as stock.
--
-- On insert, because recording a supplier return IS the act of sending the
-- goods -- there is no separate "picked" step in this shop, and a document
-- that took stock out at some later click would leave the shelf wrong in
-- between.

create or replace function apply_supplier_return_stock() returns trigger
language plpgsql as $$
declare r_ref text;
begin
  if not new.from_stock or new.product_id is null then return new; end if;

  select r.ref into r_ref from supplier_returns r where r.id = new.return_id;

  insert into stock_movements (product_id, delta, reason, note)
  values (new.product_id, -new.qty, 'supplier_return',
          'returned to supplier on ' || coalesce(r_ref, ''));
  return new;
end $$;

drop trigger if exists trg_apply_supplier_return_stock on supplier_return_items;
create trigger trg_apply_supplier_return_stock
  after insert on supplier_return_items
  for each row execute function apply_supplier_return_stock();

comment on function apply_supplier_return_stock is
  'Units going back to a supplier leave through the ledger, so products.qty still has exactly one writer.';

-- ---------------------------------------------------------------------------
-- The status follows the credit, rather than being typed beside it
-- ---------------------------------------------------------------------------
-- The same discipline the order refund status follows: two people
-- maintaining one fact is how they come to disagree. A return that has been
-- paid in full is credited; one where the money landed short stays open,
-- because a partial credit is an unfinished argument, not a closed one.

create or replace function sync_supplier_return_status() returns trigger
language plpgsql as $$
begin
  if new.credited_at is not null
     and new.credit_received >= new.credit_expected
     and new.status in ('draft','sent') then
    new.status := 'credited';
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_supplier_return_status on supplier_returns;
create trigger trg_sync_supplier_return_status
  before insert or update on supplier_returns
  for each row execute function sync_supplier_return_status();

-- ---------------------------------------------------------------------------
-- Grants -- a claim against a supplier is admin-only, like purchasing
-- ---------------------------------------------------------------------------
alter table supplier_returns enable row level security;
alter table supplier_return_items enable row level security;
-- No policy at all: RLS with zero policies denies everyone, and the admin
-- pages reach these through the service-role client the way orders and
-- purchase orders already are.
--
-- Both revokes are needed. Supabase's default privileges grant every new
-- table to anon and authenticated DIRECTLY, and PUBLIC holds a separate
-- grant that those two inherit -- revoking one leaves the other standing.
revoke all on supplier_returns from public, anon, authenticated;
revoke all on supplier_return_items from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;
-- Still nothing: a supplier return is a movement like any other.
-- ---------------------------------------------------------------------------
