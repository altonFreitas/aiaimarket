-- ===========================================================================
-- Loja AIAI -- how long a product may sit before the shop is told
--
-- Run any time after supabase/schema.sql. Safe to re-run.
--
-- A shop's worst stock is not the stock it has run out of. That one is
-- loud: the shelf is empty, the orders stop, and the admin's to-do list
-- already shouts about it. It is the stock nobody has bought for two
-- months, which says nothing at all -- the money is spent, the shelf is
-- full, and the only sign is a number that never moves.
--
-- So the application looks for it, and this is the one thing it cannot
-- work out for itself: how long is too long. Thirty days suits a clothes
-- shop and would be absurd for furniture, so the shop says.
--
-- WHY A COLUMN AND NOT A CONSTANT. The same argument as
-- settings.restock_alert_pct and the reorder_*_days beside it: a threshold
-- somebody can change is a threshold they will keep looking at, and one
-- baked into the code is a threshold that gets ignored until it is
-- deleted. The default is here as well as in lib/stale.ts, because a row
-- written before this column existed has to read as something.
-- ===========================================================================

alter table settings
  add column if not exists stale_days int not null default 30;

do $stale_days_range$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_stale_days_check') then
    alter table settings add constraint settings_stale_days_check
      check (stale_days >= 1 and stale_days <= 365);
  end if;
end
$stale_days_range$;

comment on column settings.stale_days is
  'How many days a listed, in-stock product may go without a sale before the admin is told it may need a discount. A product that has never sold is measured from the day it was listed. 1-365; lib/stale.ts clamps to the same range.';

-- ---------------------------------------------------------------------------
-- Done. One column with a default, so every existing shop reads as 30 days
-- without being written to.
-- ---------------------------------------------------------------------------
