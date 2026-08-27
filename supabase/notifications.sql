-- ===========================================================================
-- notifications.sql — order notifications sent to the buyer's phone
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Requires schema.sql to have been run first.
--
-- Additive and optional: without this file the store behaves exactly as it
-- does today. Order status changes still work; they just don't tell anyone.
-- ===========================================================================

-- The buyer's language, captured at checkout.
--
-- A notification arriving in a language the buyer doesn't read is worse than
-- no notification -- they can't tell it from spam. The site already knows
-- which of the three languages they were browsing in, so the only thing
-- missing was somewhere to keep it. Defaults to Tetun, matching the site.
alter table orders add column if not exists lang text not null default 'tet'
  check (lang in ('tet','pt','en'));

-- ---------------------------------------------------------------------------
-- notifications — one row per message the store owes a buyer
--
-- An outbox, not a log. The row is written FIRST, then a send is attempted
-- against it, so a message can never be lost between "we decided to tell
-- them" and "the network call failed". A row that is still `queued` is work
-- outstanding; the admin can see it and send it by hand.
--
-- That distinction is what makes this useful before any SMS gateway is
-- configured at all: with no provider set up, every notification queues with
-- channel='manual' and the admin gets a one-tap link that opens their own
-- phone's SMS app with the number and text filled in. Configure a gateway
-- later and the same rows start sending themselves.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  -- Denormalised so the admin queue can show which order a message belongs
  -- to without a join, and so a row stays readable in isolation.
  order_ref    text not null,
  -- Which moment in the order's life this message is about. Paired with
  -- order_id in the unique constraint below, this is what makes sending
  -- idempotent: an order can never be told twice that it was confirmed,
  -- however many times the status is set or a retry runs.
  event        text not null check (event in
                 ('placed','confirmed','out','arrived','completed','cancelled')),
  to_phone     text not null,
  lang         text not null default 'tet' check (lang in ('tet','pt','en')),
  -- The exact text that will be sent, rendered at queue time rather than at
  -- send time. If the store's name or a template changes tomorrow, a message
  -- queued today still says what the buyer was promised it would say.
  body         text not null,
  tracking_url text not null default '',
  channel      text not null default 'manual' check (channel in ('sms','manual')),
  provider     text not null default '',
  provider_ref text,
  status       text not null default 'queued'
                 check (status in ('queued','sent','failed','skipped')),
  error        text,
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  unique (order_id, event)
);
create index if not exists idx_notifications_status on notifications(status, created_at);
create index if not exists idx_notifications_order on notifications(order_id);

alter table notifications enable row level security;

-- No policy of any kind, deliberately.
--
-- Every row here holds a buyer's phone number next to a link that opens
-- their order. There is no version of "the public may read some of this"
-- that is safe, so there is no public policy to get subtly wrong later --
-- RLS with zero policies denies everyone. The admin pages reach this table
-- through the service-role client, which bypasses RLS entirely, the same
-- way orders are already handled.
revoke all on notifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Channel migration: WhatsApp -> SMS
--
-- An earlier version of this file allowed channel='whatsapp'. Order updates
-- now go to the buyer's phone as SMS instead, so the constraint has to be
-- replaced -- and any rows already carrying the old value moved across, or
-- the new constraint refuses to be added at all.
--
-- Written to be a no-op on a database that never saw the WhatsApp version,
-- so this file stays safe to run on a fresh project and on an existing one.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'notifications'::regclass
       and conname = 'notifications_channel_check'
  ) then
    alter table notifications drop constraint notifications_channel_check;
  end if;

  -- Historical rows: the message really was sent, it just went out over a
  -- channel this store no longer uses. Relabelled rather than deleted, so
  -- the record of what a buyer was told stays intact.
  update notifications set channel = 'sms' where channel = 'whatsapp';

  alter table notifications
    add constraint notifications_channel_check check (channel in ('sms','manual'));
end $$;
