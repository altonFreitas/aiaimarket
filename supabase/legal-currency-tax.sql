-- ---------------------------------------------------------------------------
-- The shop's own legal facts, a display currency, and tax on an order
-- ---------------------------------------------------------------------------
-- Three things that look unrelated and are the same kind of change: values
-- the SHOP must state, which the application had been hardcoding, guessing
-- or leaving as a marker on a public page.
--
-- Safe to re-run. Every statement is add-if-missing.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The five facts the policy pages could not know
-- ---------------------------------------------------------------------------
-- terms, privacy and returns carried FILL IN markers, live, on the public
-- site. They are not text somebody forgot to write: they are facts about
-- THIS business that no author could supply -- where it trades from, what it
-- is registered as, and the three periods it chooses to commit to.
--
-- So they become settings. The owner states them once, the policies read
-- them, and the "this policy is a draft" notice keeps showing until they
-- have. Filling a number in for them would have been the one genuinely
-- dangerous option: a policy that states a refund window the shop never
-- agreed to is a promise it did not make.
alter table settings
  add column if not exists legal_address          text not null default '',
  add column if not exists legal_registration     text not null default '',
  add column if not exists legal_retention_years  int,
  add column if not exists legal_return_days      int,
  add column if not exists legal_refund_days      int;

comment on column settings.legal_address is
  'Trading address, as it should appear on the terms page. Empty means the page still shows its unfinished-policy notice.';
comment on column settings.legal_registration is
  'Business registration as the shop is registered, for the terms page.';
comment on column settings.legal_retention_years is
  'How many years order records are kept before deletion. Null means not yet decided.';
comment on column settings.legal_return_days is
  'Days after delivery within which a buyer may ask to return. Null means not yet decided.';
comment on column settings.legal_refund_days is
  'Days after the goods come back within which the refund is made. Null means not yet decided.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_legal_periods_check') then
    alter table settings add constraint settings_legal_periods_check check (
      (legal_retention_years is null or legal_retention_years between 1 and 99) and
      (legal_return_days     is null or legal_return_days     between 1 and 365) and
      (legal_refund_days     is null or legal_refund_days     between 1 and 365));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A display currency
-- ---------------------------------------------------------------------------
-- Timor-Leste uses the US dollar, which is why money() could hardcode a "$"
-- and get away with it. It is still the default and nothing changes for a
-- shop that leaves it alone.
--
-- What it buys is the ability to be wrong later rather than now: a shop that
-- starts quoting in AUD or IDR needs the rate CAPTURED ON THE ORDER, the way
-- purchase orders have always captured fx_rate, or every historical total
-- silently restates itself the day the rate moves. That is the part that
-- cannot be retrofitted, so it goes in while there are few orders to carry.
alter table settings
  add column if not exists display_currency text not null default 'USD';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_display_currency_check') then
    alter table settings add constraint settings_display_currency_check
      check (display_currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column settings.display_currency is
  'Three-letter code the storefront quotes in. USD for Timor-Leste, which is the default and needs no rate.';

alter table orders
  -- What the shop was quoting when this order was placed, and what one unit
  -- of it was worth in USD at that moment. Both frozen: an order is a record
  -- of an agreement, and an agreement does not move when a rate does.
  add column if not exists currency text not null default 'USD',
  add column if not exists fx_rate  numeric(14,6) not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_currency_check') then
    alter table orders add constraint orders_currency_check
      check (currency ~ '^[A-Z]{3}$' and fx_rate > 0);
  end if;
end $$;

comment on column orders.currency is
  'The currency this order was quoted and agreed in. Frozen at placement.';
comment on column orders.fx_rate is
  'USD per one unit of currency, captured at placement. 1 for USD. Frozen: restating history when a rate moves would rewrite what was agreed.';

-- ---------------------------------------------------------------------------
-- 3. Tax
-- ---------------------------------------------------------------------------
-- Orders carried subtotal, fee and total and nothing between them, so a shop
-- that has to charge tax had nowhere to put it and no way to tell a buyer
-- what they had paid it on.
--
-- ON THE ORDER **AND** ON THE LINE. The order-level figure is what the buyer
-- is charged and what reconciles against a payment. The per-line figure is
-- what any return has to give back -- refunding a line at its net price
-- quietly keeps the tax on goods the shop no longer sold, which is both
-- wrong and the kind of wrong nobody notices for a year.
--
-- The RATE is stored beside the amount, not looked up when a screen renders:
-- a rate that changes must not silently restate what was charged in March.
alter table settings
  add column if not exists tax_rate    numeric(6,4) not null default 0,
  add column if not exists tax_label   text not null default '',
  add column if not exists tax_included boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_tax_rate_check') then
    alter table settings add constraint settings_tax_rate_check
      check (tax_rate >= 0 and tax_rate <= 1);
  end if;
end $$;

comment on column settings.tax_rate is
  'Fraction, not a percentage: 0.025 is 2.5%. Zero means this shop charges none, which is the default.';
comment on column settings.tax_label is
  'What the shop calls it on an invoice -- "Sales tax", "IVA". Empty falls back to a generic word.';
comment on column settings.tax_included is
  'true when shelf prices already contain the tax, so it is shown as "of which" rather than added on.';

alter table orders
  add column if not exists tax      numeric(10,2) not null default 0,
  add column if not exists tax_rate numeric(6,4)  not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_tax_check') then
    alter table orders add constraint orders_tax_check
      check (tax >= 0 and tax_rate >= 0 and tax_rate <= 1);
  end if;
end $$;

comment on column orders.tax is
  'Tax charged on this order, in the order currency. Frozen at placement.';
comment on column orders.tax_rate is
  'The rate that produced it, captured so a later rate change cannot restate this order.';

alter table order_items
  add column if not exists tax numeric(10,2) not null default 0;

comment on column order_items.tax is
  'This line''s share of the order tax. What a return of this line has to give back -- refunding the net price alone keeps tax on goods no longer sold.';

-- ---------------------------------------------------------------------------
-- 4. The line's tax reaches order_items
-- ---------------------------------------------------------------------------
-- order_items is built by a trigger from the order's `items` jsonb, so a
-- per-line figure the application computes has to travel in that jsonb and be
-- copied across here. This is supabase/order-items.sql's function with ONE
-- column added -- and it is written out in full because Postgres has no way
-- to add a column to an existing function's insert.
--
-- IF YOU CHANGE order-items.sql, CHANGE THIS TOO. That sentence is in
-- audience-restock.sql as well, where it was ignored and a copy quietly lost
-- a line, which is why tests/schemaHealth.test.ts now fails a replacement
-- that stops writing a column the original wrote.
create or replace function sync_order_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into order_items (
    order_id, product_id, seller_id, name, size, qty,
    unit_price, cost, commission_rate, tax, created_at
  )
  select new.id,
         /* AN UNKNOWN REFERENCE IS NULLED, NOT USED TO DROP THE LINE.
          *
          * The previous version excluded the row when the seller or product
          * did not exist, under a comment saying "the line is worth more
          * than the attribution" -- which is what it MEANT and the opposite
          * of what it did. The order still inserted, and the line vanished
          * from order_items: invisible to seller earnings, to per-line
          * fulfilment, and to every analytics screen, while the buyer's own
          * order still showed it.
          *
          * It is reachable. products has NO foreign key to sellers, so a
          * product can carry the id of a deleted seller indefinitely, and
          * every order for that product would silently lose its line.
          *
          * Nulling keeps the line and drops only the attribution, which is
          * also exactly what the ON DELETE SET NULL on both columns does
          * when the row disappears later. Same end state, whichever order
          * things happen in. */
         (select p.id from products p where p.id = nullif(i->>'product_id', '')::uuid),
         (select s.id from sellers  s where s.id = nullif(i->>'seller_id',  '')::uuid),
         coalesce(i->>'name', ''),
         coalesce(i->>'size', ''),
         (i->>'qty')::int,
         (i->>'price')::numeric,
         nullif(i->>'cost', '')::numeric,
         nullif(i->>'commission_rate', '')::numeric,
         -- Absent on every order placed before this ran, which is correct:
         -- they were not taxed.
         coalesce(nullif(i->>'tax', '')::numeric, 0),
         new.created_at
    from jsonb_array_elements(new.items) i
   where coalesce((i->>'qty')::int, 0) > 0
  on conflict do nothing;

  return null;
end $$;

comment on function sync_order_items is
  'Builds order_items rows from the order''s items jsonb, including each line''s share of the tax. The ONLY writer of order_items at placement.';
