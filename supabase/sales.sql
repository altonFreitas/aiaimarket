-- ===========================================================================
-- sales.sql — what the sales management dashboard needs and the schema
--             did not already have.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor -> New query.
--
-- Three things are added, and nothing existing is changed:
--
--   1. product_costs   unit cost per product, so gross profit and margin
--                      can be computed at all.
--   2. orders          expected_delivery / delivered_at / invoiced_at, so
--                      delivery lateness and invoicing are answerable.
--   3. sales_targets   a target per period, so "are we on track" has an
--                      answer instead of a shrug.
--
-- WHY COST LIVES IN ITS OWN TABLE, not as products.cost_price
-- -----------------------------------------------------------
-- `products` is readable with the browser's anon key -- that is the whole
-- storefront. In Postgres a table-level `grant select on products` covers
-- every column, INCLUDING ones added later, so a cost_price column on
-- products would be readable by anyone who opens the site and reads the
-- network tab. Purchase cost is the single most commercially sensitive
-- number a shop has. A separate table with no anon grant cannot leak that
-- way, whatever a future migration does to products.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Unit cost
-- ---------------------------------------------------------------------------

create table if not exists product_costs (
  product_id  uuid primary key references products(id) on delete cascade,
  -- What one unit costs the store to acquire. Excludes delivery to the
  -- buyer: that is charged separately as `fee` and is not part of COGS.
  cost_price  numeric(12,2) not null check (cost_price >= 0),
  note        text not null default '',
  updated_at  timestamptz not null default now()
);

comment on table product_costs is
  'Unit acquisition cost per product. Service-role only -- never exposed to anon.';

alter table product_costs enable row level security;

-- No policies at all, plus an explicit revoke. RLS with zero policies
-- already denies everything to anon/authenticated; the revoke is the second,
-- independent lock, so forgetting one does not open the door. The service
-- role bypasses RLS, which is how the admin pages read it.
revoke all on product_costs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Delivery and invoice dates on orders
-- ---------------------------------------------------------------------------
-- Dates, not timestamps: an order is promised for a DAY. A timestamp here
-- only ever produces off-by-one bugs across time zones -- the same reasoning
-- as purchase_orders.order_date in procurement.sql.

alter table orders add column if not exists expected_delivery date;
alter table orders add column if not exists delivered_at      date;
alter table orders add column if not exists invoiced_at       date;

comment on column orders.expected_delivery is
  'The day the buyer was promised delivery. NULL = never promised a date, which is why lateness reads "unknown" rather than "on time".';
comment on column orders.delivered_at is
  'The day it actually reached the buyer. Set automatically on the first move into arrived/completed.';

-- Stamp the delivery day automatically on the first transition into a
-- delivered state, so history fills in from normal admin work rather than
-- needing anyone to remember. Only ever writes when the column is still
-- empty: a hand-corrected date is never overwritten by a later status
-- change, and re-running this migration cannot rewrite past orders.
create or replace function orders_stamp_fulfilment() returns trigger
language plpgsql as $$
begin
  if new.status in ('arrived', 'completed') and new.delivered_at is null then
    new.delivered_at := current_date;
  end if;
  if new.status = 'completed' and new.invoiced_at is null then
    new.invoiced_at := current_date;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_stamp_fulfilment on orders;
create trigger trg_orders_stamp_fulfilment
  before insert or update of status on orders
  for each row execute function orders_stamp_fulfilment();

-- ---------------------------------------------------------------------------
-- 3. Sales targets
-- ---------------------------------------------------------------------------

create table if not exists sales_targets (
  id         uuid primary key default gen_random_uuid(),
  -- '2026' (year), '2026-Q3' (quarter) or '2026-08' (month). One text column
  -- rather than period_type + period_number: the format IS the type, the
  -- check constraint enforces it, and it sorts correctly as plain text.
  period     text not null check (period ~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$'),
  scope      text not null default 'global'
             check (scope in ('global', 'category', 'seller', 'municipality')),
  -- Empty for a global target; a category id, seller id or municipality
  -- name otherwise. Deliberately NOT a foreign key: a target set against a
  -- category that is later deleted should keep reporting its history rather
  -- than vanish or block the delete.
  scope_id   text not null default '',
  amount     numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (period, scope, scope_id)
);

comment on table sales_targets is
  'Revenue target per period and scope. Service-role only.';

alter table sales_targets enable row level security;
revoke all on sales_targets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- The dashboard reads the whole order book and aggregates in the
-- application (a store's history is small, and it means one round trip
-- instead of a dozen). These support the ordinary admin list views that
-- filter by date and status.

create index if not exists orders_created_at_idx    on orders (created_at desc);
create index if not exists orders_status_idx        on orders (status);
create index if not exists orders_delivered_at_idx  on orders (delivered_at)
  where delivered_at is not null;
create index if not exists sales_targets_period_idx on sales_targets (period);

-- ---------------------------------------------------------------------------
-- Done.
--
-- Until a cost is entered for at least one product, every profit and margin
-- panel on the dashboard says so plainly and shows no number. That is
-- deliberate: a margin computed against an assumed cost of zero would read
-- as 100% margin on everything, which is worse than no number at all.
-- ---------------------------------------------------------------------------
