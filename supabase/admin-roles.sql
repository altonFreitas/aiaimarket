-- ===========================================================================
-- Loja AIAI -- what each staff account may do, and where it may go
--
-- Two columns on admin_users. They answer two different questions, and
-- keeping them separate is the point:
--
--   role      WHAT you may do anywhere you can go.
--             'admin'  -- change things.
--             'reader' -- look only. Every write in the application funnels
--                         through one function (requireAdmin, in
--                         src/lib/actions/guard.ts) and that function
--                         refuses a reader, so this is one lock rather than
--                         seventy.
--
--   sections  WHERE you may go at all: which parts of the admin open.
--             Keys from src/lib/adminSections.ts -- 'sales', 'catalog',
--             'procurement', 'sellers', 'storefront', 'settings'.
--
-- The two compose. A reader holding every section still cannot change a
-- price; an admin holding only 'procurement' can do anything inside
-- purchasing and cannot open Sales at all.
--
-- The owner (ADMIN_EMAIL / ADMIN_PASSWORD in the environment) has no row
-- here and is never filtered by either column. That is deliberate: it is
-- the login the shop is reachable through if anything on the Admin users
-- screen goes wrong.
--
-- Safe to re-run.
-- ===========================================================================

alter table admin_users
  add column if not exists role text not null default 'reader',
  add column if not exists sections text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Existing accounts keep what they already have
--
-- The DEFAULT above is the safe one -- a row created without anybody saying
-- what it may do gets the least privilege. But applying that default to
-- accounts that already exist would silently take away access somebody has
-- been using since before this file existed, which is a bug, not a security
-- improvement. They were created when every account was a full admin, so
-- that is what they are recorded as.
--
-- Only rows that predate the column: 'sections' is empty and the role is
-- still the default. Re-running this after somebody has been deliberately
-- set to a reader with no sections must not quietly promote them back, so
-- the update is bounded by created_at -- rows added from here on are
-- whatever the Admin users screen said, and are never touched again.
-- ---------------------------------------------------------------------------
do $$
declare
  backfilled int;
begin
  -- No-op on a second run: the column already exists, so the marker table
  -- below already exists too.
  if to_regclass('public.admin_users_roles_backfilled') is null then
    create table admin_users_roles_backfilled (at timestamptz not null default now());

    update admin_users
       set role = 'admin',
           sections = array['sales','catalog','procurement','sellers','storefront','settings']
     where sections = '{}';

    get diagnostics backfilled = row_count;
    raise notice 'admin-roles: % existing account(s) kept full access', backfilled;
  else
    raise notice 'admin-roles: backfill already done, leaving every account as it is';
  end if;
end $$;

comment on table admin_users_roles_backfilled is
  'Marker: the one-off backfill in supabase/admin-roles.sql has run. Do not drop -- dropping it and re-running the migration would hand full access back to every account that currently has none.';

-- ---------------------------------------------------------------------------
-- Constraints, added after the backfill so existing rows cannot fail them
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_users_role_check'
  ) then
    alter table admin_users
      add constraint admin_users_role_check check (role in ('admin', 'reader'));
  end if;
end $$;

-- A section key the application does not recognise is dropped when the row
-- is read (normalizeSections), so a bad value cannot grant anything. This
-- keeps them out of the table in the first place, where a typo would
-- otherwise sit looking like a granted permission on the screen.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_users_sections_check'
  ) then
    alter table admin_users
      add constraint admin_users_sections_check check (
        sections <@ array['sales','catalog','procurement','sellers','storefront','settings']::text[]
      );
  end if;
end $$;

comment on column admin_users.role is
  '''admin'' may change things; ''reader'' may only look. Enforced in requireAdmin(), src/lib/actions/guard.ts.';
comment on column admin_users.sections is
  'Which parts of the admin this account may open. Keys from src/lib/adminSections.ts. Home is always available and is not listed here.';

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing changes for anyone until you edit an account on
-- Settings -> Admin users. Accounts that already existed keep the full
-- access they had; new ones start as a reader with nothing ticked, and you
-- say what they get.
-- ---------------------------------------------------------------------------
