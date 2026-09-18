-- ---------------------------------------------------------------------------
-- Telling customers about a new product, or a new discount
-- ---------------------------------------------------------------------------
-- Run AFTER schema.sql (customers, products) and notifications.sql, whose
-- shape this follows. Safe to re-run.
--
-- customers.notify_new_products has existed since the account page did, and
-- a customer ticking it was told nothing, ever. Nothing read the column.
-- This is the queue that makes the promise real.
--
-- ONE ROW PER CUSTOMER PER PRODUCT PER KIND, and the unique index is the
-- whole safety story: a shop that edits a product five times on the morning
-- it goes live must not send five messages to everybody. The insert is
-- `on conflict do nothing`, so re-saving is free.
--
-- THE SHAPE IS notifications.sql's, deliberately: body rendered at QUEUE
-- time so a template change tomorrow cannot alter what was queued today, a
-- status the admin screen can act on, and the same manual fallback when no
-- gateway is configured.
--
-- A SEPARATE TABLE rather than widening notifications: that table's order_id
-- is NOT NULL and its event list is the order's lifecycle. Making order_id
-- nullable to fit announcements in would weaken a constraint that protects
-- every order message, to save one create table.
-- ---------------------------------------------------------------------------
create table if not exists customer_alerts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  product_id  uuid not null references products(id)  on delete cascade,
  -- What is being announced. 'new_product' when it first goes on sale,
  -- 'discount' when a price is cut. A product can produce one of each over
  -- its life, and never a second of either.
  kind        text not null check (kind in ('new_product','discount')),
  to_phone    text not null,
  lang        text not null default 'tet' check (lang in ('tet','pt','en')),
  -- Rendered when queued, for the same reason an order message is.
  body        text not null,
  channel     text not null default 'manual',
  provider    text not null default '',
  status      text not null default 'queued'
                check (status in ('queued','sent','failed','skipped')),
  error       text not null default '',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- THE CONSTRAINT THAT STOPS A SECOND BLAST. Everything else is convenience.
create unique index if not exists customer_alerts_once
  on customer_alerts (customer_id, product_id, kind);

create index if not exists customer_alerts_queued
  on customer_alerts (status, created_at desc);

alter table customer_alerts enable row level security;

-- ---------------------------------------------------------------------------
-- NOBODY READS THIS THROUGH THE PUBLIC KEY
-- ---------------------------------------------------------------------------
-- Every row holds a customer's phone number beside what they were told, so
-- a public read would be a list of the shop's customers and their numbers.
-- RLS is on with NO policy at all: the service-role client the admin screens
-- use bypasses RLS, and the anon key therefore sees nothing rather than
-- whatever a policy forgot to exclude.
-- ---------------------------------------------------------------------------
revoke all on customer_alerts from anon, authenticated;

comment on table customer_alerts is
  'Queued messages telling customers about a new product or a new discount. One per customer per product per kind, enforced by customer_alerts_once. Written by queueProductAlerts() in src/lib/notify/announce.ts; never readable through the anon key.';
