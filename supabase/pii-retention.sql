-- KEEPING THE ACCOUNTS, FORGETTING THE PERSON.
--
-- Run AFTER supabase/schema.sql. Optional -- nothing in the application
-- calls this. It exists so a retention policy is something the shop can
-- actually carry out rather than only a sentence on a page.
--
-- The privacy policy (src/lib/legal.ts) already says order records are
-- kept for "{RETENTION YEARS}" and then deleted, and the number is left
-- FILL IN on purpose: how long an invoice must be retained is a question
-- for the shop's accountant and its jurisdiction, not for this file.
-- What was missing is any way to honour it. Names, phone numbers and
-- delivery addresses sat in `orders` forever.
--
-- REDACTION, NOT DELETION. An order is a financial record: the totals,
-- the commission, the stock movements and the payouts derived from it all
-- have to keep adding up, and deleting rows would silently rewrite every
-- historical report. So the row stays and the person is removed from it.
-- Afterwards the shop can still answer "what did we sell in 2026" and can
-- no longer answer "who bought it", which is the whole point.
--
-- WHAT IT WILL NOT TOUCH:
--   * anything still open. Only completed and cancelled orders, because a
--     live order needs its buyer's phone to be delivered.
--   * anything inside the window. p_years is required and has no default:
--     a retention sweep with a default is a retention sweep somebody runs
--     by accident.
--   * a row already redacted, so running it twice is not a second event.
--
-- HOW TO USE IT. Count first, and read the number before doing anything:
--
--   select count(*) from orders
--    where status in ('completed','cancelled')
--      and created_at < now() - interval '7 years'
--      and buyer_phone <> '';
--
--   select redact_old_order_pii(7);
--
-- THERE IS NO UNDO. That is why it is a function an operator runs
-- deliberately in the SQL editor and not a button in the admin -- a
-- one-click irreversible sweep over years of customer records is a
-- mis-click waiting to happen, and no confirmation dialog has ever
-- stopped one.

create or replace function redact_old_order_pii(p_years int)
returns table (redacted bigint, oldest_kept timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz;
  v_count  bigint;
begin
  if p_years is null or p_years < 1 then
    raise exception 'redact_old_order_pii: p_years must be at least 1 (got %)', p_years;
  end if;
  v_cutoff := now() - make_interval(years => p_years);

  -- The proof image is deliberately NOT deleted from storage here:
  -- removing a file is a different system's job and a half-done sweep
  -- that has forgotten the row but kept the file is worse than either.
  -- The pointers go, so nothing in the database can reach it, and the
  -- bucket is swept separately.
  update orders set
    buyer_name   = 'redacted',
    buyer_phone  = '',
    address_line = null,
    municipality = null,
    post         = null,
    suku         = null,
    aldeia       = null,
    landmark     = null,
    note         = '',
    proof_url    = null
  where status in ('completed', 'cancelled')
    and created_at < v_cutoff
    -- Already redacted rows are left alone, so this is idempotent and a
    -- second run reports 0 rather than re-reporting the first run's work.
    and buyer_phone <> '';
  get diagnostics v_count = row_count;

  -- The internal log is free text staff typed, and it routinely repeats
  -- the buyer's name and phone ("called Maria, no answer"). Redacting the
  -- columns and leaving the log behind would be redacting nothing.
  delete from order_log
   where order_id in (
     select id from orders
      where status in ('completed', 'cancelled') and created_at < v_cutoff
   );

  return query
    select v_count,
           (select min(created_at) from orders where buyer_phone <> '');
end $$;

-- BOTH `public` AND the two roles by name. Revoking from one is not
-- enough and looks exactly like it is: `revoke ... from anon` leaves
-- PUBLIC's grant, which anon inherits, and `revoke ... from public`
-- leaves the direct grant Supabase's default privileges hand to anon at
-- creation time. Either revoke on its own reads as done and closes
-- nothing. Found by tests/rls/rls.test.ts, which calls each of these as
-- anon and expects to be refused.
revoke all on function redact_old_order_pii(int) from public, anon, authenticated;

comment on function redact_old_order_pii(int) is
  'Removes buyer name, phone, address and notes from closed orders older than p_years, keeping the financial record. No undo.';
