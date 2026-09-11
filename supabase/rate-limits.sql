-- ===========================================================================
-- Loja AIAI -- throttles that actually bind
--
-- THE PROBLEM. lib/rateLimit.ts counted attempts in a Map inside one
-- serverless instance, and said so in its own header: "a determined
-- attacker spread across many cold starts sees a higher effective ceiling."
-- On Vercel, concurrent requests land on different instances and the
-- ATTACKER chooses the concurrency -- so every limit in the application was
-- advisory. That covers admin password guessing, order placement, payment
-- session creation, review spam, and getOrdersByPhone, which returns a
-- customer's name, order totals and status for a phone number with no other
-- credential.
--
-- One small table and one function fix all of them without changing a
-- single call site's intent.
--
-- WHY NOT REDIS. Because this needs no new vendor, no new secret, no new
-- failure mode to learn, and at this traffic level an UPSERT on a
-- primary-keyed row is not the bottleneck -- the scrypt verification it
-- protects costs orders of magnitude more.
--
-- Safe to re-run.
-- ===========================================================================

create table if not exists rate_limits (
  -- "admin-login:203.0.113.7" -- built by callerKey(), never by a caller.
  key        text primary key,
  count      int not null default 0,
  -- When this window ends. A FIXED window, not a sliding one: a sliding
  -- window needs a row per attempt, and the extra precision buys nothing
  -- against the thing being defended (a password guessed at machine speed).
  reset_at   timestamptz not null
);

-- The sweep below deletes by this. Without it, a table that only ever grows
-- is the cost of a feature that exists to stop things growing.
create index if not exists idx_rate_limits_reset on rate_limits (reset_at);

comment on table rate_limits is
  'Fixed-window request counters, shared across serverless instances. Written only by hit_rate_limit(). See src/lib/rateLimit.ts.';

-- ---------------------------------------------------------------------------
-- One statement, one row lock, no read-then-write.
--
-- The UPSERT is what makes this correct under concurrency: two requests
-- arriving at the same instant serialise on the primary key rather than
-- both reading the same count and both deciding they are under the limit.
-- That race is the entire reason the in-memory version could not simply be
-- pointed at a table.
--
-- SECURITY DEFINER for the same reason increment_views is: the table must
-- not be writable by anyone holding the anon key, and this function is the
-- only thing that should ever touch it.
-- ---------------------------------------------------------------------------
create or replace function hit_rate_limit(
  p_key text, p_limit int, p_window_seconds int
) returns table (allowed boolean, remaining int, retry_after int)
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_reset timestamptz;
begin
  insert into rate_limits (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    -- An expired window is a NEW window, not a continuation of the old one.
    count = case when rate_limits.reset_at <= now() then 1
                 else rate_limits.count + 1 end,
    reset_at = case when rate_limits.reset_at <= now()
                    then now() + make_interval(secs => p_window_seconds)
                    else rate_limits.reset_at end
  returning rate_limits.count, rate_limits.reset_at into v_count, v_reset;

  -- Occasionally, and cheaply. A scheduled job would be a second thing to
  -- deploy and forget; one delete in every hundred calls keeps the table
  -- the size of the traffic actually in flight.
  if random() < 0.01 then
    delete from rate_limits where reset_at < now() - interval '1 hour';
  end if;

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    case when v_count <= p_limit then 0
         else greatest(1, ceil(extract(epoch from (v_reset - now())))::int)
    end;
end;
$$;

alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;
revoke all on function hit_rate_limit(text, int, int) from public, anon, authenticated;
-- Only the service role, which is the only thing that ever calls it: a
-- visitor able to run this could burn somebody else's allowance by naming
-- their key, which is a denial-of-service dressed as a rate limit.

-- ---------------------------------------------------------------------------
-- Done.
--
-- Until this file is run, lib/rateLimit.ts falls back to the in-memory
-- counter it has always used -- so the shop keeps working and the limits
-- keep being per-instance, which is exactly where it was. Running it makes
-- them global with no code change.
-- ---------------------------------------------------------------------------
