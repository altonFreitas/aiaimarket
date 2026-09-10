-- A ONE-TIME CODE THAT CAN ONLY BE USED ONCE.
--
-- Run AFTER supabase/schema.sql and supabase/admin-users.sql.
--
-- TOTP codes are valid for 30 seconds, and this app accepts a window of
-- one step either side -- so any given code is good for about 90 seconds.
-- Inside that window nothing stopped the same six digits being submitted
-- again. A code read over somebody's shoulder, left in a screenshot,
-- phished into a lookalike form, or replayed from a proxy was still a
-- working second login.
--
-- The fix is the one the RFC names: remember the last time step that was
-- accepted for an account, and refuse anything that is not strictly newer.
-- The counter is not a secret -- it is derived from the clock -- so it
-- needs no more protection than the columns beside it already have.
--
-- All three tables, because all three hold a TOTP secret and the
-- verification path in lib/totp.ts is written once and shared between
-- them (see TotpTarget).
alter table settings    add column if not exists totp_last_counter bigint;
alter table sellers     add column if not exists totp_last_counter bigint;
alter table admin_users add column if not exists totp_last_counter bigint;

-- Null means "no code has been accepted since this ran", which lets the
-- first login after the migration through and starts the chain. It does
-- NOT mean "accept anything twice": the very first success writes a
-- counter, and every later one is compared against it.
comment on column settings.totp_last_counter is
  'Last accepted TOTP time step. A code at or before this is a replay.';
