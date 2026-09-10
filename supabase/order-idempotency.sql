-- ===========================================================================
-- Loja AIAI -- one submission, one order
--
-- THE PROBLEM. placeOrder()'s only protection against a double submission
-- was setBusy(true) in the browser. On a slow or flaky mobile connection --
-- which is the operating assumption of this entire project -- a retried or
-- replayed request created a second complete order: duplicate stock
-- movements when it was confirmed, a duplicate SMS charge, a confused
-- buyer, and a manual cleanup.
--
-- The payment layer already gets this exactly right (payments.idempotency_key
-- with a partial unique index guaranteeing one live attempt per order). The
-- order layer was not given the same treatment. This is that treatment.
--
-- Safe to re-run.
-- ===========================================================================

alter table orders
  add column if not exists idempotency_key text;

comment on column orders.idempotency_key is
  'One per checkout attempt, minted in the browser. A retry of the same attempt returns the original order rather than creating a second. See src/lib/actions/orders.ts.';

-- ---------------------------------------------------------------------------
-- PARTIAL, so the column stays optional.
--
-- Every order placed before this file existed has a null key, and null is
-- not equal to null in a unique index -- but a partial index is clearer
-- about the intent than relying on that, and it keeps the index the size of
-- the orders that actually carry one.
--
-- This is what makes the guard real rather than advisory: two identical
-- submissions racing each other do not both check-then-insert, they both
-- insert and Postgres refuses the second. The application then reads back
-- the first one's reference and hands it to the buyer, who cannot tell that
-- anything happened -- which is the whole point.
-- ---------------------------------------------------------------------------
create unique index if not exists orders_idempotency_key_uq
  on orders (idempotency_key) where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Done. Until this file is run the column is absent, the application drops
-- it from the insert (writeTolerating), and duplicate protection is what it
-- has always been -- a button that disables itself.
-- ---------------------------------------------------------------------------
