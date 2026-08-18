-- ===========================================================================
-- payments.sql — card payment tables (BNCTL / Mastercard acquiring)
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run. Apply-aiaimarket-payments.js never touches your database.
--
-- Design notes worth reading before changing anything here:
--
--  * Amounts are stored as BIGINT MINOR UNITS (cents), not numeric dollars.
--    Card networks settle in integer minor units; storing what we actually
--    sent removes a rounding step from every reconciliation.
--
--  * There is NO card data in this schema and there never will be. The
--    integration is hosted-redirect only, so a PAN never reaches this
--    server. Adding a card_number column here is not an enhancement -- it
--    moves the store from PCI-DSS SAQ A to SAQ D.
--
--  * No RLS policy grants anyone public access. Payments are read and
--    written exclusively through the service-role client in server code,
--    the same trust model as `orders`.
-- ===========================================================================

create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete restrict,
  provider       text not null,
  -- The gateway's own handle for this attempt. Nullable because the row is
  -- deliberately written BEFORE the gateway is called: a charge that exists
  -- at the acquirer with no local record is the one failure mode that
  -- cannot be reconciled afterwards.
  provider_ref   text,
  -- Unique per attempt. Stops a double-submitted checkout from opening two
  -- authorizations against one order.
  idempotency_key text not null unique,
  amount_minor   bigint not null check (amount_minor > 0),
  currency       text not null default 'USD',
  status         text not null default 'initiated'
                 check (status in ('initiated','pending','authorized','captured','failed','cancelled','refunded')),
  failure_reason text,
  redirect_url   text,
  -- Last raw payload from the provider. Kept for disputes: months later,
  -- "what exactly did the gateway tell us" is the only thing that settles
  -- an argument about a transaction.
  raw_event      jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_payments_order    on payments(order_id);
create index if not exists idx_payments_status   on payments(status);
create index if not exists idx_payments_provider on payments(provider, provider_ref);

-- At most ONE live attempt per order. A partial unique index (rather than a
-- plain one) because completed attempts must be allowed to accumulate --
-- a buyer whose card is declined has to be able to try again.
create unique index if not exists idx_payments_one_live_attempt
  on payments(order_id)
  where status in ('initiated','pending');

alter table payments enable row level security;
-- No policies at all == deny everything to anon/authenticated. Deliberate:
-- every read and write goes through the service-role client in server code.

-- ---------------------------------------------------------------------------
-- payment_events — the append-only journal.
--
-- Every provider message is recorded here, INCLUDING the ones deliberately
-- ignored (duplicate deliveries, out-of-order events, amount mismatches).
-- "We received this and chose not to act on it" is exactly the record you
-- need when a customer disputes a charge six weeks later.
-- ---------------------------------------------------------------------------
create table if not exists payment_events (
  id          bigint generated always as identity primary key,
  payment_id  uuid not null references payments(id) on delete cascade,
  -- The provider's event id. Unique per payment, which is what makes
  -- webhook redelivery a no-op instead of a double-credit.
  event_id    text not null,
  status      text not null,
  payload     jsonb,
  created_at  timestamptz not null default now(),
  unique (payment_id, event_id)
);

create index if not exists idx_payment_events_payment on payment_events(payment_id);

alter table payment_events enable row level security;
-- Same as payments: no policies, service-role only.

-- ---------------------------------------------------------------------------
-- orders.pay_method gains 'card'.
--
-- The existing CHECK constraint has to be dropped and rebuilt -- Postgres
-- has no "alter check constraint in place".
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'orders_pay_method_check' and conrelid = 'orders'::regclass
  ) then
    alter table orders drop constraint orders_pay_method_check;
  end if;

  alter table orders add constraint orders_pay_method_check
    check (pay_method in ('cod','cop','bank','wallet','fiar','card'));
end $$;

-- ---------------------------------------------------------------------------
-- Keep payments.updated_at honest without every caller remembering to set it.
-- ---------------------------------------------------------------------------
create or replace function touch_payment_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_payments_touch on payments;
create trigger trg_payments_touch
  before update on payments
  for each row execute function touch_payment_updated_at();

-- ---------------------------------------------------------------------------
-- Reconciliation helper: everything that started and never finished.
--
-- Run this daily. A row that has sat in 'pending' for more than an hour is
-- a buyer who was sent to the gateway and whose outcome never came back --
-- either the webhook was lost or they abandoned. Either way it needs a
-- human to look, because "we don't know if we were paid" is not a state to
-- leave orders sitting in.
-- ---------------------------------------------------------------------------
create or replace view payments_needing_review as
  select p.id, p.order_id, o.ref as order_ref, p.provider, p.provider_ref,
         p.amount_minor, p.currency, p.status, p.created_at, p.updated_at
    from payments p
    join orders o on o.id = p.order_id
   where p.status in ('initiated','pending','authorized')
     and p.created_at < now() - interval '1 hour'
   order by p.created_at;
