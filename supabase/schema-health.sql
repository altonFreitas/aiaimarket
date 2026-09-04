-- ===========================================================================
-- Loja AIAI -- letting the admin see which SQL files have been run
--
-- One read-only function listing the table and column names in the public
-- schema. The Settings screen compares that against what each file in this
-- folder provides, and shows you the ones still outstanding.
--
-- This exists because the shop has twice been broken by a file that had not
-- been run: staff could not sign in without admin-roles.sql, and no product
-- could be saved without audience-restock.sql. Both times the code was
-- fine, the database was fine, and nothing on any screen joined the two up.
--
-- NAMES ONLY. No data, no row counts, nothing about what is in the tables.
-- And granted to nobody -- the service role bypasses grants, and that is
-- the key the admin already holds, so the anon key cannot call it.
--
-- Safe to re-run. Run this one first if you are running several.
-- ===========================================================================

create or replace function schema_inventory()
returns table (table_name text, column_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.table_name::text, c.column_name::text
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name  = c.table_name
   where c.table_schema = 'public'
     and t.table_type = 'BASE TABLE';
$$;

comment on function schema_inventory is
  'Table and column NAMES in public, for the admin''s "which SQL still needs running" panel. No data. Service role only.';

revoke all on function schema_inventory() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done. Settings -> Database now lists every file in supabase/ and whether
-- it has been run.
-- ---------------------------------------------------------------------------
