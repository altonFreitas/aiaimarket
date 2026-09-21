-- ===========================================================================
-- Loja AIAI -- the tax rate, to the precision the app already computes
--
-- Run AFTER supabase/legal-currency-tax.sql. Safe to re-run.
--
-- THE MISMATCH. normalizeTaxRate() in lib/money.ts keeps a percentage to
-- FOUR decimal places -- 7.1250% is stored as the fraction 0.071250 -- and
-- the columns it is stored in are numeric(6,4), which is four decimals of
-- the FRACTION and so only two of the percentage. Postgres does not refuse
-- the extra digits, it rounds them away silently: 0.071250 went in and
-- 0.0713 came back, and the shop was charging 7.13% while its settings page
-- said 7.125%.
--
-- Nobody would notice it on one order -- a ten-thousandth of a percent is
-- fractions of a cent -- and that is exactly the problem with it: it is a
-- figure the shop set, quietly changed, on every invoice, for as long as
-- the difference stays under a cent per order and above zero over a year of
-- them. A rate is not a number to round on the shop's behalf.
--
-- numeric(9,6) holds 0.071250 exactly, keeps the same range (the check
-- constraint still caps it at 1 = 100%), and needs no data migration: every
-- existing value is already a shorter number and widens losslessly.
--
-- WHAT THIS IS NOT. It does not change any money column. orders.tax,
-- orders.total and order_items.tax are numeric(10,2) and always were --
-- cents, exactly, in and out. The arithmetic above them rounds to the cent
-- and to nothing coarser; tests/tax.cents.test.ts holds that to it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The shop's own rate
-- ---------------------------------------------------------------------------
-- Guarded by the type rather than by a column-exists check: a shop that has
-- not run legal-currency-tax.sql has no such column, and `alter column` on
-- a missing one is an error rather than a no-op. Both files are in
-- run-all.sql in order, so this is belt and braces for a hand-run.
do $tax_rate_precision$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'settings'
       and column_name = 'tax_rate' and numeric_scale < 6
  ) then
    alter table settings alter column tax_rate type numeric(9,6);
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders'
       and column_name = 'tax_rate' and numeric_scale < 6
  ) then
    alter table orders alter column tax_rate type numeric(9,6);
  end if;
end
$tax_rate_precision$;

comment on column settings.tax_rate is
  'The shop''s tax rate as a FRACTION: 0.071250 is 7.125%. Six decimals, which is the four decimal places of a percentage that lib/money.ts normalizeTaxRate() keeps. Capped at 1 by the column check.';
comment on column orders.tax_rate is
  'The rate that produced orders.tax, captured so a later rate change cannot restate this order. Six decimals -- see settings.tax_rate.';

-- ---------------------------------------------------------------------------
-- 2. The same range, under a name that says this file has run
-- ---------------------------------------------------------------------------
-- A widened column looks exactly like a narrow one from the outside: the
-- schema inventory the admin's health panel reads reports tables, columns,
-- views, routines, indexes and constraints, and not a column's precision.
-- So this file would have been the one entry on that panel nobody could
-- ever tell the state of.
--
-- Renaming the check is the pattern admin-subsections.sql already uses for
-- the same reason. The RULE is unchanged -- a rate is still a fraction
-- between 0 and 1 -- only the name is, and the name is what can be seen.
--
-- legal-currency-tax.sql re-adds the old constraint whenever it is re-run,
-- and run-all.sql runs it first, so dropping it here every time is what
-- keeps one re-run from leaving two identical checks behind.
do $tax_rate_check_rename$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'settings'
                and column_name = 'tax_rate') then
    alter table settings drop constraint if exists settings_tax_rate_check;
    if not exists (select 1 from pg_constraint
                    where conname = 'settings_tax_rate_range_check') then
      alter table settings add constraint settings_tax_rate_range_check
        check (tax_rate >= 0 and tax_rate <= 1);
    end if;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'orders'
                and column_name = 'tax_rate') then
    alter table orders drop constraint if exists orders_tax_check;
    if not exists (select 1 from pg_constraint
                    where conname = 'orders_tax_range_check') then
      alter table orders add constraint orders_tax_range_check
        check (tax >= 0 and tax_rate >= 0 and tax_rate <= 1);
    end if;
  end if;
end
$tax_rate_check_rename$;

-- ---------------------------------------------------------------------------
-- Done. No data changes: every stored rate widens losslessly, and every
-- money column is untouched.
-- ---------------------------------------------------------------------------
