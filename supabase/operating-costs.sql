-- ===========================================================================
-- Loja AIAI -- what it costs to run the shop
--
-- Run AFTER supabase/schema.sql. Safe to re-run.
--
-- WHAT WAS MISSING. Every number in this application was about MERCHANDISE:
-- what was sold, what it cost to buy, what margin that left. None of it knew
-- that the shop also pays for Supabase, a domain, Vercel, a licence, and the
-- bank's cut of every card payment. So "gross margin 38%" was true and
-- useless -- the owner could not answer the only question that decides
-- whether the business works: after everything, how much is left?
--
-- TWO TABLES, AND THE SPLIT BETWEEN THEM IS THE WHOLE DESIGN.
--
--   operating_expenses   money that HAS been spent. One row, one payment.
--   recurring_expenses   a TEMPLATE: "Supabase bills $25 on the 1st".
--
-- A template is not a cost. Nothing from recurring_expenses reaches the
-- profit and loss until somebody confirms the payment actually happened and
-- a row lands in operating_expenses. That is deliberate and it is the
-- difference between bookkeeping and guessing: a subscription that was
-- cancelled, failed, or was billed at a different price would otherwise sit
-- in the accounts forever as a cost that never occurred, and the owner would
-- be making decisions on a number nobody ever checked.
--
-- The finance screen reads the templates to say WHAT IS DUE. The owner
-- confirms it in one click. That click is what writes the expense.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The chart of accounts
-- ---------------------------------------------------------------------------
-- A CONTROLLED VOCABULARY, not free text. The point of an account is that
-- next year's total is comparable with this year's, and a free-text field
-- becomes "Hosting", "hosting", "Server", "supabase" inside six months --
-- four rows in a report that should be one.
--
-- Kept deliberately short. A chart of accounts with sixty lines is one
-- nobody files against correctly; these are the ones a small online shop
-- actually pays for, and `other` is the honest escape hatch rather than an
-- invitation to avoid choosing.
--
-- Mirrored in src/lib/accounts.ts, which carries the translations. A test
-- holds the two lists to each other, so an account added in one place and
-- not the other fails rather than rendering as a raw key -- which is exactly
-- how the delivery zones ended up showing "zone_z1" to shoppers.
create or replace function is_expense_account(p text) returns boolean
language sql immutable as $$
  select p in (
    'hosting',       -- Supabase, Vercel, object storage
    'software',      -- licences and subscriptions that are not hosting
    'domain',        -- the domain name and its DNS
    'bank_fees',     -- the acquirer's cut, transfer fees, gateway monthly
    'marketing',     -- advertising, promotions, printing
    'staff',         -- wages, contractors
    'premises',      -- rent, electricity, water, internet
    'transport',     -- couriers, fuel, vehicle costs
    'professional',  -- accountant, lawyer, translator
    'tax',           -- licences, duties, income tax paid
    'equipment',     -- phones, laptops, a printer
    'other'
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Money that has actually been spent
-- ---------------------------------------------------------------------------
create table if not exists operating_expenses (
  id           uuid primary key default gen_random_uuid(),

  account      text not null check (is_expense_account(account)),
  -- Who it was paid to. Free text ON PURPOSE, unlike the account: the shop
  -- cannot know in advance that it will one day pay Cloudflare. This is what
  -- answers "what am I paying Supabase" inside the hosting total.
  vendor       text not null default '',
  description  text not null default '',

  -- WHAT WAS PAID, in the currency it was paid in.
  amount       numeric(14,2) not null check (amount > 0),
  currency     text not null default 'USD',
  -- Multiply by this for USD. Captured at the moment of payment for exactly
  -- the same reason purchase_orders.fx_rate is: a cost recorded in euros and
  -- re-converted at today's rate would make last year's profit move every
  -- time the exchange rate does.
  fx_rate      numeric(14,6) not null default 1 check (fx_rate > 0),
  -- Derived, so no reader can forget to convert and no two readers can
  -- convert differently.
  amount_usd   numeric(14,2) generated always as (round(amount * fx_rate, 2)) stored,

  -- WHEN. incurred_on is the date the money left, and is what the profit and
  -- loss groups by.
  incurred_on  date not null default current_date,

  -- WHAT PERIOD IT COVERS, for a subscription. A year of hosting paid in
  -- January is one payment and twelve months of service; without these the
  -- January profit looks terrible and the other eleven look better than they
  -- are. Null for a one-off purchase, which is most of them.
  period_start date,
  period_end   date,
  constraint operating_expenses_period_order
    check (period_end is null or period_start is null or period_end >= period_start),

  -- The template this came from, when it came from one. Null for an ad-hoc
  -- cost. SET NULL rather than CASCADE: deleting the "Supabase" template
  -- must not delete the record of having paid Supabase for two years.
  recurring_id uuid,

  note         text not null default '',
  created_by   text not null default '',
  created_at   timestamptz not null default now()
);

-- The profit and loss groups by month and by account, and that is nearly
-- every read this table gets.
create index if not exists operating_expenses_date_idx
  on operating_expenses (incurred_on desc);
create index if not exists operating_expenses_account_idx
  on operating_expenses (account, incurred_on desc);

comment on table operating_expenses is
  'One row per payment the shop has actually made. Costs of RUNNING the business, not of the goods it sells -- those live in product_costs and purchase_orders. See supabase/operating-costs.sql.';

-- ---------------------------------------------------------------------------
-- 3. The things that bill again next month
-- ---------------------------------------------------------------------------
create table if not exists recurring_expenses (
  id           uuid primary key default gen_random_uuid(),

  account      text not null check (is_expense_account(account)),
  vendor       text not null,
  description  text not null default '',

  amount       numeric(14,2) not null check (amount > 0),
  currency     text not null default 'USD',
  fx_rate      numeric(14,6) not null default 1 check (fx_rate > 0),

  cadence      text not null check (cadence in ('monthly','quarterly','yearly')),

  -- 1 to 28, so February never needs a special case and a bill due on the
  -- 31st does not silently skip the short months.
  day_of_month int not null default 1 check (day_of_month between 1 and 28),

  started_on   date not null default current_date,
  -- Null while it is still billing. Set when the subscription is cancelled,
  -- rather than deleting the row: the history of having paid for it is worth
  -- more than the tidiness.
  ended_on     date,

  note         text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists recurring_expenses_active_idx
  on recurring_expenses (vendor) where ended_on is null;

comment on table recurring_expenses is
  'A template: what bills again, and when. NOT a cost -- nothing here reaches the profit and loss until a payment is confirmed and an operating_expenses row is written.';

-- Added after both tables exist, so the file can be run against a database
-- that has neither.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'operating_expenses_recurring_fk'
  ) then
    alter table operating_expenses
      add constraint operating_expenses_recurring_fk
      foreign key (recurring_id) references recurring_expenses(id) on delete set null;
  end if;
end $$;

-- ONE CONFIRMATION PER TEMPLATE PER PERIOD. Without it, two clicks on a slow
-- connection record the Supabase bill twice and the month's costs are wrong
-- by $25 with nothing to say why. period_start is the period key, which is
-- why confirming a recurring cost always sets it.
create unique index if not exists operating_expenses_recurring_period_uq
  on operating_expenses (recurring_id, period_start)
  where recurring_id is not null and period_start is not null;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- What a business pays its suppliers, its staff and its bank is the most
-- commercially sensitive data in the application -- more so than margin,
-- which can at least be guessed from prices. Nothing public reads it; every
-- reader goes through the service role behind an admin session.
alter table operating_expenses enable row level security;
alter table recurring_expenses enable row level security;
revoke all on operating_expenses from anon, authenticated;
revoke all on recurring_expenses from anon, authenticated;
revoke all on function is_expense_account(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Until this file is run, the finance screen reports that the tables are
-- missing and says which file to run -- rather than showing a profit of zero,
-- which would be a number the owner might believe.
-- ---------------------------------------------------------------------------
