-- ---------------------------------------------------------------------------
-- What the customer saved, recorded on the order
-- ---------------------------------------------------------------------------
-- Run AFTER schema.sql. Safe to re-run.
--
-- The checkout shows a Discount line when a basket holds anything bought on
-- one. The invoice could not: nothing on the order said what the goods
-- would have cost at full price, so the document a customer keeps was
-- silently missing a line they had seen a minute earlier.
--
-- THE SUBTOTAL DOES NOT CHANGE. Line prices are, and always were, what is
-- actually charged -- the discounted figure -- so subtotal, tax and total
-- are unaffected by this column. It records the saving for its own sake,
-- the way a receipt does: "you paid 34, this is normally 45".
--
-- NOT NULL DEFAULT 0, because "no discount" and "we did not record one" are
-- the same thing on an order placed before this ran: nothing was taken off.
-- ---------------------------------------------------------------------------
alter table orders
  add column if not exists discount numeric(10,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_check') then
    -- A discount is never negative, and never more than the goods were
    -- worth: either would be arithmetic nobody can explain on an invoice.
    alter table orders add constraint orders_discount_check
      check (discount >= 0);
  end if;
end $$;

comment on column orders.discount is
  'What the buyer saved against the full price of the goods, at placement. Informational: subtotal and total are already net of it, because line prices are the discounted ones. Written by placeOrder() from the product rows, never from the basket.';
