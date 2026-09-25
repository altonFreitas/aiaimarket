-- ---------------------------------------------------------------------------
-- Draining the message queues from a cron, instead of from the request
-- ---------------------------------------------------------------------------
-- Run AFTER notifications.sql and customer-alerts.sql. Safe to re-run.
--
-- BOTH QUEUES ALREADY EXISTED. A message has always been written to the
-- database before anything is sent, precisely so a failed send leaves
-- something behind to act on. What was missing was anything that comes back
-- for it: the send happened inline, in the request that queued it, and a row
-- that failed sat there until a person noticed.
--
-- Two consequences, and the second is the expensive one:
--
--   1. In a serverless runtime a "fire and forget" send is forgotten. The
--      function can be frozen the moment the response is written, so the
--      send that was not awaited may simply never happen -- and the row says
--      `queued` for ever with nothing wrong anywhere.
--
--   2. queueProductAlerts sent to every opted-in customer IN THE SAVE. Five
--      hundred recipients meant five hundred sequential HTTP calls before
--      the shop's "add product" finished. The ceiling on recipients was
--      protecting the phone bill; nothing was protecting the save.
--
-- So the queues become real queues: the request writes rows and stops, and
-- /api/cron/send-queued claims a batch and sends it.
--
-- WHAT MAKES THIS SAFE TO RUN TWICE AT ONCE. Two overlapping cron runs
-- picking the same row would send the same SMS twice, which costs money and
-- annoys a customer. Claiming is therefore a single UPDATE with FOR UPDATE
-- SKIP LOCKED: whoever gets the row gets it, and the other run takes
-- different rows rather than waiting or duplicating.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. What a queue row needs to be claimable
-- ---------------------------------------------------------------------------
-- claimed_at does three jobs with one column, which is why there is no
-- 'sending' status to go with it:
--
--   * it marks a row as taken, so a concurrent run skips it;
--   * it expires that claim, so a run that dies mid-batch does not strand
--     its rows -- after the window they are simply claimable again;
--   * it spaces out retries. A failed row is not retried until its claim
--     ages out, which turns the same column into a backoff.
alter table notifications   add column if not exists claimed_at timestamptz;
alter table customer_alerts add column if not exists claimed_at timestamptz;

-- customer_alerts was written without one because an announcement was sent
-- once, inline, or not at all. Now that something comes back for it, it
-- needs to count -- otherwise a permanently failing number is retried for
-- ever, every few minutes, forever.
alter table customer_alerts add column if not exists attempts int not null default 0;

comment on column notifications.claimed_at is
  'When a drain run took this row. Null means free. An old claim is treated as free, so a crashed run strands nothing.';
comment on column customer_alerts.claimed_at is
  'When a drain run took this row. Null means free. An old claim is treated as free, so a crashed run strands nothing.';
comment on column customer_alerts.attempts is
  'How many times sending has been tried. Bounds retries: a number that never answers must not be dialled for ever.';

-- The index the claim query needs. Partial, because `sent` rows are most of
-- the table within a week and none of them are ever claimed.
create index if not exists notifications_claimable
  on notifications (created_at) where status in ('queued', 'failed');
create index if not exists customer_alerts_claimable
  on customer_alerts (created_at) where status in ('queued', 'failed');

-- ---------------------------------------------------------------------------
-- 2. Claiming a batch
-- ---------------------------------------------------------------------------
-- One function for both queues rather than two near-identical ones: the two
-- tables were deliberately given the same shape (see customer-alerts.sql),
-- and dispatchNotification() already sends from either. A second copy here
-- would be the third place the same logic lives.
--
-- p_queue IS NOT INTERPOLATED FROM THE CALLER. It is matched against a
-- literal allowlist and the matched literal is what reaches format(), so no
-- value of p_queue can name another table -- this function is SECURITY
-- DEFINER and would otherwise be a way to update anything.
create or replace function claim_queued_messages(
  p_queue        text,
  p_limit        int default 50,
  -- How long a claim is honoured before the row is considered abandoned,
  -- and therefore also how long a failed message waits before its next try.
  p_stale_minutes int default 15,
  p_max_attempts int default 3
)
returns table (id uuid, to_phone text, body text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 500);
begin
  v_table := case p_queue
               when 'notifications'   then 'notifications'
               when 'customer_alerts' then 'customer_alerts'
               else null
             end;
  if v_table is null then
    raise exception 'claim_queued_messages: unknown queue %', p_queue;
  end if;

  return query execute format($f$
    update %1$I q
       set claimed_at = now(),
           attempts   = q.attempts + 1
     where q.id in (
             select c.id from %1$I c
              where c.status in ('queued', 'failed')
                and c.attempts < $1
                and (c.claimed_at is null
                     or c.claimed_at < now() - make_interval(mins => $2))
              order by c.created_at
                for update skip locked
              limit $3)
    returning q.id, q.to_phone, q.body
  $f$, v_table)
  using greatest(coalesce(p_max_attempts, 3), 1),
        greatest(coalesce(p_stale_minutes, 15), 1),
        v_limit;
end $$;

comment on function claim_queued_messages is
  'Takes up to p_limit sendable rows from one of the two message queues, marking them claimed so a concurrent run takes different ones. The attempt counter is incremented HERE, by the claim, so a send that never reports back still counts against the limit.';

-- Only the service role drains queues. Both tables hold customers' phone
-- numbers beside what they were told, and this function returns exactly
-- that.
revoke all on function claim_queued_messages(text, int, int, int) from public, anon, authenticated;
