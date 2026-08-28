-- ===========================================================================
-- procurement.sql — purchasing: suppliers, purchase orders, line items
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Requires schema.sql to have been run first.
--
-- This is a NEW domain, not a view over what the store already holds. The
-- existing `sellers` table is marketplace vendors who sell THROUGH the
-- platform; a supplier is someone the company buys FROM. Opposite direction,
-- different data, deliberately separate tables.
--
-- Everything here is additive. Without this file the store behaves exactly
-- as it does today; /admin/procurement simply reports that procurement has
-- not been set up yet.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
create table if not exists suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- ISO 3166-1 alpha-2, uppercased. A code rather than a free-text country
  -- name because the dashboard groups and ranks by country, and "Portugal",
  -- "portugal" and "PT" typed on three different days are three countries to
  -- a GROUP BY. The display name is resolved in the app (lib/countries.ts).
  country_code  text not null default '' check (country_code ~ '^[A-Z]{0,2}$'),
  contact_name  text not null default '',
  email         text not null default '',
  phone         text not null default '',
  -- Days the supplier itself promises between order and arrival. Used to
  -- flag a purchase order whose expected date was set more optimistically
  -- than the supplier has ever actually delivered.
  lead_time_days int,
  notes         text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_suppliers_country on suppliers(country_code);
alter table suppliers enable row level security;
-- No policy at all: supplier terms and contacts are commercially sensitive
-- and no visitor has any business reading them. RLS with zero policies
-- denies everyone; the admin pages reach this through the service-role
-- client, the same way orders are already handled.
revoke all on suppliers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- purchase_orders
--
-- On currency: the amount is stored in the currency actually transacted,
-- alongside the rate to the base currency ON THE DAY THE ORDER WAS PLACED.
-- Storing only the foreign amount makes "total purchase value" across a
-- mixed-currency book meaningless; converting at today's rate makes last
-- year's numbers change every morning. A rate captured at order time is what
-- procurement systems actually do, and it makes every total below both
-- comparable and stable.
-- ---------------------------------------------------------------------------
create table if not exists purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  po_number       text not null unique,              -- PO-2026-0001
  supplier_id     uuid not null references suppliers(id) on delete restrict,
  -- restrict, not cascade: deleting a supplier must never silently erase the
  -- purchasing history that explains where the money went.
  buyer           text not null default '',          -- responsible purchasing manager
  order_date      date not null default current_date,
  expected_arrival date,
  actual_arrival   date,

  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- Multiply a figure in `currency` by this to get base currency (USD).
  -- 1 for USD itself.
  fx_rate         numeric(14,6) not null default 1 check (fx_rate > 0),

  -- Header-level money, in `currency`. The goods subtotal is NOT stored: it
  -- is the sum of the line items, and a stored copy is a second number that
  -- can disagree with them.
  tax             numeric(14,2) not null default 0 check (tax >= 0),
  shipping        numeric(14,2) not null default 0 check (shipping >= 0),
  discount        numeric(14,2) not null default 0 check (discount >= 0),

  -- The eight stages from the brief. `delayed` is deliberately NOT one of
  -- them: lateness is derived by comparing dates, so it cannot drift out of
  -- step with them the way a manually-set flag would.
  status          text not null default 'draft' check (status in
                    ('draft','approved','sent','confirmed','in_production',
                     'in_transit','arrived','received','cancelled')),
  payment_status  text not null default 'unpaid' check (payment_status in
                    ('unpaid','partial','paid','overdue')),
  payment_date    date,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_po_supplier on purchase_orders(supplier_id);
create index if not exists idx_po_status on purchase_orders(status);
create index if not exists idx_po_order_date on purchase_orders(order_date desc);
create index if not exists idx_po_expected on purchase_orders(expected_arrival);
alter table purchase_orders enable row level security;
revoke all on purchase_orders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- purchase_order_items
--
-- Free-text product name plus an optional link to a catalog product. A great
-- deal of what a company buys (packaging, office supplies, services) is never
-- a catalog listing, so requiring a product_id would make most real purchase
-- orders unrecordable.
-- ---------------------------------------------------------------------------
create table if not exists purchase_order_items (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  product_name  text not null,
  category      text not null default 'other' check (category in
                  ('raw_materials','components','packaging','office','equipment','services','other')),
  qty           numeric(14,3) not null check (qty > 0),
  unit_price    numeric(14,4) not null check (unit_price >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists idx_poi_po on purchase_order_items(po_id);
create index if not exists idx_poi_product on purchase_order_items(product_id);
alter table purchase_order_items enable row level security;
revoke all on purchase_order_items from anon, authenticated;

-- Keeps updated_at honest without the application having to remember.
create or replace function touch_purchase_order() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_touch_po on purchase_orders;
create trigger trg_touch_po before update on purchase_orders
  for each row execute function touch_purchase_order();

-- An order cannot have arrived before it was placed. Cheap to check here,
-- and impossible to enforce reliably in a form that several screens post to.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'po_arrival_after_order') then
    alter table purchase_orders add constraint po_arrival_after_order
      check (actual_arrival is null or actual_arrival >= order_date);
  end if;
end $$;
