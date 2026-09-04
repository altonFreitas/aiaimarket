-- ===========================================================================
-- Loja AIAI -- letting the admin see which SQL files have been run
--
-- One read-only function listing the NAMES of what is in the database. The
-- Settings screen compares that against what each file in this folder
-- provides, and shows you the ones still outstanding.
--
-- This exists because the shop has twice been broken by a file that had not
-- been run: staff could not sign in without admin-roles.sql, and no product
-- could be saved without audience-restock.sql. Both times the code was
-- fine, the database was fine, and nothing on any screen joined the two up.
--
-- WHY IT REPORTS MORE THAN TABLES NOW.
--
-- The first version of this function read information_schema.columns and
-- nothing else, so it could see tables and columns and could see nothing
-- else at all. Three of the files in this folder create no table and no
-- column, which made them invisible to it:
--
--   stock-ledger.sql          functions and a view -- the rule that
--                             products.qty only ever moves through
--                             stock_movements
--   harden-rls.sql            drops the policies that let anyone holding
--                             the public anon key insert orders and upload
--                             files straight past the app
--   patch-audit-hardening.sql indexes, and a tightened products read policy
--
-- The panel did not say "I have not checked these". It listed the files it
-- knew about, found them all present, and said EVERY SQL FILE HAS BEEN RUN
-- -- while never having looked at the two that close the open doors. That
-- is worse than no panel: an owner who reads it has been told the database
-- is finished.
--
-- So it now reports five kinds -- table, view, routine, policy, index --
-- and the feature list checks the objects that each file actually creates.
-- harden-rls.sql is the odd one: it REMOVES policies, so it is applied when
-- the named policies are ABSENT.
--
-- NAMES ONLY. No data, no row counts, no function bodies, nothing about
-- what is in the tables. And granted to nobody -- the service role bypasses
-- grants, and that is the key the admin already holds, so the anon key
-- cannot call it.
--
-- Safe to re-run. Run this one first if you are running several.
-- ===========================================================================

-- The return type changed when kinds were added, and `create or replace`
-- cannot change a function's return type -- it fails with "cannot change
-- return type of existing function". Dropping first is what makes this file
-- re-runnable on a database that has the older version installed.
drop function if exists schema_inventory();

create function schema_inventory()
returns table (kind text, object_name text, member_name text)
language sql
stable
security definer
set search_path = public
as $$
  -- Tables, one row per column.
  select 'table'::text, c.table_name::text, c.column_name::text
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name  = c.table_name
   where c.table_schema = 'public'
     and t.table_type = 'BASE TABLE'

  union all

  -- Views, by name. Their columns are not listed: nothing on the panel
  -- asks for one, and a view is either there or it is not.
  select 'view'::text, table_name::text, ''::text
    from information_schema.views
   where table_schema = 'public'

  union all

  -- Functions and procedures, by name. Never their bodies -- a body is
  -- source code, and this function exists to report shape, not content.
  select distinct 'routine'::text, p.proname::text, ''::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'

  union all

  -- Row-level security policies, schema-qualified: the ones harden-rls.sql
  -- drops are on storage.objects, not in public.
  select 'policy'::text, (schemaname || '.' || tablename)::text, policyname::text
    from pg_policies
   where schemaname in ('public', 'storage')

  union all

  select 'index'::text, (schemaname || '.' || tablename)::text, indexname::text
    from pg_indexes
   where schemaname in ('public', 'storage');
$$;

comment on function schema_inventory is
  'Names of tables, columns, views, functions, policies and indexes, for the admin''s "which SQL still needs running" panel. No data, no function bodies. Service role only.';

revoke all on function schema_inventory() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done. Settings -> Database now lists every file in supabase/ except
-- seed.sql, which is demo data and is not meant to be run on a real shop.
--
-- Until this file is re-run, the panel can still see tables and columns, so
-- it keeps reporting on those files -- and reports the three that create no
-- table as NOT CHECKED rather than guessing at them.
-- ---------------------------------------------------------------------------
