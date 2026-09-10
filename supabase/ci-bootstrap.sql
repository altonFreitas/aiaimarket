-- ===========================================================================
-- Loja AIAI -- what Supabase provides, for a bare Postgres in CI
--
-- NOT PART OF THE SCHEMA and never run against the real database. Supabase
-- creates all of this before a project's first migration; a plain
-- postgres:16 container does not, so run-all.sql cannot be applied to one
-- without it.
--
-- WHY BOTHER. Sixty-nine test files and, until now, not one that touched a
-- database. RLS plus column grants is the ENTIRE public data-security model
-- of this application -- the thing standing between the anon key that is in
-- every visitor's network tab and the orders table -- and nothing tested
-- it. The only way to test a policy is to run it.
--
-- This is deliberately the smallest possible stand-in. It is not an
-- emulation of Supabase and must not grow into one: everything here exists
-- because some file in supabase/ refers to it, and if a migration stops
-- referring to something, it should come back out.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The three roles every grant in this schema names
-- ---------------------------------------------------------------------------
-- anon           the key in every browser
-- authenticated  a signed-in Supabase Auth user (a seller, a customer)
-- service_role   the server-side key, which bypasses RLS
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- SUPABASE'S DEFAULT PRIVILEGES, reproduced exactly -- because they are the
-- reason harden-rls.sql and every `revoke` in this schema exist. A CI
-- database that did NOT grant these would make those files look unnecessary
-- and let a regression through: the test would pass because the grant was
-- never there, not because the revoke worked.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------
-- sellers.user_id and customers.user_id reference auth.users, and several
-- policies call auth.uid(). Both are Supabase's, and both are small enough
-- to stand in for honestly.
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

/* auth.uid() reads a claim out of a request-local GUC. Supabase sets it
 * from the JWT; a test sets it directly, which is what lets a test say
 * "now be this seller" without minting a token. */
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- ---------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------
-- schema.sql creates buckets and policies on storage.objects; harden-rls.sql
-- drops two of those policies by name. Neither can run without the table.
create schema if not exists storage;

create table if not exists storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id       uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name     text,
  owner    uuid
);

alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Extensions the schema uses
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- the "did you mean" search
create extension if not exists unaccent;   -- accent-folded full-text search
