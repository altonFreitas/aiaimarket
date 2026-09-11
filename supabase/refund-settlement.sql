-- ===========================================================================
-- Loja AIAI -- the database stops claiming a refund that has not happened
--
-- WHAT WAS WRONG. recordReturn() wrote a refund_total, restocked the goods
-- and let a trigger set orders.pay_status = 'refunded'. For cash, a bank
-- transfer or a wallet that is true: the person recording the return is the
-- same person handing the money back, at the same counter, in the same
-- minute.
--
-- For a CARD it is not true at all. Nothing in this application can move
-- money at the acquirer -- the PaymentProvider interface has createCheckout,
-- verifyWebhook, parseEvent and fetchStatus, and no refund. So the row said
-- the buyer had been refunded while their money was still with BNCTL, and
-- the only thing standing between that and a real complaint was somebody
-- remembering to open the gateway portal, with nothing anywhere prompting
-- them.
--
-- THE FIX IS TO BELIEVE refunded_at AND NOTHING ELSE. The column already
-- exists and already means "the money moved". This makes the trigger read
-- it, so a return whose money has not moved no longer rewrites the order's
-- payment status. The application stamps it immediately for the methods a
-- person settles by hand, and leaves it null for card until the owner says
-- otherwise (see markRefundSettled in src/lib/actions/returns.ts).
--
-- Safe to re-run. Run AFTER supabase/returns.sql.
-- ===========================================================================

create or replace function sync_order_refund_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o_id uuid;
  refunded numeric;
  order_total numeric;
begin
  o_id := coalesce(new.order_id, old.order_id);

  -- ONLY SETTLED REFUNDS COUNT. A return sitting with refunded_at null is a
  -- decision recorded, not money moved -- the goods may already be back on
  -- the shelf, and that is a separate fact the ledger keeps separately.
  select coalesce(sum(r.refund_total), 0) into refunded
    from order_returns r
   where r.order_id = o_id and r.refunded_at is not null;

  select o.total into order_total from orders o where o.id = o_id;

  update orders set pay_status = case
      when refunded <= 0 then pay_status
      -- Refunding everything is 'refunded'. Refunding part of it is still a
      -- deposit position: some money stayed with the shop.
      when refunded >= coalesce(order_total, 0) then 'refunded'
      else 'deposit'
    end
   where id = o_id;

  return null;
end $$;

-- The trigger itself is unchanged and already fires on insert, update and
-- delete -- which is what makes stamping refunded_at later re-run this and
-- move the order's status then.
drop trigger if exists trg_sync_order_refund on order_returns;
create trigger trg_sync_order_refund
  after insert or update or delete on order_returns
  for each row execute function sync_order_refund_status();

-- ---------------------------------------------------------------------------
-- The index behind the admin's "refunds not yet paid" list.
--
-- Partial, and narrow on purpose: the question is only ever "which returns
-- owe money that has not moved", which is a handful of rows in a table that
-- otherwise only grows. It is also what the schema-health panel probes for
-- to know this file has been run -- the trigger function above cannot serve
-- that purpose, because supabase/returns.sql creates one of the same name
-- and an owner who had run only that would be told they were up to date.
-- ---------------------------------------------------------------------------
create index if not exists order_returns_unsettled_idx
  on order_returns (created_at desc)
  where refunded_at is null and refund_total > 0;

comment on column order_returns.refunded_at is
  'When the money actually moved. Null means the refund is agreed and not yet paid -- which for a card order means nobody has done it at the gateway yet. Only settled returns move orders.pay_status.';

-- ---------------------------------------------------------------------------
-- Done. On a database where this has not been run, the old trigger still
-- counts every return as settled -- the behaviour being fixed -- and the
-- admin's "refunds to settle" list still shows the card returns that are
-- waiting, because that list reads refunded_at directly rather than
-- inferring it from pay_status.
-- ---------------------------------------------------------------------------

-- Same rule as the rest: a trigger function is nobody's to call directly.
revoke all on function sync_order_refund_status() from public, anon, authenticated;
