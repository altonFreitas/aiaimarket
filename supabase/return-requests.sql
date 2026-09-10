-- ===========================================================================
-- Loja AIAI -- a buyer can start a return
--
-- Run AFTER supabase/returns.sql.
--
-- Every return in this shop began with a phone call. The admin-side
-- machinery is all there and good -- over-return prevention, restock
-- straight into the ledger, a settlement queue that refuses to claim money
-- moved before it did -- and none of it could be reached by the person the
-- goods actually belong to. That is the largest remaining gap between this
-- and the platforms it competes with: not a missing feature, but that a
-- buyer cannot do anything on their own after they have paid.
--
-- A REQUEST IS NOT A RETURN. This table is deliberately separate from
-- order_returns rather than a status column on it, because the two are
-- different kinds of fact:
--
--   a request  is a buyer SAYING they want to send something back. It moves
--              no stock, refunds no money, and can be declined.
--   a return   is the shop RECORDING that goods came back. It writes to the
--              stock ledger and owes somebody money.
--
-- Folding them together would mean every existing reader of order_returns
-- -- the ledger trigger, the settlement queue, the refund arithmetic --
-- would have to learn to skip rows that are not really returns yet, and the
-- one that forgot would restock goods still sitting in a buyer's house.
--
-- Approving a request calls the SAME recordReturn() an admin has always
-- called. This adds a way in; it does not add a second way to do it.
--
-- Safe to re-run.
-- ===========================================================================

create table if not exists return_requests (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,

  -- RRQ + year + last four + six random, the same shape as an order
  -- reference so the two can be read out over the same phone call.
  ref          text not null unique,

  -- The same vocabulary order_returns uses. Not a superset and not a
  -- subset: a buyer and a shopkeeper describing the same parcel should
  -- reach for the same word, and approving a request copies this straight
  -- across.
  reason       text not null check (reason in
                 ('damaged','wrong_item','not_as_described','changed_mind','other')),
  note         text not null default '',

  status       text not null default 'open'
                 check (status in ('open','approved','declined','cancelled')),

  -- Why it was turned down, shown to the buyer on their tracking page. A
  -- decline with no reason is worse than no self-service at all: it teaches
  -- somebody that the button does nothing.
  decided_at   timestamptz,
  decided_by   text not null default '',
  decision_note text not null default '',

  -- The return this became, once approved. Null while open, and the link
  -- that lets the tracking page show what actually happened.
  return_id    uuid references order_returns(id) on delete set null,

  created_at   timestamptz not null default now()
);

create index if not exists return_requests_order_idx
  on return_requests (order_id, created_at desc);

-- The admin's "waiting on you" list, which is the only query that runs
-- often. Partial, because an answered request is history.
create index if not exists return_requests_open_idx
  on return_requests (created_at desc) where status = 'open';

-- ONE OPEN REQUEST PER ORDER. Without it, a buyer who taps twice on a slow
-- connection has two requests, an admin approves both, and the shop takes
-- back the same goods twice. The over-return check in recordReturn() would
-- catch the second one -- but it would catch it as an error message to an
-- admin, long after the confusion started.
create unique index if not exists return_requests_one_open_uq
  on return_requests (order_id) where status = 'open';

create table if not exists return_request_items (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references return_requests(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  -- Copied, not joined, for the same reason the order line is: a request
  -- has to stay readable after a product is deleted.
  product_name text not null default '',
  qty          int not null check (qty > 0)
);

create index if not exists return_request_items_request_idx
  on return_request_items (request_id);

comment on table return_requests is
  'A buyer asking to send something back. Not a return: it moves no stock and refunds nothing. Approving one calls recordReturn(). See supabase/return-requests.sql.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Reached only through server actions that have already proved ref + phone,
-- exactly like every other buyer-facing write in this shop. Nothing here is
-- readable with the anon key: a request names what somebody bought and how
-- much of it they are sending back.
alter table return_requests enable row level security;
alter table return_request_items enable row level security;
revoke all on return_requests from anon, authenticated;
revoke all on return_request_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Until this file is run, the buyer-facing form is not offered at all --
-- the action reports the table missing and the tracking page shows what it
-- always showed. Returns keep working; they just keep starting with a phone
-- call.
-- ---------------------------------------------------------------------------
