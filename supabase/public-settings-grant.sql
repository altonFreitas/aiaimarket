-- ---------------------------------------------------------------------------
-- The facts a shop publishes, readable by the pages that publish them
-- ---------------------------------------------------------------------------
-- Run AFTER legal-currency-tax.sql, which adds the columns this grants.
--
-- THE BUG THIS FIXES. An owner filled in the trading address, the business
-- registration and the return window in Settings, saved, and the Terms,
-- Privacy and Returns pages went on printing "{REGISTRATION — FILL IN}".
-- They set the currency to EUR and every price stayed in dollars. They set
-- the tax to 10% and nothing about tax appeared at checkout.
--
-- None of that was the app failing to read the settings. It was the
-- DATABASE refusing to hand them over.
--
-- schema.sql revokes select on settings from anon and grants back an
-- explicit list of columns -- which is right, and is what stops the public
-- key in the browser reading totp_secret. legal-currency-tax.sql then added
-- nine new columns and never added them to that list, so for the anon key
-- they did not exist. The storefront asked for the columns it was allowed
-- to ask for, got no legal or money facts back, and printed the unfilled
-- markers exactly as designed.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- WHY THESE NINE AND NOT select(*)
-- ---------------------------------------------------------------------------
-- Every column below is something the shop tells the public on purpose:
--
--   legal_address, legal_registration      printed on the Terms page
--   legal_retention_years                  printed on the Privacy page
--   legal_return_days, legal_refund_days   printed on the Returns page
--   display_currency                       the symbol beside every price
--   tax_rate, tax_label, tax_included      the tax line at checkout
--
-- A shopper is entitled to all nine BEFORE they buy -- that is what the
-- policy pages are for, and a tax added at the last step without having
-- been shown is the thing consumer law is most insistent about.
--
-- What stays out stays out: commission_rate is between the shop and its
-- sellers, and totp_secret is a credential. Those are read through the
-- service-role client, which bypasses these grants entirely.
-- ---------------------------------------------------------------------------
do $$
begin
  -- Column-by-column, and only for columns that exist: a database that
  -- somehow has not run legal-currency-tax.sql should skip the ones it
  -- lacks rather than fail the whole file and leave the rest ungranted.
  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'legal_address') then
    execute 'grant select (legal_address, legal_registration, legal_retention_years,
                           legal_return_days, legal_refund_days)
             on settings to anon, authenticated';
  end if;

  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'display_currency') then
    execute 'grant select (display_currency) on settings to anon, authenticated';
  end if;

  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'tax_rate') then
    execute 'grant select (tax_rate, tax_label, tax_included)
             on settings to anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A CATEGORY MAY CARRY ITS OWN TAX RATE
-- ---------------------------------------------------------------------------
-- Different goods are taxed differently -- that is the ordinary case in most
-- tax codes, not an exception. A shop selling both food and electronics
-- cannot describe itself with one number.
--
-- NULL means "use the shop's rate", and that is not the same as 0. A
-- category set to zero is a deliberate statement that these goods are not
-- taxed, and it has to survive somebody later raising the shop-wide rate.
-- Defaulting the column to 0 would have silently made every existing
-- category tax-exempt the moment this ran.
-- ---------------------------------------------------------------------------
alter table categories
  add column if not exists tax_rate numeric(6,4);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_tax_rate_check') then
    alter table categories add constraint categories_tax_rate_check
      check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1));
  end if;
end $$;

comment on column categories.tax_rate is
  'A FRACTION, not a percentage: 0.025 is 2.5%. NULL means this category is taxed at the shop-wide settings.tax_rate; 0 means it is deliberately untaxed. See lib/money.ts and lib/tax.ts.';

-- categories is already fully readable by anon (categories_public_read, and
-- no column grant narrows it), so the storefront can price a line without a
-- second privileged round trip.
