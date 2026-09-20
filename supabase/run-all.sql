-- =========================================================================
-- Loja AIAI -- every migration, in order. GENERATED, do not edit.
--
--   node scripts/build-run-all.js
--
-- Paste the whole thing into the Supabase SQL editor and press Run. Every
-- file in here is safe to re-run, so this is also how you catch a database
-- up after adding features -- not only how you create one.
--
-- The order is SCHEMA_ORDER in src/lib/schemaHealth.ts, which a test keeps
-- honest against the folder and against every "Run AFTER" a file states.
-- =========================================================================


-- ==== schema.sql ========================================================

-- ============================================================
-- AIAI STORE TIMOR-LESTE — schema for "Marketplace Platform for Timor-Leste v1.0"
-- Run this once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- settings (Epic A3, single row for the single seller) ----------
create table if not exists settings (
  id            int primary key default 1,
  seller_id     uuid not null default gen_random_uuid(),   -- Decision 2: present from day one
  store_name    text not null default 'AIAI STORE TIMOR-LESTE',
  tagline_tet   text default '',
  tagline_pt    text default '',
  tagline_en    text default '',
  wa_number     text not null default '',                  -- +670 format
  hours         text default '',
  municipality  text default '',
  post          text default '',
  suku          text default '',
  landmark      text default '',
  pickup        boolean not null default true,
  -- Marketplace commission (Phase 2): the platform's default cut of a
  -- sale, as a percentage (10 = 10%). A seller can have their own
  -- commission_rate (see the sellers table) which overrides this when
  -- set; this is just the fallback used for everyone else.
  commission_rate numeric(5,2) not null default 10,
  -- Marketplace on/off switch: when false, /seller/register shows a
  -- "not accepting sellers right now" message instead of the form, the
  -- action itself refuses to create new accounts (never just hidden in
  -- the UI), and the footer's "Become a Seller" link disappears.
  -- Existing approved sellers keep working either way -- this only
  -- gates new applications.
  seller_registration_enabled boolean not null default true,
  banks         jsonb not null default '[]',   -- [{label,account,holder}]
  wallets       jsonb not null default '[]',   -- [{label,number}]
  zones         jsonb not null default '[{"id":"dili_center","fee":1,"quote":false},{"id":"dili_outskirts","fee":2,"quote":false},{"id":"other_municipality","fee":0,"quote":true}]',
  -- Two-factor auth (TOTP, authenticator-app based). totp_secret is only
  -- ever read/written server-side via the service-role client — never
  -- exposed to the browser. If you lose your authenticator device, reset
  -- 2FA by running: update settings set totp_secret=null, totp_enabled=false where id=1;
  totp_secret          text,
  totp_enabled         boolean not null default false,
  totp_failed_attempts int not null default 0,
  totp_locked_until    timestamptz,
                -- [{id,fee,quote}] — id is one of the 3 fixed zones; the
                -- display name is translated client-side from id (i18n.ts),
                -- not stored here, so it renders correctly in every language
  updated_at    timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;
-- ALTER form for the existing settings row (see the products.status
-- comment above for why this is needed alongside the column in the
-- CREATE TABLE above).
alter table settings add column if not exists commission_rate numeric(5,2) not null default 10;
alter table settings add column if not exists seller_registration_enabled boolean not null default true;

-- Function-based default, not a raw subquery: Postgres allows a function
-- call in DEFAULT (evaluated per-row at insert time), just not inline SELECT.
create or replace function current_seller_id() returns uuid
  language sql stable as $$
  select seller_id from settings where id = 1;
$$;

-- ---------- sellers (Phase 2: multi-vendor marketplace) ----------
-- Phase 0 foundation only: real accounts (via Supabase Auth) + admin
-- approval workflow. Products/orders are NOT yet connected to sellers --
-- that's a deliberately separate, later step, so this can ship and be
-- tested on its own without touching anything that already works.
--
-- The platform owner (the store this app already runs) does not need a
-- row here in Phase 0 -- they keep managing everything through /admin
-- exactly as before. This table is for *additional* sellers joining the
-- marketplace.
create table if not exists sellers (
  id           uuid primary key default gen_random_uuid(),
  -- Nullable + ON DELETE SET NULL: if a seller's auth account is ever
  -- deleted, their seller row (and history) isn't silently destroyed
  -- with it.
  user_id      uuid unique references auth.users(id) on delete set null,
  full_name    text not null default '',
  store_name   text not null,
  slug         text not null unique,
  email        text not null,
  phone        text not null default '',
  description  text not null default '',
  address      text not null default '',
  city         text not null default '',
  country      text not null default '',
  seller_type  text not null default 'individual' check (seller_type in ('individual','business')),
  status       text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  -- Per-seller commission override (Phase 2 earnings). NULL means "use
  -- the platform default" (settings.commission_rate) -- most sellers
  -- should have no override; this is only for a negotiated rate.
  commission_rate numeric(5,2),
  -- Per-seller shipping (kept intentionally simple, per the original
  -- spec: "do not build a complicated logistics system"). delivery_area
  -- is a free-text description ("Dili only", "Same-day in Baucau"), not
  -- a zone system -- checkout doesn't read these yet (it still uses the
  -- platform's own delivery zones for fee calculation); this is the
  -- data model ready for when a seller-aware checkout is built.
  delivery_available boolean not null default true,
  pickup_available    boolean not null default true,
  delivery_fee        numeric(10,2),
  delivery_area       text not null default '',
  -- Optional two-factor login (mirrors settings.totp_* on the admin
  -- account — see lib/totp.ts, which both share). Opt-in: a seller
  -- turns this on themselves from their settings, it's never forced.
  totp_secret          text,
  totp_enabled         boolean not null default false,
  totp_failed_attempts int not null default 0,
  totp_locked_until    timestamptz,
  created_at   timestamptz not null default now()
);
-- ALTER form for an existing sellers table (created before these columns
-- existed, e.g. by apply-update-22.js / apply-update-26.js).
alter table sellers add column if not exists commission_rate numeric(5,2);
alter table sellers add column if not exists delivery_available boolean not null default true;
alter table sellers add column if not exists pickup_available boolean not null default true;
alter table sellers add column if not exists delivery_fee numeric(10,2);
alter table sellers add column if not exists delivery_area text not null default '';
alter table sellers add column if not exists totp_secret text;
alter table sellers add column if not exists totp_enabled boolean not null default false;
alter table sellers add column if not exists totp_failed_attempts int not null default 0;
alter table sellers add column if not exists totp_locked_until timestamptz;

alter table sellers enable row level security;

-- ---------- seller_ratings ----------
-- Customers rate a seller after a completed order (see
-- submitSellerRating). One rating per buyer per seller per order --
-- resubmitting updates it rather than creating a duplicate. Ratings are
-- public (that's the point), but buyer_phone stays private -- see the
-- column grant below.
create table if not exists seller_ratings (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references sellers(id) on delete cascade,
  -- No inline `references orders(id)` here: this table is defined ABOVE
  -- `orders`, so an inline foreign key aborts the whole script on a fresh
  -- database ("relation orders does not exist") and every table below this
  -- point is silently never created. FK added at the end of this file.
  order_id    uuid,
  buyer_phone text not null,
  rating      int not null check (rating between 1 and 5),
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  unique (order_id, seller_id)
);
create index if not exists idx_seller_ratings_seller on seller_ratings(seller_id);
alter table seller_ratings enable row level security;

-- ALTER form for an existing seller_ratings table (created by an earlier
-- run of this script before the unique constraint existed). One rating
-- per buyer per seller per order -- resubmitting updates it (see
-- submitSellerRating's upsert) rather than creating a duplicate.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_ratings_order_id_seller_id_key'
  ) then
    alter table seller_ratings add constraint seller_ratings_order_id_seller_id_key unique (order_id, seller_id);
  end if;
end $$;

-- Ratings are public by design (that's the point of a review system),
-- but buyer_phone is not -- column grants (same pattern as settings and
-- sellers above) keep it out of what a browser's anon key can read even
-- though the row itself is visible.
drop policy if exists seller_ratings_public_read on seller_ratings;
create policy seller_ratings_public_read on seller_ratings for select using (true);
revoke select on seller_ratings from anon, authenticated;
grant select (id, seller_id, order_id, rating, comment, created_at) on seller_ratings to anon, authenticated;
-- No public insert/update policy: writing a rating goes through
-- submitSellerRating (service role), which verifies ref+phone match a
-- genuinely completed order containing that seller — the same trust
-- model as every other write in this app.

-- ---------- customers (optional accounts) ----------
-- A real Supabase Auth account for anyone who isn't a seller or the
-- admin. Deliberately minimal for now -- there's no functional
-- difference yet between having one and browsing as a guest; this is
-- groundwork for things like "email registered customers when a new
-- product goes up." One row per auth user, created on their first
-- login/signup (see lib/actions/customer-auth.ts).
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  email       text not null,
  phone       text not null default '',
  notify_new_products boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table customers enable row level security;

-- A customer may read/update only their own row -- never another
-- customer's, and never through the anon key (writes go through
-- customer-auth.ts's service-role client on first login, same trust
-- model as sellers).
drop policy if exists customers_self_read on customers;
create policy customers_self_read on customers for select using (auth.uid() = user_id);

-- A seller may read their own row (dashboard: "your application is
-- pending"). No public read policy yet -- that arrives with public
-- seller store pages in a later phase. No update policy yet either --
-- there's no "edit my profile" UI in Phase 0, and granting blanket
-- UPDATE would let a seller set their own status to 'approved'; that
-- needs a carefully column-scoped grant (see how settings.totp_secret
-- is protected above) added deliberately when that UI is built, not by
-- accident now.
drop policy if exists sellers_self_read on sellers;
create policy sellers_self_read on sellers for select using (auth.uid() = user_id);

-- Phase 2: public storefronts ("Sold by X", /store/[slug]). Approved
-- sellers only -- a pending/rejected/suspended seller's application
-- details stay private. Column grants (like settings.totp_secret above)
-- keep email/phone out of what a random visitor's anon key can read,
-- even though the row itself is visible -- only the self-read policy
-- above (an authenticated seller reading their OWN row via the admin
-- client, which bypasses grants) ever needs those fields.
drop policy if exists sellers_public_read on sellers;
create policy sellers_public_read on sellers for select using (status = 'approved');

revoke select on sellers from anon, authenticated;
grant select (id, store_name, slug, description, city, country, seller_type, created_at)
  on sellers to anon, authenticated;

-- ---------- categories (Epic C) ----------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null default current_seller_id(),
  name        text not null,
  slug        text not null,
  parent_id   uuid references categories(id) on delete set null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (seller_id, slug)
);
create index if not exists idx_categories_parent on categories(parent_id);

-- ---------- hero_slides (homepage carousel) ----------
create table if not exists hero_slides (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null default current_seller_id(),
  image_url   text not null,
  headline    text not null default '',
  subtext     text not null default '',
  cta_label   text not null default '',
  cta_href    text not null default '',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- products (Epic B) ----------
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null default current_seller_id(),
  ref           text not null unique,             -- PRD-0001
  name          text not null,
  slug          text not null,
  category_id   uuid references categories(id) on delete set null,
  price         numeric(10,2) not null check (price >= 0),
  -- Sale price (optional). NULL = no discount running. Only the dollar
  -- amount is stored -- the percentage shown in admin/seller forms and
  -- on product cards is always derived from price vs discount_price,
  -- never stored separately, so the two can never drift out of sync.
  discount_price numeric(10,2) check (discount_price is null or discount_price > 0),
  sizes         text[] not null default '{}',
  tags          text[] not null default '{}',
  stock_status  text not null default 'in' check (stock_status in ('in','low','out')),
  qty           int not null default 0,
  description   text default '',
  images        text[] not null default '{}',     -- public Storage URLs
  -- pickup location override; falls back to settings row when null
  municipality  text,
  post          text,
  suku          text,
  landmark      text,
  -- payment methods accepted for this product (Epic G1)
  pay_cod       boolean not null default true,
  pay_cop       boolean not null default true,
  pay_bank      boolean not null default false,
  pay_wallet    boolean not null default false,
  pay_fiar      boolean not null default false,
  archived      boolean not null default false,    -- B3: soft delete only
  -- Marketplace product moderation (Phase 1): a seller's own new listing
  -- starts "pending" until admin approves it (see /admin, approve/reject
  -- actions). Products created by the platform owner default straight to
  -- "approved" -- they don't need to self-moderate. Distinct from
  -- `archived` above: archived is "hide this again later"; status is
  -- "was this ever allowed to go live at all".
  status        text not null default 'approved' check (status in ('pending','approved','rejected')),
  views         int not null default 0,
  wa_clicks     int not null default 0,
  created_at    timestamptz not null default now(),
  unique (seller_id, slug)
);
-- ALTER form for databases where `products` already existed before this
-- column was added (CREATE TABLE IF NOT EXISTS above is a no-op on an
-- existing table, so the column list change alone wouldn't reach it).
alter table products add column if not exists status text not null default 'approved'
  check (status in ('pending','approved','rejected'));
alter table products add column if not exists discount_price numeric(10,2)
  check (discount_price is null or discount_price > 0);
create index if not exists idx_products_status on products(status);
create index if not exists idx_products_category    on products(category_id);
create index if not exists idx_products_stock       on products(stock_status);
create index if not exists idx_products_created     on products(created_at desc);
create index if not exists idx_products_archived    on products(archived);

-- ---------- orders (Epic F) ----------
create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null default current_seller_id(),
  ref            text not null unique,             -- ORD-2026-0001
  buyer_name     text not null,
  buyer_phone    text not null,                     -- +670XXXXXXXX, identity for the dashboard
  items          jsonb not null,                    -- [{product_id,name,size,price,qty}]
  mode           text not null check (mode in ('delivery','pickup')),
  zone_id        text,
  fee            numeric(10,2) not null default 0,
  quote_requested boolean not null default false,
  subtotal       numeric(10,2) not null,
  total          numeric(10,2) not null,
  -- Central Dili orders use address_line (a plain street address); orders
  -- to Dili's outskirts or another municipality use the full hierarchy.
  address_line   text,
  municipality   text, post text, suku text, aldeia text, landmark text,
  pay_method     text not null check (pay_method in ('cod','cop','bank','wallet','fiar')),
  pay_status     text not null default 'unpaid' check (pay_status in ('unpaid','deposit','paid','refunded')),
  proof_url      text,
  note           text default '',
  status         text not null default 'new'
                 check (status in ('new','confirmed','preparing','out','arrived','completed','cancelled')),
  cancel_reason  text,
  cancel_requested_at timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_orders_phone   on orders(buyer_phone);
create index if not exists idx_orders_status  on orders(status);
create index if not exists idx_orders_created on orders(created_at desc);

-- internal order log (Epic F6) — append-only
create table if not exists order_log (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_order_log_order on order_log(order_id);

-- Immutability guard (NFR: "order records are immutable once completed")
create or replace function block_edit_completed_order() returns trigger as $$
begin
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'Order % is completed and cannot be reopened', old.ref;
  end if;
  if old.status = 'completed' and new.status = 'completed' then
    -- allow pay_status/proof updates only, block item/address edits
    if new.items is distinct from old.items
       or new.total is distinct from old.total
       or new.municipality is distinct from old.municipality then
      raise exception 'Order % is completed and its contents cannot change', old.ref;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_block_edit_completed on orders;
create trigger trg_block_edit_completed
  before update on orders
  for each row execute function block_edit_completed_order();

-- Stock sync on confirm (Epic F5) — decrement qty, auto-flag out of stock
create or replace function decrement_stock_on_confirm() returns trigger as $$
declare item jsonb;
begin
  if new.status = 'confirmed' and old.status = 'new' then
    for item in select * from jsonb_array_elements(new.items) loop
      update products
        set qty = greatest(0, qty - (item->>'qty')::int),
            stock_status = case
              when greatest(0, qty - (item->>'qty')::int) = 0 then 'out'
              when greatest(0, qty - (item->>'qty')::int) <= 2 then 'low'
              else stock_status end
        where id = (item->>'product_id')::uuid;
    end loop;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_decrement_stock on orders;
create trigger trg_decrement_stock
  after update on orders
  for each row execute function decrement_stock_on_confirm();

-- Atomic counters for view / WhatsApp-click tracking (Epic E4).
-- security definer: lets an anonymous visitor bump a counter without
-- granting them general UPDATE rights on the products table.
create or replace function increment_views(p_id uuid) returns void
  language sql security definer set search_path = public as $$
  update products set views = views + 1 where id = p_id;
$$;

create or replace function increment_wa_clicks(p_id uuid) returns void
  language sql security definer set search_path = public as $$
  update products set wa_clicks = wa_clicks + 1 where id = p_id;
$$;

revoke all on function increment_views(uuid) from public;
revoke all on function increment_wa_clicks(uuid) from public;
grant execute on function increment_views(uuid) to anon, authenticated;
grant execute on function increment_wa_clicks(uuid) to anon, authenticated;

-- ============================================================
-- Row Level Security
-- Public (anon) visitors: read live products/categories/settings,
-- create orders and read only the order they can prove (ref + phone
-- match, enforced in the app layer via a server route — RLS still
-- blocks blind SELECT * by anon on orders).
-- Admin writes go through the server using the service-role key,
-- which bypasses RLS — never expose that key to the browser.
-- ============================================================
alter table settings   enable row level security;
alter table categories enable row level security;
alter table hero_slides enable row level security;
alter table products   enable row level security;
alter table orders     enable row level security;
alter table order_log  enable row level security;

drop policy if exists settings_public_read on settings;
create policy settings_public_read on settings for select using (true);

-- Row-level security alone is not enough here: RLS controls which ROWS
-- are visible, not which COLUMNS. Without this, the public anon key
-- (embedded in the browser) could read totp_secret straight off the
-- settings row via the REST API despite the row policy above. Column
-- privileges are a second, independent layer that Postgres also enforces.
revoke select on settings from anon, authenticated;
grant select (
  id, seller_id, store_name, tagline_tet, tagline_pt, tagline_en, wa_number,
  hours, municipality, post, suku, landmark, pickup, banks, wallets, zones, updated_at,
  seller_registration_enabled
) on settings to anon, authenticated;
-- commission_rate is deliberately NOT in this list -- customers never
-- need to see it directly, and the seller-facing pages that do
-- (dashboard, orders) are already authenticated and read the full row
-- via the service-role client (adminSettings()), not this public path.
-- totp_secret, totp_enabled, totp_failed_attempts, totp_locked_until are
-- deliberately excluded — readable only via the service-role client
-- (supabaseAdmin()), which bypasses these grants entirely.

drop policy if exists categories_public_read on categories;
create policy categories_public_read on categories for select using (true);

-- No public insert/update/delete policy on hero_slides -- same as
-- categories and products, all writes go through the server using the
-- service-role key (supabaseAdmin()), which bypasses RLS entirely.
drop policy if exists hero_slides_public_read on hero_slides;
create policy hero_slides_public_read on hero_slides for select using (true);

-- `status` belongs in the POLICY, not only in the app's queries. The
-- anon key is public by design, so anyone can call the REST API directly
-- (GET /rest/v1/products?status=eq.pending) and read every listing awaiting
-- moderation plus every one already rejected, unless the database itself
-- refuses. Admin/seller pages are unaffected -- they use the service-role
-- client, which bypasses RLS.
drop policy if exists products_public_read on products;
create policy products_public_read on products
  for select using (archived = false and status = 'approved');

-- Orders: no public SELECT policy at all — order lookup by ref+phone is
-- done through a server route using the service-role key, never straight
-- from the browser. No public INSERT policy either — placeOrder() has
-- always inserted via the service-role client (supabaseAdmin()), so an
-- anon-key insert policy was never actually needed by the app; it only
-- ever existed as an unused open door for anyone holding the public key
-- (visible in any browser's network tab) to insert directly via the
-- Supabase REST API, bypassing all of placeOrder()'s validation and
-- price/stock checks. The drop below is defensive cleanup for a
-- database that still has it from an earlier version of this file.
drop policy if exists orders_public_insert on orders;

-- ============================================================
-- Storage bucket for product images + payment proofs
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('payment-proofs', 'payment-proofs', false)
  on conflict (id) do nothing;

drop policy if exists "product images public read" on storage.objects;
create policy "product images public read" on storage.objects
  for select using (bucket_id = 'product-images');

-- No public upload policy for either bucket, for the same reason as
-- orders above — every upload path in this app (products.ts, hero.ts,
-- seller-products.ts, orders.ts) already uploads via the service-role
-- client. A public insert policy here would only ever be an unused
-- door letting anyone with the anon key upload arbitrary files
-- directly to storage, bypassing the app's own image compression and
-- validation. Both drops below are defensive cleanup for a database
-- that still has these from an earlier version of this file.
drop policy if exists "product images public upload" on storage.objects;
drop policy if exists "payment proofs public upload" on storage.objects;

-- ============================================================
-- Deferred constraints
-- Anything referencing a table defined later in this file lands here, so
-- the script runs top to bottom on a brand-new database.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_ratings_order_id_fkey'
  ) then
    alter table seller_ratings
      add constraint seller_ratings_order_id_fkey
      foreign key (order_id) references orders(id) on delete set null;
  end if;
end $$;


-- ==== schema-health.sql =================================================

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
-- So it now reports six kinds -- table, view, routine, policy, index,
-- constraint -- and the feature list checks the objects that each file
-- actually creates. The last of those was added for admin-subsections.sql,
-- a file whose whole effect is to widen one check constraint: real, and
-- until then unseeable.
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
   where schemaname in ('public', 'storage')

  union all

  -- CHECK constraints, by name. Not their expressions: an expression is
  -- source, and this function reports shape.
  --
  -- Which means a file that REPLACES a check constraint in place is
  -- invisible here, and the panel would call it applied on a shop that had
  -- never run it. So such a file renames what it replaces --
  -- admin_users_sections_check became admin_users_section_keys_check when
  -- admin-subsections.sql widened it -- and the new name is what the panel
  -- looks for. Names only, and still enough to tell the two states apart.
  --
  -- Only 'c': primary keys, foreign keys and unique constraints are already
  -- reachable as indexes above, and listing them twice would be noise.
  select 'constraint'::text, (n.nspname || '.' || t.relname)::text, c.conname::text
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname in ('public', 'storage')
     and c.contype = 'c';
$$;

comment on function schema_inventory is
  'Names of tables, columns, views, functions, policies, indexes and check constraints, for the admin''s "which SQL still needs running" panel. No data, no function bodies, no constraint expressions. Service role only.';

revoke all on function schema_inventory() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done. Settings -> Database now lists every file in supabase/ except
-- seed.sql, which is demo data and is not meant to be run on a real shop.
--
-- Until this file is re-run, the panel can still see tables and columns, so
-- it keeps reporting on those files -- and reports the three that create no
-- table as NOT CHECKED rather than guessing at them.
-- ---------------------------------------------------------------------------


-- ==== marketplace-v2.sql ================================================

-- ===========================================================================
-- marketplace-v2.sql — search, product reviews, seller payouts
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Requires schema.sql (and, for the reviews' order check, its `orders`
-- table) to have been run first.
--
-- Everything here is additive. The application degrades to its previous
-- behaviour if this file has NOT been run: catalog search falls back to the
-- old in-memory filter, product ratings render as "no reviews yet", and the
-- payout panels show nothing. Nothing below is load-bearing for checkout.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Full-text search
--
-- The old search was `products.filter(p => (name+description+tags).includes(q))`
-- running in Node over the whole catalog. That has three problems that matter
-- more here than in an English-language store:
--
--   * Accents. A buyer typing "telemovel" or "cafe" got nothing back for
--     "telemóvel" / "café". Portuguese loanwords are everywhere in a
--     Timorese catalog, and phone keyboards do not make accents easy.
--   * Substring, not word, matching -- and no ranking at all, so a match in
--     a 500-word description outranked nothing and sorted the same as a
--     match in the product's own name.
--   * It required every live product in memory on every keystroke-driven
--     page load.
--
-- The 'simple' text search configuration is deliberate: 'english' would stem
-- Tetun and Portuguese words into nonsense. 'simple' just lowercases and
-- splits, which is what a trilingual catalog actually wants. Accent folding
-- is done explicitly with unaccent() instead.
-- ---------------------------------------------------------------------------
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- Weighted document for one product. Kept as a function so the trigger and
-- the backfill below cannot drift apart. STABLE, not IMMUTABLE: unaccent()
-- depends on a dictionary, which is why the tsvector is maintained by a
-- trigger rather than declared as a GENERATED column.
--   A = name       (what people actually search for)
--   B = tags, ref  (utility terms and the printed reference)
--   D = description
create or replace function product_search_document(
  p_name text, p_tags text[], p_ref text, p_description text
) returns tsvector
language sql stable
-- unaccent lives in `extensions` on Supabase and in `public` elsewhere;
-- naming both means this resolves either way. A schema in search_path that
-- does not exist is ignored, not an error.
set search_path = public, extensions
as $$
  select setweight(to_tsvector('simple', unaccent(coalesce(p_name, ''))), 'A')
      || setweight(to_tsvector('simple', unaccent(coalesce(array_to_string(p_tags, ' '), ''))), 'B')
      || setweight(to_tsvector('simple', unaccent(coalesce(p_ref, ''))), 'B')
      || setweight(to_tsvector('simple', unaccent(coalesce(p_description, ''))), 'D');
$$;

alter table products add column if not exists search_vector tsvector;

create or replace function products_search_vector_sync() returns trigger
language plpgsql as $$
begin
  new.search_vector := product_search_document(new.name, new.tags, new.ref, new.description);
  return new;
end;
$$;

drop trigger if exists trg_products_search_vector on products;
create trigger trg_products_search_vector
  before insert or update of name, tags, ref, description on products
  for each row execute function products_search_vector_sync();

-- Backfill. Written as a direct expression rather than a no-op UPDATE
-- because the trigger above only fires on the four columns it watches.
update products
   set search_vector = product_search_document(name, tags, ref, description)
 where search_vector is null;

create index if not exists idx_products_search on products using gin(search_vector);
-- Trigram index on the raw name, for the "did you mean" suggestion path
-- only (see suggest_products below). Not accent-folded: unaccent() is not
-- IMMUTABLE so it cannot appear in an index expression, and the full-text
-- path above already covers accents.
create index if not exists idx_products_name_trgm on products using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. Product reviews
--
-- The store already had SELLER ratings. It had nothing at the level a buyer
-- actually decides at: this product, from this seller, was it what the photo
-- promised. Same trust model as seller_ratings and lookupOrder(): knowing an
-- order's reference AND the phone it was placed with proves you are the
-- buyer. The server action additionally checks the order is completed and
-- actually contained this product, so a review cannot be written for
-- something that was never bought.
-- ---------------------------------------------------------------------------
create table if not exists product_reviews (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  order_id    uuid references orders(id) on delete set null,
  buyer_phone text not null,
  buyer_name  text not null default '',
  rating      int not null check (rating between 1 and 5),
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  -- One review per product per order. Resubmitting updates the existing
  -- row (see submitProductReview's upsert) instead of stacking duplicates.
  unique (order_id, product_id)
);
create index if not exists idx_product_reviews_product on product_reviews(product_id, created_at desc);
alter table product_reviews enable row level security;

-- Public by design -- that is the point of a review. buyer_phone is not:
-- column grants keep it out of what the browser's anon key can read, the
-- same pattern settings.totp_secret and seller_ratings.buyer_phone use.
drop policy if exists product_reviews_public_read on product_reviews;
create policy product_reviews_public_read on product_reviews for select using (true);
revoke select on product_reviews from anon, authenticated;
grant select (id, product_id, order_id, buyer_name, rating, comment, created_at)
  on product_reviews to anon, authenticated;
-- No public insert/update/delete: every write goes through
-- submitProductReview (service role), which verifies the order first.

-- Denormalised aggregates on products, maintained by trigger.
--
-- Every product card in every grid shows a star rating. Computing that with
-- an aggregate query per card, or one big GROUP BY joined into the catalog
-- read, costs a round trip to Singapore that these two columns make
-- unnecessary. Same approach the schema already takes for views/wa_clicks.
alter table products add column if not exists rating_sum   int not null default 0;
alter table products add column if not exists rating_count int not null default 0;

create or replace function product_reviews_sync_aggregate() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update products set rating_sum = rating_sum + new.rating,
                        rating_count = rating_count + 1
      where id = new.product_id;
  elsif tg_op = 'UPDATE' then
    if new.product_id = old.product_id then
      update products set rating_sum = rating_sum + new.rating - old.rating
        where id = new.product_id;
    else
      update products set rating_sum = rating_sum - old.rating,
                          rating_count = greatest(0, rating_count - 1)
        where id = old.product_id;
      update products set rating_sum = rating_sum + new.rating,
                          rating_count = rating_count + 1
        where id = new.product_id;
    end if;
  elsif tg_op = 'DELETE' then
    update products set rating_sum = greatest(0, rating_sum - old.rating),
                        rating_count = greatest(0, rating_count - 1)
      where id = old.product_id;
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_product_reviews_aggregate on product_reviews;
create trigger trg_product_reviews_aggregate
  after insert or update or delete on product_reviews
  for each row execute function product_reviews_sync_aggregate();

-- Recompute from scratch, so re-running this file repairs any drift rather
-- than doubling the totals.
update products p set
  rating_sum   = coalesce(r.total, 0),
  rating_count = coalesce(r.n, 0)
from (
  select product_id, sum(rating) as total, count(*) as n
    from product_reviews group by product_id
) r
where r.product_id = p.id;

update products set rating_sum = 0, rating_count = 0
 where id not in (select product_id from product_reviews)
   and (rating_sum <> 0 or rating_count <> 0);

-- ---------------------------------------------------------------------------
-- 3. Seller payouts
--
-- The platform's commission was being *calculated* (computeSellerEarnings)
-- and never *recorded*. That is fine for a single-owner store and untenable
-- for a marketplace: nothing in the database said how much a seller was
-- owed, how much had actually been handed over, or when.
--
-- Deliberately a single-entry ledger, not double-entry accounting. Money
-- owed is derived (net earnings on completed orders minus payouts recorded
-- here), which means there is exactly one writable fact -- "we paid X on
-- day Y" -- and no way for two stored numbers to disagree.
-- ---------------------------------------------------------------------------
create table if not exists seller_payouts (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null references sellers(id) on delete cascade,
  amount       numeric(10,2) not null check (amount > 0),
  method       text not null default 'bank' check (method in ('bank','wallet','cash','other')),
  reference    text not null default '',   -- bank transfer ref / wallet txn id
  note         text not null default '',
  paid_at      timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_seller_payouts_seller on seller_payouts(seller_id, paid_at desc);
alter table seller_payouts enable row level security;

-- A seller may read their own payout history. No public read policy: what
-- the platform pays whom is nobody else's business. Writes are admin-only
-- through the service-role client.
drop policy if exists seller_payouts_self_read on seller_payouts;
create policy seller_payouts_self_read on seller_payouts for select using (
  seller_id in (select id from sellers where user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- 4. search_products() — one ranked, filtered, paginated query
--
-- SECURITY INVOKER (the default) on purpose: called with the anon key, it
-- runs as `anon`, so the products_public_read RLS policy still decides which
-- rows exist. The archived/status predicates below are belt and braces, not
-- the security boundary.
--
-- Returns the whole product row as a composite plus the unpaginated total,
-- so the caller gets pagination counts without a second round trip and this
-- signature does not have to change every time products gains a column.
-- ---------------------------------------------------------------------------
create or replace function search_products(
  q             text    default '',
  category_ids  uuid[]  default null,
  seller_ids    uuid[]  default null,
  min_price     numeric default null,
  max_price     numeric default null,
  in_stock_only boolean default false,
  sort          text    default 'relevance',
  lim           int     default 24,
  off           int     default 0
)
returns table (product products, total_count bigint, rank real)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_terms   text;
  v_tsquery tsquery := null;
  v_limit   int := least(greatest(coalesce(lim, 24), 1), 100);
  v_offset  int := greatest(coalesce(off, 0), 0);
begin
  -- Build a prefix tsquery by hand rather than using websearch_to_tsquery:
  -- shoppers type partial words ("kame" for "kamera") far more often than
  -- they type boolean operators. Splitting on non-alphanumerics first means
  -- nothing reaching to_tsquery can be a tsquery operator, so no amount of
  -- punctuation in `q` can produce a syntax error.
  select string_agg(word || ':*', ' & ')
    into v_terms
    from regexp_split_to_table(lower(unaccent(coalesce(q, ''))), '[^[:alnum:]]+') as word
   where word <> '';

  if v_terms is not null and v_terms <> '' then
    v_tsquery := to_tsquery('simple', v_terms);
  end if;

  return query
  with matched as (
    select p,
           case when v_tsquery is null then 0::real
                else ts_rank(p.search_vector, v_tsquery) end as r,
           case when p.discount_price is not null and p.discount_price > 0
                then p.discount_price else p.price end as effective_price
      from products p
     where p.archived = false
       and p.status = 'approved'
       and (v_tsquery is null or p.search_vector @@ v_tsquery)
       and (category_ids is null or p.category_id = any(category_ids))
       and (seller_ids is null or p.seller_id = any(seller_ids))
       and (not in_stock_only or p.stock_status <> 'out')
       and (min_price is null or
            (case when p.discount_price is not null and p.discount_price > 0
                  then p.discount_price else p.price end) >= min_price)
       and (max_price is null or
            (case when p.discount_price is not null and p.discount_price > 0
                  then p.discount_price else p.price end) <= max_price)
  )
  select m.p, count(*) over () as total_count, m.r
    from matched m
   order by
     -- Sort by the price a buyer would actually pay, not the list price:
     -- a discounted item belongs where its discounted price puts it.
     case when sort = 'low'  then m.effective_price end asc,
     case when sort = 'high' then m.effective_price end desc,
     case when sort = 'rating'
          then (m.p).rating_sum::numeric / nullif((m.p).rating_count, 0) end desc nulls last,
     case when sort = 'relevance' then m.r end desc,
     -- Final tiebreaker, and the whole ordering for sort = 'new'.
     (m.p).created_at desc
   limit v_limit offset v_offset;
end;
$$;

-- "Did you mean" — only ever called when search_products returned nothing,
-- so the trigram scan stays off the hot path. Threshold is deliberately
-- loose: a shopper who got zero results is better served by a wrong guess
-- than by an empty page.
create or replace function suggest_products(q text, lim int default 5)
returns table (name text, slug text, score real)
language sql
stable
set search_path = public, extensions
as $$
  select p.name, p.slug, similarity(p.name, coalesce(q, '')) as score
    from products p
   where p.archived = false
     and p.status = 'approved'
     and coalesce(q, '') <> ''
     and similarity(p.name, q) > 0.15
   order by score desc
   limit least(greatest(coalesce(lim, 5), 1), 20);
$$;

revoke all on function search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int) from public;
-- search_products and suggest_products stay reachable by anon on purpose:
-- they ARE the catalog, they run as the caller, and the RLS policy on
-- products is still what decides which rows come back.
revoke all on function suggest_products(text, int) from public;
grant execute on function search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int) to anon, authenticated;
grant execute on function suggest_products(text, int) to anon, authenticated;


-- ==== order-items.sql ===================================================

-- ===========================================================================
-- Loja AIAI -- order lines become rows
--
-- Run AFTER supabase/schema.sql and supabase/marketplace-v2.sql.
--
-- THE ROOT OF FOUR SEPARATE FINDINGS. Order lines live in `orders.items`
-- as JSONB. JSONB is a fine way to keep a SNAPSHOT -- what this line was
-- called, what it cost, what rate applied -- and a hopeless way to answer
-- "which orders belong to seller X", because there is no index into the
-- inside of a document.
--
-- So every seller-facing screen scanned the 5,000 newest orders
-- MARKETPLACE-WIDE and filtered them in JavaScript. That one choice is:
--
--   * the earnings cap. Past 5,000 total orders a seller's older completed
--     orders fall out of the window and stop counting toward gross sales,
--     while every dollar already paid to them still counts. The dashboard
--     now refuses to show a figure it cannot stand behind, which is honest
--     and is not a fix.
--   * the cost of every seller screen, which is the same full scan whether
--     the seller has two orders or two hundred.
--   * the best-sellers ranking, which scans completed orders to add up
--     units per product.
--   * and the reason a mixed-seller order is read-only for everyone in it:
--     status lives on the order, so there is nowhere to put "I have
--     dispatched my half".
--
-- WHAT THIS FILE DOES NOT DO. It does not remove `orders.items`. That
-- column stays exactly as it is and stays authoritative for display: it is
-- the snapshot, written once, never migrated, and every existing reader of
-- it keeps working untouched. This table is an INDEX INTO it, derived from
-- it, and kept in step by a trigger rather than by a second write in
-- application code that somebody will one day forget.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,

  -- SET NULL, not CASCADE. Deleting a product must never delete the record
  -- of having sold it -- that would rewrite history and every total derived
  -- from it. The name and price below are what keep the line readable
  -- afterwards.
  product_id   uuid references products(id) on delete set null,
  seller_id    uuid references sellers(id) on delete set null,

  -- SNAPSHOTS, all four. Same rule the JSONB already follows and the same
  -- reason purchase orders capture fx_rate: a line records the deal as it
  -- was on the day, so re-pricing a product or renegotiating a rate cannot
  -- silently rewrite what was sold or what was owed.
  name         text not null default '',
  size         text not null default '',
  qty          int not null check (qty > 0),
  unit_price   numeric(10,2) not null,
  -- The platform's purchase cost. Null means "not recorded", which stays
  -- distinguishable from "cost nothing" forever.
  cost         numeric(14,4),
  -- Null for the marketplace's own goods: there is no commission on selling
  -- to yourself, and that is different from a rate nobody wrote down.
  commission_rate numeric(5,2),

  -- WHERE THIS SELLER'S HALF OF THE ORDER HAS GOT TO.
  --
  -- The order's own status is one column shared by everyone in it, which is
  -- why a mixed-seller order has always been read-only for the sellers in
  -- it: there was nowhere for one of them to say "mine has gone out" without
  -- claiming it for the other. This is that somewhere.
  --
  -- Deliberately a SHORTER vocabulary than orders.status. A seller is not
  -- running the delivery and cannot know that a package arrived; what they
  -- know is whether they have packed it and handed it over.
  fulfilment_status text not null default 'pending'
    check (fulfilment_status in ('pending','preparing','ready','dispatched','cancelled')),

  -- Copied from the order, not defaulted to now(). It is what makes
  -- (seller_id, created_at) answer "this seller's recent orders" without
  -- joining back to orders at all.
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. The index the whole file exists for
-- ---------------------------------------------------------------------------
-- "This seller's lines, newest first" -- which is every seller screen, the
-- earnings aggregate and the payout ledger, all served by one index instead
-- of one marketplace-wide scan each.
create index if not exists order_items_seller_idx
  on order_items (seller_id, created_at desc);

-- Reading one order's lines back, which is the join behind the seller's
-- order list.
create index if not exists order_items_order_idx on order_items (order_id);

-- GROUP BY product_id, for the best-sellers ranking and demand planning.
create index if not exists order_items_product_idx on order_items (product_id);

-- ONE ROW PER LINE, and what makes the trigger below idempotent. A line is
-- identified by its order, its product and its size -- the same product in
-- two sizes is two lines, which is exactly how the basket treats it.
--
-- coalesce on product_id because a null is not equal to a null in a unique
-- index, and a line whose product was later deleted must still be unique.
create unique index if not exists order_items_line_uq
  on order_items (order_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), size);

comment on table order_items is
  'One row per order line, derived from orders.items and kept in step by a trigger. orders.items stays authoritative for display; this is the index into it. See supabase/order-items.sql.';

-- ---------------------------------------------------------------------------
-- 3. Kept in step by the database, not by remembering
-- ---------------------------------------------------------------------------
-- A second write in placeOrder() would work until the day something else
-- writes an order -- a backfill script, a support fix, an import -- and
-- then the two would disagree with nothing to say which was right.
--
-- ON CONFLICT DO NOTHING rather than DO UPDATE: fulfilment_status is owned
-- by the seller who set it, and re-running this must never walk somebody's
-- "dispatched" back to "pending".

create or replace function sync_order_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into order_items (
    order_id, product_id, seller_id, name, size, qty,
    unit_price, cost, commission_rate, created_at
  )
  select new.id,
         nullif(i->>'product_id', '')::uuid,
         nullif(i->>'seller_id', '')::uuid,
         coalesce(i->>'name', ''),
         coalesce(i->>'size', ''),
         (i->>'qty')::int,
         (i->>'price')::numeric,
         nullif(i->>'cost', '')::numeric,
         nullif(i->>'commission_rate', '')::numeric,
         new.created_at
    from jsonb_array_elements(new.items) i
   where coalesce((i->>'qty')::int, 0) > 0
     -- A line naming a seller that no longer exists would fail the foreign
     -- key and take the whole order insert down with it. The line is worth
     -- more than the attribution.
     and (nullif(i->>'seller_id', '') is null
          or exists (select 1 from sellers s where s.id = (i->>'seller_id')::uuid))
     and (nullif(i->>'product_id', '') is null
          or exists (select 1 from products p where p.id = (i->>'product_id')::uuid))
  on conflict do nothing;

  return null;
end $$;

comment on function sync_order_items is
  'Derives order_items rows from orders.items. Never updates an existing line: fulfilment_status belongs to the seller who set it.';

drop trigger if exists trg_sync_order_items on orders;
create trigger trg_sync_order_items
  after insert or update of items on orders
  for each row execute function sync_order_items();

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
-- Every order already in the table, turned into lines. Without this the
-- new queries would report that every seller's history began the day this
-- ran -- which is the earnings bug again, wearing a different hat.

do $$
declare n bigint;
begin
  insert into order_items (
    order_id, product_id, seller_id, name, size, qty,
    unit_price, cost, commission_rate, created_at
  )
  select o.id,
         nullif(i->>'product_id', '')::uuid,
         nullif(i->>'seller_id', '')::uuid,
         coalesce(i->>'name', ''),
         coalesce(i->>'size', ''),
         (i->>'qty')::int,
         (i->>'price')::numeric,
         nullif(i->>'cost', '')::numeric,
         nullif(i->>'commission_rate', '')::numeric,
         o.created_at
    from orders o
    cross join lateral jsonb_array_elements(o.items) i
   where coalesce((i->>'qty')::int, 0) > 0
     and (nullif(i->>'seller_id', '') is null
          or exists (select 1 from sellers s where s.id = (i->>'seller_id')::uuid))
     and (nullif(i->>'product_id', '') is null
          or exists (select 1 from products p where p.id = (i->>'product_id')::uuid))
  on conflict do nothing;
  get diagnostics n = row_count;
  raise notice 'order_items backfill: % line(s)', n;
end $$;

-- A cancelled order's lines are cancelled too. Backfilled once here;
-- from now on the trigger in section 6 keeps it true.
update order_items oi
   set fulfilment_status = 'cancelled'
  from orders o
 where o.id = oi.order_id
   and o.status = 'cancelled'
   and oi.fulfilment_status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 5. Earnings, as one indexed aggregate instead of a scan
-- ---------------------------------------------------------------------------
-- What computeSellerEarnings() was doing in JavaScript over 5,000 orders,
-- expressed once, correctly, over an index.
--
-- COMPLETED ORDERS ONLY, which is the rule that has always applied: a
-- pending order is a possible future sale, not a realised one.
--
-- The commission falls back to the rate in force NOW for lines placed
-- before rates were recorded on them -- the same precedence the TypeScript
-- applied, and the same reason: those lines were always computed that way,
-- so nothing about the past changes on the day this ships.

create or replace function seller_earnings(p_seller_id uuid)
returns table (
  completed_order_count bigint,
  gross_sales numeric,
  commission numeric,
  earnings numeric
) language sql stable security definer set search_path = public as $$
  with rate as (
    select coalesce(
      (select s.commission_rate from sellers s where s.id = p_seller_id),
      (select st.commission_rate from settings st where st.id = 1),
      0) as fallback
  ),
  lines as (
    select oi.order_id,
           oi.unit_price * oi.qty as line_total,
           oi.unit_price * oi.qty
             * coalesce(oi.commission_rate, (select fallback from rate)) / 100 as line_commission
      from order_items oi
      join orders o on o.id = oi.order_id
     where oi.seller_id = p_seller_id
       and o.status = 'completed'
  )
  select (select count(distinct order_id) from lines),
         coalesce((select sum(line_total) from lines), 0),
         coalesce((select sum(line_commission) from lines), 0),
         coalesce((select sum(line_total) - sum(line_commission) from lines), 0);
$$;

comment on function seller_earnings is
  'Gross sales, commission and net earnings for one seller across completed orders. One indexed aggregate; replaces a 5,000-row marketplace-wide scan.';

revoke all on function seller_earnings(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. A cancelled order cancels its lines
-- ---------------------------------------------------------------------------
-- Without this a seller's screen would keep showing "ready to dispatch" for
-- an order the buyer cancelled yesterday, and the seller would pack it.

create or replace function sync_order_item_cancellation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' then
    update order_items
       set fulfilment_status = 'cancelled'
     where order_id = new.id and fulfilment_status <> 'cancelled';
  end if;
  return null;
end $$;

drop trigger if exists trg_sync_order_item_cancellation on orders;
create trigger trg_sync_order_item_cancellation
  after update of status on orders
  for each row execute function sync_order_item_cancellation();

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
-- Buyer names and phone numbers are not in this table, but unit costs and
-- commission rates are -- the platform's margin on every line it has ever
-- sold. Nothing public reads it; every reader goes through the service role.
alter table order_items enable row level security;
revoke all on order_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify the derivation agrees with its source:
--
--   select count(*) from orders o
--    cross join lateral jsonb_array_elements(o.items) i
--    where coalesce((i->>'qty')::int, 0) > 0;
--   select count(*) from order_items;
--
-- The second may be smaller by exactly the lines whose product or seller
-- no longer exists, which are skipped on purpose.
--
-- Until this file is run, every reader falls back to the JSONB scan it has
-- always used. Nothing half-migrates.
-- ---------------------------------------------------------------------------

-- Trigger functions, revoked for the same reason as everything else here:
-- Postgres refuses a direct call to one anyway, but "it fails for another
-- reason" is not a grant policy, and the next person to make one of these
-- callable will not re-derive that.
revoke all on function sync_order_items() from public, anon, authenticated;
revoke all on function sync_order_item_cancellation() from public, anon, authenticated;


-- ==== notifications.sql =================================================

-- ===========================================================================
-- notifications.sql — order notifications sent to the buyer's phone
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Requires schema.sql to have been run first.
--
-- Additive and optional: without this file the store behaves exactly as it
-- does today. Order status changes still work; they just don't tell anyone.
-- ===========================================================================

-- The buyer's language, captured at checkout.
--
-- A notification arriving in a language the buyer doesn't read is worse than
-- no notification -- they can't tell it from spam. The site already knows
-- which of the three languages they were browsing in, so the only thing
-- missing was somewhere to keep it. Defaults to Tetun, matching the site.
alter table orders add column if not exists lang text not null default 'tet'
  check (lang in ('tet','pt','en'));

-- ---------------------------------------------------------------------------
-- notifications — one row per message the store owes a buyer
--
-- An outbox, not a log. The row is written FIRST, then a send is attempted
-- against it, so a message can never be lost between "we decided to tell
-- them" and "the network call failed". A row that is still `queued` is work
-- outstanding; the admin can see it and send it by hand.
--
-- That distinction is what makes this useful before any SMS gateway is
-- configured at all: with no provider set up, every notification queues with
-- channel='manual' and the admin gets a one-tap link that opens their own
-- phone's SMS app with the number and text filled in. Configure a gateway
-- later and the same rows start sending themselves.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  -- Denormalised so the admin queue can show which order a message belongs
  -- to without a join, and so a row stays readable in isolation.
  order_ref    text not null,
  -- Which moment in the order's life this message is about. Paired with
  -- order_id in the unique constraint below, this is what makes sending
  -- idempotent: an order can never be told twice that it was confirmed,
  -- however many times the status is set or a retry runs.
  event        text not null check (event in
                 ('placed','confirmed','out','arrived','completed','cancelled')),
  to_phone     text not null,
  lang         text not null default 'tet' check (lang in ('tet','pt','en')),
  -- The exact text that will be sent, rendered at queue time rather than at
  -- send time. If the store's name or a template changes tomorrow, a message
  -- queued today still says what the buyer was promised it would say.
  body         text not null,
  tracking_url text not null default '',
  channel      text not null default 'manual' check (channel in ('sms','manual')),
  provider     text not null default '',
  provider_ref text,
  status       text not null default 'queued'
                 check (status in ('queued','sent','failed','skipped')),
  error        text,
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  unique (order_id, event)
);
create index if not exists idx_notifications_status on notifications(status, created_at);
create index if not exists idx_notifications_order on notifications(order_id);

alter table notifications enable row level security;

-- No policy of any kind, deliberately.
--
-- Every row here holds a buyer's phone number next to a link that opens
-- their order. There is no version of "the public may read some of this"
-- that is safe, so there is no public policy to get subtly wrong later --
-- RLS with zero policies denies everyone. The admin pages reach this table
-- through the service-role client, which bypasses RLS entirely, the same
-- way orders are already handled.
revoke all on notifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Channel migration: WhatsApp -> SMS
--
-- An earlier version of this file allowed channel='whatsapp'. Order updates
-- now go to the buyer's phone as SMS instead, so the constraint has to be
-- replaced -- and any rows already carrying the old value moved across, or
-- the new constraint refuses to be added at all.
--
-- Written to be a no-op on a database that never saw the WhatsApp version,
-- so this file stays safe to run on a fresh project and on an existing one.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'notifications'::regclass
       and conname = 'notifications_channel_check'
  ) then
    alter table notifications drop constraint notifications_channel_check;
  end if;

  -- Historical rows: the message really was sent, it just went out over a
  -- channel this store no longer uses. Relabelled rather than deleted, so
  -- the record of what a buyer was told stays intact.
  update notifications set channel = 'sms' where channel = 'whatsapp';

  alter table notifications
    add constraint notifications_channel_check check (channel in ('sms','manual'));
end $$;


-- ==== customer-alerts.sql ===============================================

-- ---------------------------------------------------------------------------
-- Telling customers about a new product, or a new discount
-- ---------------------------------------------------------------------------
-- Run AFTER schema.sql (customers, products) and notifications.sql, whose
-- shape this follows. Safe to re-run.
--
-- customers.notify_new_products has existed since the account page did, and
-- a customer ticking it was told nothing, ever. Nothing read the column.
-- This is the queue that makes the promise real.
--
-- ONE ROW PER CUSTOMER PER PRODUCT PER KIND, and the unique index is the
-- whole safety story: a shop that edits a product five times on the morning
-- it goes live must not send five messages to everybody. The insert is
-- `on conflict do nothing`, so re-saving is free.
--
-- THE SHAPE IS notifications.sql's, deliberately: body rendered at QUEUE
-- time so a template change tomorrow cannot alter what was queued today, a
-- status the admin screen can act on, and the same manual fallback when no
-- gateway is configured.
--
-- A SEPARATE TABLE rather than widening notifications: that table's order_id
-- is NOT NULL and its event list is the order's lifecycle. Making order_id
-- nullable to fit announcements in would weaken a constraint that protects
-- every order message, to save one create table.
-- ---------------------------------------------------------------------------
create table if not exists customer_alerts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  product_id  uuid not null references products(id)  on delete cascade,
  -- What is being announced. 'new_product' when it first goes on sale,
  -- 'discount' when a price is cut. A product can produce one of each over
  -- its life, and never a second of either.
  kind        text not null check (kind in ('new_product','discount')),
  to_phone    text not null,
  lang        text not null default 'tet' check (lang in ('tet','pt','en')),
  -- Rendered when queued, for the same reason an order message is.
  body        text not null,
  channel     text not null default 'manual',
  provider    text not null default '',
  status      text not null default 'queued'
                check (status in ('queued','sent','failed','skipped')),
  error       text not null default '',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- THE CONSTRAINT THAT STOPS A SECOND BLAST. Everything else is convenience.
create unique index if not exists customer_alerts_once
  on customer_alerts (customer_id, product_id, kind);

create index if not exists customer_alerts_queued
  on customer_alerts (status, created_at desc);

alter table customer_alerts enable row level security;

-- ---------------------------------------------------------------------------
-- NOBODY READS THIS THROUGH THE PUBLIC KEY
-- ---------------------------------------------------------------------------
-- Every row holds a customer's phone number beside what they were told, so
-- a public read would be a list of the shop's customers and their numbers.
-- RLS is on with NO policy at all: the service-role client the admin screens
-- use bypasses RLS, and the anon key therefore sees nothing rather than
-- whatever a policy forgot to exclude.
-- ---------------------------------------------------------------------------
revoke all on customer_alerts from anon, authenticated;

comment on table customer_alerts is
  'Queued messages telling customers about a new product or a new discount. One per customer per product per kind, enforced by customer_alerts_once. Written by queueProductAlerts() in src/lib/notify/announce.ts; never readable through the anon key.';


-- ==== payments.sql ======================================================

-- ===========================================================================
-- payments.sql — card payment tables (BNCTL / Mastercard acquiring)
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run. Apply-aiaimarket-payments.js never touches your database.
--
-- Design notes worth reading before changing anything here:
--
--  * Amounts are stored as BIGINT MINOR UNITS (cents), not numeric dollars.
--    Card networks settle in integer minor units; storing what we actually
--    sent removes a rounding step from every reconciliation.
--
--  * There is NO card data in this schema and there never will be. The
--    integration is hosted-redirect only, so a PAN never reaches this
--    server. Adding a card_number column here is not an enhancement -- it
--    moves the store from PCI-DSS SAQ A to SAQ D.
--
--  * No RLS policy grants anyone public access. Payments are read and
--    written exclusively through the service-role client in server code,
--    the same trust model as `orders`.
-- ===========================================================================

create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete restrict,
  provider       text not null,
  -- The gateway's own handle for this attempt. Nullable because the row is
  -- deliberately written BEFORE the gateway is called: a charge that exists
  -- at the acquirer with no local record is the one failure mode that
  -- cannot be reconciled afterwards.
  provider_ref   text,
  -- Unique per attempt. Stops a double-submitted checkout from opening two
  -- authorizations against one order.
  idempotency_key text not null unique,
  amount_minor   bigint not null check (amount_minor > 0),
  currency       text not null default 'USD',
  status         text not null default 'initiated'
                 check (status in ('initiated','pending','authorized','captured','failed','cancelled','refunded')),
  failure_reason text,
  redirect_url   text,
  -- Last raw payload from the provider. Kept for disputes: months later,
  -- "what exactly did the gateway tell us" is the only thing that settles
  -- an argument about a transaction.
  raw_event      jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_payments_order    on payments(order_id);
create index if not exists idx_payments_status   on payments(status);
create index if not exists idx_payments_provider on payments(provider, provider_ref);

-- At most ONE live attempt per order. A partial unique index (rather than a
-- plain one) because completed attempts must be allowed to accumulate --
-- a buyer whose card is declined has to be able to try again.
create unique index if not exists idx_payments_one_live_attempt
  on payments(order_id)
  where status in ('initiated','pending');

alter table payments enable row level security;
-- No policies at all == deny everything to anon/authenticated. Deliberate:
-- every read and write goes through the service-role client in server code.

-- ---------------------------------------------------------------------------
-- payment_events — the append-only journal.
--
-- Every provider message is recorded here, INCLUDING the ones deliberately
-- ignored (duplicate deliveries, out-of-order events, amount mismatches).
-- "We received this and chose not to act on it" is exactly the record you
-- need when a customer disputes a charge six weeks later.
-- ---------------------------------------------------------------------------
create table if not exists payment_events (
  id          bigint generated always as identity primary key,
  payment_id  uuid not null references payments(id) on delete cascade,
  -- The provider's event id. Unique per payment, which is what makes
  -- webhook redelivery a no-op instead of a double-credit.
  event_id    text not null,
  status      text not null,
  payload     jsonb,
  created_at  timestamptz not null default now(),
  unique (payment_id, event_id)
);

create index if not exists idx_payment_events_payment on payment_events(payment_id);

alter table payment_events enable row level security;
-- Same as payments: no policies, service-role only.

-- ---------------------------------------------------------------------------
-- orders.pay_method gains 'card'.
--
-- The existing CHECK constraint has to be dropped and rebuilt -- Postgres
-- has no "alter check constraint in place".
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'orders_pay_method_check' and conrelid = 'orders'::regclass
  ) then
    alter table orders drop constraint orders_pay_method_check;
  end if;

  alter table orders add constraint orders_pay_method_check
    check (pay_method in ('cod','cop','bank','wallet','fiar','card'));
end $$;

-- ---------------------------------------------------------------------------
-- Keep payments.updated_at honest without every caller remembering to set it.
-- ---------------------------------------------------------------------------
create or replace function touch_payment_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_payments_touch on payments;
create trigger trg_payments_touch
  before update on payments
  for each row execute function touch_payment_updated_at();

-- ---------------------------------------------------------------------------
-- Reconciliation helper: everything that started and never finished.
--
-- Run this daily. A row that has sat in 'pending' for more than an hour is
-- a buyer who was sent to the gateway and whose outcome never came back --
-- either the webhook was lost or they abandoned. Either way it needs a
-- human to look, because "we don't know if we were paid" is not a state to
-- leave orders sitting in.
-- ---------------------------------------------------------------------------
create or replace view payments_needing_review
  -- SECURITY INVOKER, and it matters more here than anywhere else in this
  -- schema. A view created without it runs with its OWNER's rights, so it
  -- reads straight past the row-level security on `payments` and `orders`
  -- for whoever queries it. This view joins both.
  with (security_invoker = on) as
  select p.id, p.order_id, o.ref as order_ref, p.provider, p.provider_ref,
         p.amount_minor, p.currency, p.status, p.created_at, p.updated_at
    from payments p
    join orders o on o.id = p.order_id
   where p.status in ('initiated','pending','authorized')
     and p.created_at < now() - interval '1 hour'
   order by p.created_at;

-- ---------------------------------------------------------------------------
-- AND REVOKED, like every other sensitive object in this schema.
--
-- This was the one that was missed. Supabase's default privileges grant
-- new objects in `public` to anon and authenticated, so a view is readable
-- by anybody holding the anon key -- which is published in the browser --
-- unless something takes that away. Fourteen other objects in these files
-- do exactly this: stock_reconciliation, admin_users, audit_log,
-- notifications, order_returns, product_costs, seller_invites,
-- stock_movements and the rest.
--
-- WHAT IT WAS LEAKING. Live order references, and amounts, for payments
-- in flight. An order ref is half of the credential pair that lookupOrder,
-- submitProductReview, requestCancellation and startCardPayment all rely
-- on -- the other half being a phone number, which is guessable in a
-- country with one mobile prefix. A published list of them is a targeted
-- list of orders worth attacking, and it names the ones whose payment has
-- not settled yet.
--
-- Both lines are needed. security_invoker alone leaves the grant in place
-- (RLS would then refuse the rows, which is a second failure mode to
-- reason about rather than a fix); the revoke alone leaves a definer view
-- that a future policy change could re-expose.
-- ---------------------------------------------------------------------------
revoke all on payments_needing_review from anon, authenticated;


-- ==== procurement.sql ===================================================

-- ===========================================================================
-- procurement.sql — purchasing: suppliers, purchase orders, line items
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Requires schema.sql to have been run first.
--
-- This is a NEW domain, not a view over what the store already holds. The
-- existing `sellers` table is marketplace vendors who sell THROUGH the
-- platform; a supplier is someone the company buys FROM. Opposite direction,
-- different data, deliberately separate tables.
--
-- Everything here is additive. Without this file the store behaves exactly
-- as it does today; /admin/procurement simply reports that procurement has
-- not been set up yet.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
create table if not exists suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- ISO 3166-1 alpha-2, uppercased. A code rather than a free-text country
  -- name because the dashboard groups and ranks by country, and "Portugal",
  -- "portugal" and "PT" typed on three different days are three countries to
  -- a GROUP BY. The display name is resolved in the app (lib/countries.ts).
  country_code  text not null default '' check (country_code ~ '^[A-Z]{0,2}$'),
  contact_name  text not null default '',
  email         text not null default '',
  phone         text not null default '',
  -- Days the supplier itself promises between order and arrival. Used to
  -- flag a purchase order whose expected date was set more optimistically
  -- than the supplier has ever actually delivered.
  lead_time_days int,
  notes         text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_suppliers_country on suppliers(country_code);
alter table suppliers enable row level security;
-- No policy at all: supplier terms and contacts are commercially sensitive
-- and no visitor has any business reading them. RLS with zero policies
-- denies everyone; the admin pages reach this through the service-role
-- client, the same way orders are already handled.
revoke all on suppliers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- purchase_orders
--
-- On currency: the amount is stored in the currency actually transacted,
-- alongside the rate to the base currency ON THE DAY THE ORDER WAS PLACED.
-- Storing only the foreign amount makes "total purchase value" across a
-- mixed-currency book meaningless; converting at today's rate makes last
-- year's numbers change every morning. A rate captured at order time is what
-- procurement systems actually do, and it makes every total below both
-- comparable and stable.
-- ---------------------------------------------------------------------------
create table if not exists purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  po_number       text not null unique,              -- PO-2026-0001
  supplier_id     uuid not null references suppliers(id) on delete restrict,
  -- restrict, not cascade: deleting a supplier must never silently erase the
  -- purchasing history that explains where the money went.
  buyer           text not null default '',          -- responsible purchasing manager
  order_date      date not null default current_date,
  expected_arrival date,
  actual_arrival   date,

  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- Multiply a figure in `currency` by this to get base currency (USD).
  -- 1 for USD itself.
  fx_rate         numeric(14,6) not null default 1 check (fx_rate > 0),

  -- Header-level money, in `currency`. The goods subtotal is NOT stored: it
  -- is the sum of the line items, and a stored copy is a second number that
  -- can disagree with them.
  tax             numeric(14,2) not null default 0 check (tax >= 0),
  shipping        numeric(14,2) not null default 0 check (shipping >= 0),
  discount        numeric(14,2) not null default 0 check (discount >= 0),

  -- The eight stages from the brief. `delayed` is deliberately NOT one of
  -- them: lateness is derived by comparing dates, so it cannot drift out of
  -- step with them the way a manually-set flag would.
  status          text not null default 'draft' check (status in
                    ('draft','approved','sent','confirmed','in_production',
                     'in_transit','arrived','received','cancelled')),
  payment_status  text not null default 'unpaid' check (payment_status in
                    ('unpaid','partial','paid','overdue')),
  payment_date    date,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_po_supplier on purchase_orders(supplier_id);
create index if not exists idx_po_status on purchase_orders(status);
create index if not exists idx_po_order_date on purchase_orders(order_date desc);
create index if not exists idx_po_expected on purchase_orders(expected_arrival);
alter table purchase_orders enable row level security;
revoke all on purchase_orders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- purchase_order_items
--
-- Free-text product name plus an optional link to a catalog product. A great
-- deal of what a company buys (packaging, office supplies, services) is never
-- a catalog listing, so requiring a product_id would make most real purchase
-- orders unrecordable.
-- ---------------------------------------------------------------------------
create table if not exists purchase_order_items (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  product_name  text not null,
  category      text not null default 'other' check (category in
                  ('raw_materials','components','packaging','office','equipment','services','other')),
  qty           numeric(14,3) not null check (qty > 0),
  unit_price    numeric(14,4) not null check (unit_price >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists idx_poi_po on purchase_order_items(po_id);
create index if not exists idx_poi_product on purchase_order_items(product_id);
alter table purchase_order_items enable row level security;
revoke all on purchase_order_items from anon, authenticated;

-- Keeps updated_at honest without the application having to remember.
create or replace function touch_purchase_order() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_touch_po on purchase_orders;
create trigger trg_touch_po before update on purchase_orders
  for each row execute function touch_purchase_order();

-- An order cannot have arrived before it was placed. Cheap to check here,
-- and impossible to enforce reliably in a form that several screens post to.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'po_arrival_after_order') then
    alter table purchase_orders add constraint po_arrival_after_order
      check (actual_arrival is null or actual_arrival >= order_date);
  end if;
end $$;


-- ==== po-product-details.sql ============================================

-- ===========================================================================
-- po-product-details.sql — carry size and description from the purchase
--                          order onto the product it creates.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor -> New query.
--
-- A product created by receiving a purchase order arrived with a name, a
-- category and a price and nothing else, so its page showed "SIZE —" and an
-- empty description until someone went and typed them in. But the buyer
-- already knew both when they placed the order: that is exactly the moment
-- the sizes and the description are in front of them.
--
-- So they are captured on the line, and flow onto the product at receipt.
-- Two rules make that safe:
--
--   * a product CREATED by the receipt gets both, always;
--   * a product that already exists is only ever FILLED IN, never
--     overwritten. Someone may have written a careful description on the
--     shop's own listing, and a restock must not silently replace it with
--     whatever the supplier called it.
-- ===========================================================================

-- Free text, matching how the buyer writes it on the supplier's order:
-- "S, M, L, XL". Split into the product's sizes array at receipt, so the
-- shape stored here stays whatever the buyer typed and the parsing lives in
-- one tested place (parseSizes in lib/procurement.ts).
alter table purchase_order_items
  add column if not exists sizes text not null default '';

alter table purchase_order_items
  add column if not exists description text not null default '';

comment on column purchase_order_items.sizes is
  'Sizes as typed, e.g. "S, M, L, XL". Parsed into products.sizes at receipt.';
comment on column purchase_order_items.description is
  'Product description, used when this line creates a product, or to fill a blank one. Never overwrites an existing description.';

-- ---------------------------------------------------------------------------
-- Done. Nothing else changes: both columns default to empty, so every
-- existing purchase order stays valid and behaves exactly as before.
-- ---------------------------------------------------------------------------


-- ==== stock-receipt.sql =================================================

-- ===========================================================================
-- stock-receipt.sql — receiving a purchase order updates the shop.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor -> New query.
--
-- Today a purchase order is a record of what you bought and nothing more:
-- when the goods land you retype the quantity into Stock control and the
-- cost into Unit costs by hand. This migration makes the receipt the single
-- event that writes all of it.
--
-- THREE IDEAS, stated once here.
--
-- 1. TWO KINDS OF CATEGORY, WHICH ARE NOT THE SAME QUESTION.
--    purchase_order_items.category is a SPEND category -- what kind of money
--    is this: packaging, office supplies, equipment. A shop that buys
--    clothes to resell had nowhere to put them, so 'goods_for_resale' is
--    added and becomes the default.
--    A resale line also carries catalog_category_id: where the item sits in
--    the SHOP (Clothes, Shoes). The two never conflict, because they answer
--    different questions -- why we spent it, and where it goes on sale.
--    Only resale lines ever touch stock. An office chair is a real purchase
--    and must never appear in the catalog.
--
-- 2. EVERY STOCK CHANGE IS A LEDGER ROW, NOT JUST A NEW BALANCE.
--    stock_movements records each receipt with its quantity, its cost, the
--    order it came from and the day it landed. products.qty stays the
--    running balance; the ledger is how you answer "where did these 40 come
--    from and what did they cost", which a balance alone can never do.
--
-- 3. RECEIVING IS IDEMPOTENT.
--    A unique index on the line id means moving an order back to in_transit
--    and forward to received again cannot add the stock twice. This is the
--    single most important property here: without it a mis-click silently
--    inflates inventory, and nothing downstream would ever reveal it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Resale lines: the spend category, and the link into the catalog
-- ---------------------------------------------------------------------------

alter table purchase_order_items
  drop constraint if exists purchase_order_items_category_check;

alter table purchase_order_items
  add constraint purchase_order_items_category_check
  check (category in ('goods_for_resale','raw_materials','components','packaging',
                      'office','equipment','services','other'));

-- Where a newly bought product should sit in the shop. Null for a line that
-- links to a product that already exists (it has its own category), and for
-- anything not destined for the catalog at all.
alter table purchase_order_items
  add column if not exists catalog_category_id uuid references categories(id) on delete set null;

-- The intended shelf price for a product this line will CREATE. Purchase
-- price and selling price are unrelated numbers, so the buyer states it;
-- ignored when the line links to an existing product, which already has one.
alter table purchase_order_items
  add column if not exists sell_price numeric(12,2) check (sell_price is null or sell_price >= 0);

comment on column purchase_order_items.category is
  'SPEND category -- what kind of money this is. Distinct from the catalog category, which is where the goods sit in the shop.';

-- ---------------------------------------------------------------------------
-- 2. The stock ledger
-- ---------------------------------------------------------------------------

create table if not exists stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  -- Signed: +40 received, -2 sold. Never a replacement balance, always a
  -- change, so the rows sum to the balance and history stays reconstructable.
  delta        int not null check (delta <> 0),
  reason       text not null check (reason in
                 ('purchase_receipt','sale','adjustment','return','correction')),
  -- Where it came from. Nullable because an adjustment has no document.
  po_id        uuid references purchase_orders(id) on delete set null,
  po_item_id   uuid references purchase_order_items(id) on delete set null,
  order_id     uuid references orders(id) on delete set null,
  -- Landed unit cost in BASE currency (USD) at the moment of receipt:
  -- purchase price plus this line's share of tax, shipping and discount,
  -- converted at the order's fx_rate. Null for movements that are not
  -- purchases. See landedUnitCost() in lib/procurement.ts for the split.
  unit_cost    numeric(14,4),
  note         text not null default '',
  created_at   timestamptz not null default now()
);

comment on table stock_movements is
  'Append-only ledger of stock changes. products.qty is the running balance; this is the history behind it.';

-- The idempotency lock. One receipt row per purchase order line, ever.
-- Partial, so a product may still have many sales and adjustments.
create unique index if not exists stock_movements_receipt_once
  on stock_movements (po_item_id)
  where reason = 'purchase_receipt' and po_item_id is not null;

create index if not exists stock_movements_product_idx on stock_movements (product_id, created_at desc);
create index if not exists stock_movements_po_idx      on stock_movements (po_id);

alter table stock_movements enable row level security;
-- No policies plus an explicit revoke: two independent locks, so forgetting
-- one does not open the door. The service role bypasses RLS, which is how
-- the admin pages read it. Purchase costs are visible here, and those must
-- never reach a browser holding only the anon key.
revoke all on stock_movements from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Applying a movement to the balance
-- ---------------------------------------------------------------------------
-- A trigger, not application code: the balance and the ledger row then move
-- together in one transaction and cannot drift apart, whatever writes the
-- row. Mirrors decrement_stock_on_confirm() in schema.sql, which keeps the
-- same thresholds on the way down.

create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
declare new_qty int;
begin
  update products
     set qty = greatest(0, qty + new.delta),
         stock_status = case
           when greatest(0, qty + new.delta) = 0 then 'out'
           when greatest(0, qty + new.delta) <= 2 then 'low'
           else 'in' end
   where id = new.product_id
   returning qty into new_qty;
  return new;
end $$;

drop trigger if exists trg_apply_stock_movement on stock_movements;
create trigger trg_apply_stock_movement
  after insert on stock_movements
  for each row execute function apply_stock_movement();

-- ---------------------------------------------------------------------------
-- Done.
--
-- Receiving stays a deliberate act: nothing here fires on its own. The admin
-- moves a purchase order to "received" and the application writes one ledger
-- row per resale line, which this trigger turns into stock. Lines with no
-- product link -- office supplies, services -- are skipped, as they should
-- be: they are real spending that never belonged in the catalog.
-- ---------------------------------------------------------------------------


-- ==== preorders.sql =====================================================

-- ===========================================================================
-- preorders.sql — let a shopper order something that is out of stock.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor -> New query.
--
-- A PRE-ORDER IS AN ORDER, not a second kind of thing.
--
-- It is the same row in the same table, with one flag set. That is the whole
-- design, and it is what makes the feature small: tracking links, the buyer
-- SMS, the admin order screens, the sales dashboard and the payout ledger
-- all keep working with no changes at all. A parallel "preorders" table
-- would have needed every one of those rebuilt, and would have drifted from
-- the real thing the first time either side changed.
--
-- What tells them apart is the reference prefix (PRO...) and this flag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------

alter table orders add column if not exists is_preorder boolean not null default false;

comment on column orders.is_preorder is
  'True when the order was placed for goods that were out of stock. Set by the SERVER from live stock, never from the browser.';

create index if not exists orders_preorder_idx on orders (is_preorder) where is_preorder;

-- ---------------------------------------------------------------------------
-- 2. Per-product opt-out, and the promised date
-- ---------------------------------------------------------------------------
-- Enabled by default: an out-of-stock product a shopper wants is a sale
-- waiting to happen, and the shop's own screens already show which those
-- are. Turn it off for a line being discontinued, where taking money for
-- something that will never arrive is the wrong answer.

alter table products add column if not exists preorder_enabled boolean not null default true;

-- When the shop expects to have it. Optional, and shown to the buyer when
-- set: "we don't know yet" is a legitimate answer and better than inventing
-- a date that will be missed.
alter table products add column if not exists preorder_eta date;

comment on column products.preorder_eta is
  'Expected availability. NULL means genuinely unknown, which is shown as such rather than guessed.';

-- ---------------------------------------------------------------------------
-- 3. Stock must not move for a pre-order
-- ---------------------------------------------------------------------------
-- The original trigger (schema.sql) decrements on confirm. For a pre-order
-- there is nothing to decrement -- that is the entire point -- and letting
-- it run would quietly hide the shortage: greatest(0, ...) floors at zero,
-- so the shelf would keep reading "0" while the promises pile up invisibly.
-- Stock moves when the goods actually arrive, through the purchase receipt.

create or replace function decrement_stock_on_confirm() returns trigger as $$
declare item jsonb;
begin
  if new.status = 'confirmed' and old.status = 'new' and not coalesce(new.is_preorder, false) then
    for item in select * from jsonb_array_elements(new.items) loop
      update products
        set qty = greatest(0, qty - (item->>'qty')::int),
            stock_status = case
              when greatest(0, qty - (item->>'qty')::int) = 0 then 'out'
              when greatest(0, qty - (item->>'qty')::int) <= 2 then 'low'
              else stock_status end
        where id = (item->>'product_id')::uuid;
    end loop;
  end if;
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing else changes. A pre-order gets a PRO reference, appears in the
-- admin order list beside every other order, sends the same tracking SMS,
-- and is fulfilled the same way once the stock arrives.
-- ---------------------------------------------------------------------------


-- ==== stock-ledger.sql ==================================================

-- ===========================================================================
-- Loja AIAI -- complete the stock ledger
--
-- stock_movements already calls itself "the history behind products.qty".
-- It was not. Only purchase receipts were ever written to it: a sale changed
-- products.qty through decrement_stock_on_confirm(), marking a line out of
-- stock in the admin set qty to 0 directly, and typing a number into the
-- product form overwrote the balance outright. The ledger therefore did not
-- sum to the balance, and the question a stock ledger exists to answer --
-- "why does this say 7?" -- had no answer.
--
-- This makes the ledger the ONLY way products.qty ever moves. Every change
-- becomes a row; apply_stock_movement() turns rows into the balance. After
-- this, sum(delta) = qty for every product, and stock_reconciliation says so
-- out loud.
--
-- Also fixes a real loss: cancelling a confirmed order never gave its units
-- back. They were decremented on confirmation and stayed gone.
--
-- Safe to re-run. Run AFTER supabase/stock-receipt.sql.
-- Run AFTER supabase/preorders.sql -- the backfill below and the trigger it
-- installs both read orders.is_preorder.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. One function that makes an order's stock effect match its status
-- ---------------------------------------------------------------------------
-- Not "decrement on confirm, add back on cancel". That phrasing is what
-- makes stock drift: every transition has to fire exactly once, in order,
-- forever, and an order that is cancelled and then confirmed again breaks it.
--
-- Instead this states the TARGET and moves to it. A live order should have
-- taken its units; a cancelled one should have taken nothing. The function
-- compares that target with what the ledger already says this order did and
-- writes only the difference.
--
-- Every sequence therefore converges, however many times it fires and in
-- whatever order: confirming twice writes nothing the second time, cancelling
-- twice refunds once, and cancel-then-confirm-again takes the stock properly
-- instead of leaving the shop believing in units it has already sold.

create or replace function sync_order_stock(p_order_id uuid, p_take boolean)
returns void language plpgsql as $$
begin
  with want as (
    -- What this order asks of each product, with its lines added up: the
    -- same product can appear twice under two sizes, and stock does not
    -- care about sizes.
    select (i->>'product_id')::uuid      as product_id,
           sum((i->>'qty')::int)::int    as want,
           max(o.ref)                    as ref
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
       -- a line pointing at a product that no longer exists has no stock
       -- to move, and would fail the foreign key if it tried
       and exists (select 1 from products p where p.id = (i->>'product_id')::uuid)
     group by 1
  ),
  done as (
    -- What this order has already done to each product, whichever way.
    select m.product_id, sum(m.delta)::int as done
      from stock_movements m
     where m.order_id = p_order_id
       and m.reason in ('sale','return')
     group by 1
  ),
  move as (
    select w.product_id,
           w.ref,
           (case when p_take then -w.want else 0 end) - coalesce(d.done, 0) as needed
      from want w
      left join done d on d.product_id = w.product_id
  )
  insert into stock_movements (product_id, delta, reason, order_id, note)
  select m.product_id,
         m.needed,
         case when m.needed < 0 then 'sale' else 'return' end,
         p_order_id,
         case when m.needed < 0 then 'order ' else 'returned to stock, order ' end
           || coalesce(m.ref, '')
    from move m
   where m.needed <> 0;
end $$;

comment on function sync_order_stock is
  'Moves an order stock effect to its target: p_take true means it should have taken its units, false means none. Writes only the difference, so it is safe to call any number of times.';

-- ---------------------------------------------------------------------------
-- 2. A sale writes a ledger row instead of touching products
-- ---------------------------------------------------------------------------
create or replace function decrement_stock_on_confirm() returns trigger as $$
begin
  -- A pre-order has no stock to take -- that is the whole point of it -- and
  -- must not be handed back on cancellation either, so it is excluded from
  -- both directions rather than only from the taking.
  if coalesce(new.is_preorder, false) then return new; end if;

  if new.status = 'cancelled' then
    perform sync_order_stock(new.id, false);
  elsif new.status in ('confirmed','preparing','out','arrived','completed') then
    perform sync_order_stock(new.id, true);
  end if;

  return new;
end;
$$ language plpgsql;

comment on function decrement_stock_on_confirm is
  'Keeps an order stock effect in step with its status. products.qty is moved by apply_stock_movement(), never here.';

-- ---------------------------------------------------------------------------
-- 3. The old trigger is replaced, not supplemented
-- ---------------------------------------------------------------------------
-- Reinstalled rather than left alone because it now has to fire on a
-- cancellation too, and the original was registered for status changes only.

drop trigger if exists trg_decrement_stock on orders;
create trigger trg_decrement_stock
  after update of status on orders
  for each row execute function decrement_stock_on_confirm();

-- ---------------------------------------------------------------------------
-- 3b. The balance stops being floored at zero
-- ---------------------------------------------------------------------------
-- apply_stock_movement() clamped products.qty with greatest(0, ...). That
-- looks protective and is the one thing that can silently break a ledger:
-- confirm an order for 500 units of a product with 96 on hand and the ledger
-- records -500 while the balance stops at 0, so the two disagree by 404 and
-- stock_reconciliation can never come back to zero.
--
-- A negative balance is not a bug to be hidden. It is the shop having
-- promised units it does not have, which is exactly the thing someone needs
-- to be told. So the balance now says so, and stock_status still reads 'out'
-- to anyone shopping, who should see no difference.

create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
begin
  update products
     set qty = qty + new.delta,
         stock_status = case
           when qty + new.delta <= 0 then 'out'
           when qty + new.delta <= 2 then 'low'
           else 'in' end
   where id = new.product_id;
  return new;
end $$;

comment on function apply_stock_movement is
  'The only thing that moves products.qty. Never clamps: a negative balance is an oversell, and hiding it would put the ledger and the balance permanently out of step.';

-- ---------------------------------------------------------------------------
-- 4. Reconciliation
-- ---------------------------------------------------------------------------
-- The ledger is only worth having if it agrees with the balance. This view
-- is the proof, and the thing to look at first if a count is ever disputed.

create or replace view stock_reconciliation as
select p.id                                  as product_id,
       p.ref,
       p.name,
       p.qty                                 as balance,
       coalesce(sum(m.delta), 0)::int        as ledger,
       p.qty - coalesce(sum(m.delta), 0)::int as drift,
       count(m.id)                           as movements
  from products p
  left join stock_movements m on m.product_id = p.id
 group by p.id, p.ref, p.name, p.qty;

comment on view stock_reconciliation is
  'One row per product: the balance, what the ledger sums to, and the drift between them. drift <> 0 means something wrote products.qty without a movement.';

-- ---------------------------------------------------------------------------
-- 5. Backfill: past sales first, then whatever is left as an opening balance
-- ---------------------------------------------------------------------------
-- Both inserts run with apply_stock_movement() switched off. These rows
-- RECORD history that has already happened to products.qty; letting the
-- trigger apply them again would move every balance a second time.

do $$
declare sales int; opening int;
begin
  alter table stock_movements disable trigger trg_apply_stock_movement;

  -- 5a. Every order that has already taken its stock gets its sale rows.
  --
  -- Those statuses are exactly the ones an order can only reach by passing
  -- through 'confirmed', which is where the old trigger decremented. A
  -- cancelled order is deliberately left out: under the old trigger it was
  -- decremented on confirmation and never given back, so a cancelled order
  -- MAY have consumed stock -- but the row no longer says whether it was
  -- ever confirmed, and inventing a sale that never happened is worse than
  -- leaving it in the opening balance below, where it is at least honest.
  insert into stock_movements (product_id, delta, reason, order_id, note, created_at)
  select (i->>'product_id')::uuid,
         -sum((i->>'qty')::int),
         'sale',
         o.id,
         'order ' || coalesce(o.ref, '') || ' (recorded when the ledger was completed)',
         o.created_at
    from orders o
    cross join lateral jsonb_array_elements(o.items) i
   where o.status in ('confirmed','preparing','out','arrived','completed')
     and not coalesce(o.is_preorder, false)
     and nullif(i->>'product_id', '') is not null
     and coalesce((i->>'qty')::int, 0) > 0
     and exists (select 1 from products p where p.id = (i->>'product_id')::uuid)
     -- Skip any order the ledger already accounts for, which is what makes
     -- this file safe to run twice.
     and not exists (select 1 from stock_movements m
                      where m.order_id = o.id and m.reason in ('sale','return'))
   group by (i->>'product_id')::uuid, o.id, o.ref, o.created_at;
  get diagnostics sales = row_count;

  -- 5b. What is still unexplained becomes one dated opening row.
  --
  -- Positive is ordinary: stock the shop held before it kept a ledger.
  -- Negative means units left without a document -- breakage, a miscount, a
  -- cancelled order that had been confirmed. It is labelled as unexplained
  -- rather than dressed up as an opening balance, because that is what it is.
  insert into stock_movements (product_id, delta, reason, note, created_at)
  select r.product_id, r.drift, 'correction',
         case when r.drift > 0 then 'opening balance, held before the ledger existed'
              else 'unexplained shortfall, recorded when the ledger was completed' end,
         -- Dated before every movement it explains, so a history read top to
         -- bottom starts at the opening balance rather than ending at it.
         coalesce((select min(m.created_at) - interval '1 second'
                     from stock_movements m where m.product_id = r.product_id),
                  now())
    from stock_reconciliation r
   where r.drift <> 0;
  get diagnostics opening = row_count;

  alter table stock_movements enable trigger trg_apply_stock_movement;

  raise notice 'backfill: % past sales, % opening rows', sales, opening;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants -- the ledger is admin-only, like the rest of purchasing
-- ---------------------------------------------------------------------------
revoke all on stock_reconciliation from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;
-- It should return nothing, now and after every sale, receipt, cancellation
-- and adjustment from here on.
-- ---------------------------------------------------------------------------


-- ==== stock-reservation.sql =============================================

-- ===========================================================================
-- Loja AIAI -- stock held from the moment it is ordered
--
-- Run AFTER supabase/stock-ledger.sql.
--
-- THE LAST CRITICAL FINDING. Stock only ever moved when an ADMIN confirmed
-- an order, so between placing and confirming -- which is minutes at best
-- and overnight in practice -- nothing held the units. Two consequences,
-- and the second is the one that bites at today's volume rather than at
-- scale:
--
--   1. placeOrder() read products.qty, decided the order fit, and inserted.
--      Read-then-write: n buyers arriving together all read qty = 1, all
--      pass, all get an order. Closing the `row.qty > 0 &&` short-circuit
--      removed the UNBOUNDED case; it did nothing about the race.
--   2. Even with no concurrency at all, the last unit stayed purchasable by
--      everybody until a human noticed. That is not a race, it is just the
--      shop advertising something it has already promised away.
--
-- WHY THIS IS A SMALLER CHANGE THAN IT LOOKS. sync_order_stock() already
-- states a TARGET and moves to it rather than applying deltas on each
-- transition -- which is what makes it safe to call repeatedly and in any
-- order. That design absorbs a third state cleanly: an order now targets a
-- RESERVATION while it is new, a SALE once it is live, and nothing once it
-- is cancelled. Every transition between those still converges, because
-- the function keeps writing only the difference.
--
-- WHAT A RESERVATION IS. A stock_movements row like any other, with
-- reason = 'reservation', and it moves products.qty exactly the way a sale
-- does. That is deliberate: it means "available" needs no new definition
-- and no new query. products.qty already IS availability, because
-- everything holding a unit has taken it out of the balance. The catalog,
-- the quantity ceiling and the reconciliation view all keep working with
-- no idea this file exists.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The ledger learns the word
-- ---------------------------------------------------------------------------
-- A check constraint listing the reasons has to be replaced, not added to.
-- Dropped by name and rebuilt so re-running this is a no-op rather than a
-- second constraint saying something subtly different.

-- ADDED ONLY WHEN THERE IS NONE, because this list is not the longest one.
--
-- supabase/supplier-returns.sql runs after this file and widens the same
-- constraint with 'supplier_return'. Re-adding the shorter list here
-- unconditionally is fine on a fresh database and fails on a real one the
-- moment a shop has actually sent goods back to a supplier: the rows hold a
-- reason this list has never heard of, and run-all.sql stops with "check
-- constraint stock_movements_reason_check is violated by some row".
--
-- Which is a re-run breaking on data the shop was right to have.
--
-- AND THERE IS NO `drop constraint` ABOVE THIS, deliberately. Dropping
-- first and then asking whether one exists always answers no -- the drop
-- just removed it -- so the guard would add the short list every time and
-- the guard would be decoration. Leave whatever is there; supplier-returns.sql
-- runs later and drops and re-adds the full list unconditionally, so the end
-- state of a whole run is the longest list either way.
--
-- AND ONLY WHEN EVERY EXISTING ROW ALREADY FITS IT. A run that failed here
-- once has already committed the old unconditional DROP, so the table can
-- be sitting with NO constraint and with rows holding 'supplier_return' --
-- and "there is no constraint" is then not the same question as "this list
-- is safe to apply". Asking both is what makes this recoverable rather than
-- a state an owner has to repair by hand.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stock_movements_reason_check'
  ) and not exists (
    select 1 from stock_movements
     where reason not in ('purchase_receipt','sale','adjustment','return',
                          'correction','reservation')
  ) then
    alter table stock_movements
      add constraint stock_movements_reason_check
      check (reason in ('purchase_receipt','sale','adjustment','return',
                        'correction','reservation'));
  end if;
end $$;

comment on column stock_movements.reason is
  'purchase_receipt, sale, return, adjustment, correction, or reservation -- units held for an order that has been placed and not yet confirmed. A reservation moves the balance exactly like a sale; see supabase/stock-reservation.sql.';

-- The sweep in section 4 asks "which orders are still holding units", which
-- is a question about a handful of rows in a table that only grows.
create index if not exists stock_movements_open_reservation_idx
  on stock_movements (order_id)
  where reason = 'reservation';

-- ---------------------------------------------------------------------------
-- 2. Three targets instead of two
-- ---------------------------------------------------------------------------
-- The old signature took a boolean, which could only express two states.
-- This one names the state, and tracks the two kinds of holding SEPARATELY
-- so that confirming an order writes the pair that converts one into the
-- other:
--
--     reservation  -3    (placed)
--     reservation  +3    (confirmed: the hold is released...)
--     sale         -3    (...and becomes a sale)
--
-- Net movement on confirmation: zero. The units never come back onto the
-- shelf and are never taken twice. And the ledger says, in order, exactly
-- what happened to them -- which is the entire reason for having one.
--
-- Cancelling from either state releases whichever is outstanding, so an
-- order cancelled before confirmation gives back its reservation and one
-- cancelled after gives back its sale, with no special case for either.

create or replace function sync_order_stock_state(p_order_id uuid, p_state text)
returns void language plpgsql as $$
begin
  if p_state not in ('reserved', 'sold', 'released') then
    raise exception 'sync_order_stock_state: unknown state %', p_state;
  end if;

  with want as (
    -- What this order asks of each product, lines added up: the same
    -- product can appear twice under two sizes, and stock does not care
    -- about sizes.
    select (i->>'product_id')::uuid   as product_id,
           sum((i->>'qty')::int)::int as want,
           max(o.ref)                 as ref
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
       and exists (select 1 from products p where p.id = (i->>'product_id')::uuid)
     group by 1
  ),
  done as (
    -- Held and sold are summed apart, because the target for each is
    -- different in every state and netting them would make 'reserved' and
    -- 'sold' indistinguishable -- which is exactly the distinction the
    -- sweep in section 4 depends on.
    select m.product_id,
           sum(m.delta) filter (where m.reason = 'reservation')       as held,
           sum(m.delta) filter (where m.reason in ('sale','return'))  as sold
      from stock_movements m
     where m.order_id = p_order_id
     group by 1
  ),
  move as (
    select w.product_id,
           w.ref,
           (case when p_state = 'reserved' then -w.want else 0 end)
             - coalesce(d.held, 0) as need_hold,
           (case when p_state = 'sold' then -w.want else 0 end)
             - coalesce(d.sold, 0) as need_sale
      from want w
      left join done d on d.product_id = w.product_id
  ),
  rows_to_write as (
    select product_id, need_hold as delta, 'reservation'::text as reason, ref
      from move where need_hold <> 0
    union all
    select product_id, need_sale,
           case when need_sale < 0 then 'sale' else 'return' end, ref
      from move where need_sale <> 0
  )
  insert into stock_movements (product_id, delta, reason, order_id, note)
  select r.product_id, r.delta, r.reason, p_order_id,
         case
           when r.reason = 'reservation' and r.delta < 0
             then 'held for order ' || coalesce(r.ref, '')
           when r.reason = 'reservation'
             then 'hold released, order ' || coalesce(r.ref, '')
           when r.delta < 0 then 'order ' || coalesce(r.ref, '')
           else 'returned to stock, order ' || coalesce(r.ref, '')
         end
    from rows_to_write r;
end $$;

comment on function sync_order_stock_state is
  'Moves an order stock effect to one of three targets: reserved (held, not yet confirmed), sold, or released. Writes only the difference, so it is safe to call any number of times and in any order.';

-- The old two-argument form stays, delegating, so anything still calling it
-- keeps working and keeps meaning the same thing. Not dropped: a function
-- signature is an interface, and this file should not be able to break a
-- caller it has not been shown.
create or replace function sync_order_stock(p_order_id uuid, p_take boolean)
returns void language plpgsql as $$
begin
  perform sync_order_stock_state(p_order_id, case when p_take then 'sold' else 'released' end);
end $$;

comment on function sync_order_stock is
  'Legacy two-state wrapper around sync_order_stock_state(). p_take true means sold, false means released.';

-- ---------------------------------------------------------------------------
-- 3. Reserving, with the check and the write in one place
-- ---------------------------------------------------------------------------
-- THE POINT OF THIS FUNCTION IS THE LOCK. Everything else it does was
-- already being done in TypeScript; what could not be done there is holding
-- the product row still between deciding there is enough and taking it.
--
-- SELECT ... FOR UPDATE makes concurrent callers queue on the row rather
-- than all reading the same number. Two orders for the last unit therefore
-- resolve as one success and one refusal, in some order, instead of two
-- successes -- which is the whole finding.
--
-- Rows are locked in product_id order. Two orders containing the same two
-- products in opposite basket order would otherwise take the two locks in
-- opposite orders and deadlock; sorting makes that impossible rather than
-- unlikely.
--
-- Raises on insufficient stock, naming the product and what is actually
-- left, so the caller can put a real sentence in front of the buyer. The
-- raise aborts the whole function, so a basket that fails on its third line
-- leaves no hold behind from the first two.

create or replace function reserve_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_qty    int;
  v_name   text;
  v_out    boolean;
  v_pre    boolean;
begin
  -- A pre-order has no stock to hold -- that is what makes it a pre-order --
  -- and holding some would be the shop taking units it has already said it
  -- does not have.
  select coalesce(is_preorder, false) into v_pre from orders where id = p_order_id;
  if v_pre then return; end if;

  for r in
    select (i->>'product_id')::uuid   as product_id,
           sum((i->>'qty')::int)::int as want
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
     group by 1
     order by 1                      -- deadlock avoidance; see above
  loop
    select p.qty, p.name, p.stock_status = 'out'
      into v_qty, v_name, v_out
      from products p
     where p.id = r.product_id
     for update;                     -- the lock this function exists for

    if not found then
      raise exception 'A product in your basket is no longer available'
        using errcode = 'no_data_found';
    end if;

    -- An out-of-stock line in a non-pre-order basket should have been
    -- refused before the order was written. Reaching here means the product
    -- sold out between then and now, which is precisely the race.
    if v_out or r.want > v_qty then
      raise exception 'Only % left of "%"', greatest(v_qty, 0), v_name
        using errcode = 'check_violation';
    end if;
  end loop;

  -- Every row is locked and every line fits. Nothing else can take these
  -- units until this transaction ends.
  perform sync_order_stock_state(p_order_id, 'reserved');
end $$;

comment on function reserve_order_stock is
  'Locks each product row, verifies the whole basket fits, and holds the units. Raises with the product name if it does not. Called by RPC from placeOrder so the check and the write cannot be separated.';

revoke all on function reserve_order_stock(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The status trigger, taught the third state
-- ---------------------------------------------------------------------------
-- 'new' is now a state that HOLDS stock rather than one that does nothing.
-- Everything from 'confirmed' onward converts the hold into a sale, and
-- 'cancelled' releases whichever is outstanding.

create or replace function decrement_stock_on_confirm() returns trigger as $$
begin
  if coalesce(new.is_preorder, false) then return new; end if;

  if new.status = 'cancelled' then
    perform sync_order_stock_state(new.id, 'released');
  elsif new.status = 'new' then
    perform sync_order_stock_state(new.id, 'reserved');
  else
    perform sync_order_stock_state(new.id, 'sold');
  end if;

  return new;
end;
$$ language plpgsql;

comment on function decrement_stock_on_confirm is
  'Keeps an order stock effect in step with its status: new holds a reservation, live states hold a sale, cancelled holds nothing. products.qty is moved by apply_stock_movement(), never here.';

-- ---------------------------------------------------------------------------
-- 5. Giving back what was never confirmed
-- ---------------------------------------------------------------------------
-- A reservation with nothing behind it is worse than no reservation: it
-- takes a real unit off the shelf on behalf of somebody who has gone. An
-- order placed for cash-on-delivery and then abandoned would otherwise hold
-- its units until a human noticed, which is the same failure as the one
-- this file fixes, only slower.
--
-- So a hold has a lifetime. Anything still sitting at 'new' after
-- p_hours goes back on the shelf, and the order is cancelled with a reason
-- rather than left looking live with no stock behind it -- an order the shop
-- believes in and cannot fill is the state to avoid.
--
-- The window is a parameter and not a constant here because it is a
-- business decision (how long do you give somebody to pay by transfer?) and
-- belongs with whoever schedules the sweep. See
-- src/app/api/cron/release-reservations.

create or replace function release_stale_reservations(p_hours int default 48)
returns table (order_id uuid, order_ref text, released int)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_units int;
begin
  if p_hours is null or p_hours < 1 then
    raise exception 'release_stale_reservations: p_hours must be at least 1 (got %)', p_hours;
  end if;

  for r in
    select o.id, o.ref
      from orders o
     where o.status = 'new'
       and o.created_at < now() - make_interval(hours => p_hours)
       -- Only orders actually holding something. An order that never
       -- reserved (a pre-order, or one placed before this file was run)
       -- is not stale stock and is not this function's business.
       and exists (select 1 from stock_movements m
                    where m.order_id = o.id and m.reason = 'reservation')
       -- and still net-holding, rather than one already released by hand
       and coalesce((select sum(m.delta) from stock_movements m
                      where m.order_id = o.id and m.reason = 'reservation'), 0) < 0
     order by o.created_at
  loop
    select coalesce(-sum(m.delta), 0)::int into v_units
      from stock_movements m
     where m.order_id = r.id and m.reason = 'reservation';

    -- Cancelling fires the trigger in section 4, which releases the hold.
    -- Done through the status rather than by writing movements directly, so
    -- there is exactly one path that ends a reservation and the order does
    -- not survive as a live order with no stock behind it.
    update orders
       set status = 'cancelled',
           cancel_reason = coalesce(nullif(cancel_reason, ''),
             'Reservation expired: not confirmed within ' || p_hours || ' hours')
     where id = r.id;

    insert into order_log (order_id, text)
    values (r.id, 'Rezerva liu tempu (' || p_hours || 'h). Stok fila ba prateleira.');

    order_id := r.id; order_ref := r.ref; released := v_units;
    return next;
  end loop;
end $$;

comment on function release_stale_reservations is
  'Cancels orders left unconfirmed past p_hours and gives their held units back. Returns one row per order released.';

revoke all on function release_stale_reservations(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. What is being held right now
-- ---------------------------------------------------------------------------
-- The reconciliation view answers "does the ledger agree with the balance".
-- This answers the other question a shopkeeper asks: "how much of what I
-- appear not to have is actually just waiting on somebody to pay?"

create or replace view stock_reservations as
select m.order_id,
       o.ref,
       o.buyer_name,
       o.created_at,
       p.id                          as product_id,
       p.ref                         as product_ref,
       p.name                        as product_name,
       (-sum(m.delta))::int          as held,
       (now() - o.created_at)        as waiting
  from stock_movements m
  join orders   o on o.id = m.order_id
  join products p on p.id = m.product_id
 where m.reason = 'reservation'
 group by m.order_id, o.ref, o.buyer_name, o.created_at, p.id, p.ref, p.name
having sum(m.delta) < 0;

comment on view stock_reservations is
  'Units currently held by orders that have been placed and not yet confirmed. Empty is the healthy steady state for a shop that confirms promptly.';

revoke all on stock_reservations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Existing unconfirmed orders start holding their stock
-- ---------------------------------------------------------------------------
-- Without this, every order already sitting at 'new' when this file runs
-- would keep its units on the shelf forever -- the old behaviour, silently
-- preserved for exactly the orders most likely to be affected by it.
--
-- Runs with the balance trigger LIVE, on purpose: these holds have not been
-- applied to products.qty yet and should be. A balance that goes negative
-- here is not this file misbehaving, it is the oversell that had already
-- happened becoming visible, which is what the ledger is for.

do $$
declare o record; n int := 0;
begin
  for o in
    select id from orders
     where status = 'new'
       and not coalesce(is_preorder, false)
       and not exists (select 1 from stock_movements m
                        where m.order_id = orders.id and m.reason = 'reservation')
  loop
    perform sync_order_stock_state(o.id, 'reserved');
    n := n + 1;
  end loop;
  raise notice 'reservation backfill: % unconfirmed order(s) now holding stock', n;
end $$;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;   -- still nothing
--   select * from stock_reservations order by waiting desc; -- what is held
--
-- Until this file is run, placeOrder's RPC call finds no such function,
-- treats it as "this database does not reserve yet", and the shop behaves
-- exactly as it did before -- stock moving on confirmation, and the race
-- still open. There is no half-applied state.
-- ---------------------------------------------------------------------------


-- ==== returns.sql =======================================================

-- ===========================================================================
-- Loja AIAI -- returns and refunds
--
-- The system could take an order and cancel one. It could not accept goods
-- back. orders.pay_status has listed 'refunded' since the first schema and
-- nothing ever set it; stock_movements has allowed reason = 'return' since
-- the ledger was added and only a cancellation ever wrote one. So a customer
-- handing back a pair of shoes had nowhere to be recorded, the pair could
-- not go back on the shelf, and the money going out did not exist.
--
-- A return is its own document, not a flag on the order. One order can be
-- returned in parts, on different days, for different reasons, and only some
-- of what comes back is fit to sell again.
--
-- Safe to re-run. Run AFTER supabase/stock-ledger.sql.
-- ===========================================================================

create table if not exists order_returns (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  -- RET + year + last four of the phone + six random, the same shape as an
  -- order reference so the two can be read out over the same phone call.
  ref          text not null unique,
  reason       text not null check (reason in
                 ('damaged','wrong_item','not_as_described','changed_mind','other')),
  note         text not null default '',
  -- What is actually being handed back, in the order's currency. Stored
  -- rather than derived: a shop may refund the delivery fee, or not, or
  -- settle on a different figure at the counter, and next year nobody will
  -- remember which.
  refund_total numeric(12,2) not null default 0 check (refund_total >= 0),
  refunded_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists order_returns_order_idx on order_returns (order_id, created_at desc);

create table if not exists order_return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references order_returns(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  -- Copied, not joined: a return has to stay readable after a product is
  -- deleted, exactly as an order line does.
  product_name text not null default '',
  qty          int not null check (qty > 0),
  -- Damaged goods come back into the building but not onto the shelf. This
  -- is the difference between a return and a restock, and conflating them
  -- is how a shop ends up selling something it knows is broken.
  restock      boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists order_return_items_return_idx on order_return_items (return_id);

-- ---------------------------------------------------------------------------
-- Restocking goes through the ledger, like everything else
-- ---------------------------------------------------------------------------
-- Per line, not per return: one return can bring back two sellable shirts
-- and one broken lamp, and only the shirts are stock again.

create or replace function apply_return_restock() returns trigger
language plpgsql as $$
declare o_id uuid; r_ref text;
begin
  if not new.restock or new.product_id is null then return new; end if;

  select r.order_id, r.ref into o_id, r_ref
    from order_returns r where r.id = new.return_id;

  insert into stock_movements (product_id, delta, reason, order_id, note)
  values (new.product_id, new.qty, 'return', o_id,
          'returned on ' || coalesce(r_ref, ''));
  return new;
end $$;

drop trigger if exists trg_apply_return_restock on order_return_items;
create trigger trg_apply_return_restock
  after insert on order_return_items
  for each row execute function apply_return_restock();

comment on function apply_return_restock is
  'A returned line that is fit to sell goes back through the ledger, so products.qty still has exactly one writer.';

-- ---------------------------------------------------------------------------
-- The order's payment status follows what has been refunded
-- ---------------------------------------------------------------------------
-- Derived rather than typed, for the same reason stock status is: two people
-- maintaining one fact is how they come to disagree.

create or replace function sync_order_refund_status() returns trigger
language plpgsql as $$
declare o_id uuid; refunded numeric; order_total numeric;
begin
  o_id := coalesce(new.order_id, old.order_id);

  select coalesce(sum(r.refund_total), 0) into refunded
    from order_returns r where r.order_id = o_id;

  select o.total into order_total from orders o where o.id = o_id;

  update orders set pay_status = case
      when refunded <= 0 then pay_status
      -- Refunding everything is 'refunded'. Refunding part of it is still a
      -- deposit position: some money stayed with the shop.
      when refunded >= coalesce(order_total, 0) then 'refunded'
      else 'deposit'
    end
   where id = o_id;

  return null;
end $$;

drop trigger if exists trg_sync_order_refund on order_returns;
create trigger trg_sync_order_refund
  after insert or update or delete on order_returns
  for each row execute function sync_order_refund_status();

-- ---------------------------------------------------------------------------
-- Grants -- a return is admin-only, like purchasing
-- ---------------------------------------------------------------------------
alter table order_returns enable row level security;
alter table order_return_items enable row level security;
revoke all on order_returns from anon, authenticated;
revoke all on order_return_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;
-- Still nothing: a restocked return is a movement like any other.
-- ---------------------------------------------------------------------------


-- ==== return-requests.sql ===============================================

-- ===========================================================================
-- Loja AIAI -- a buyer can start a return
--
-- Run AFTER supabase/returns.sql.
--
-- Every return in this shop began with a phone call. The admin-side
-- machinery is all there and good -- over-return prevention, restock
-- straight into the ledger, a settlement queue that refuses to claim money
-- moved before it did -- and none of it could be reached by the person the
-- goods actually belong to. That is the largest remaining gap between this
-- and the platforms it competes with: not a missing feature, but that a
-- buyer cannot do anything on their own after they have paid.
--
-- A REQUEST IS NOT A RETURN. This table is deliberately separate from
-- order_returns rather than a status column on it, because the two are
-- different kinds of fact:
--
--   a request  is a buyer SAYING they want to send something back. It moves
--              no stock, refunds no money, and can be declined.
--   a return   is the shop RECORDING that goods came back. It writes to the
--              stock ledger and owes somebody money.
--
-- Folding them together would mean every existing reader of order_returns
-- -- the ledger trigger, the settlement queue, the refund arithmetic --
-- would have to learn to skip rows that are not really returns yet, and the
-- one that forgot would restock goods still sitting in a buyer's house.
--
-- Approving a request calls the SAME recordReturn() an admin has always
-- called. This adds a way in; it does not add a second way to do it.
--
-- Safe to re-run.
-- ===========================================================================

create table if not exists return_requests (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,

  -- RRQ + year + last four + six random, the same shape as an order
  -- reference so the two can be read out over the same phone call.
  ref          text not null unique,

  -- The same vocabulary order_returns uses. Not a superset and not a
  -- subset: a buyer and a shopkeeper describing the same parcel should
  -- reach for the same word, and approving a request copies this straight
  -- across.
  reason       text not null check (reason in
                 ('damaged','wrong_item','not_as_described','changed_mind','other')),
  note         text not null default '',

  status       text not null default 'open'
                 check (status in ('open','approved','declined','cancelled')),

  -- Why it was turned down, shown to the buyer on their tracking page. A
  -- decline with no reason is worse than no self-service at all: it teaches
  -- somebody that the button does nothing.
  decided_at   timestamptz,
  decided_by   text not null default '',
  decision_note text not null default '',

  -- The return this became, once approved. Null while open, and the link
  -- that lets the tracking page show what actually happened.
  return_id    uuid references order_returns(id) on delete set null,

  created_at   timestamptz not null default now()
);

create index if not exists return_requests_order_idx
  on return_requests (order_id, created_at desc);

-- The admin's "waiting on you" list, which is the only query that runs
-- often. Partial, because an answered request is history.
create index if not exists return_requests_open_idx
  on return_requests (created_at desc) where status = 'open';

-- ONE OPEN REQUEST PER ORDER. Without it, a buyer who taps twice on a slow
-- connection has two requests, an admin approves both, and the shop takes
-- back the same goods twice. The over-return check in recordReturn() would
-- catch the second one -- but it would catch it as an error message to an
-- admin, long after the confusion started.
create unique index if not exists return_requests_one_open_uq
  on return_requests (order_id) where status = 'open';

create table if not exists return_request_items (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references return_requests(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  -- Copied, not joined, for the same reason the order line is: a request
  -- has to stay readable after a product is deleted.
  product_name text not null default '',
  qty          int not null check (qty > 0)
);

create index if not exists return_request_items_request_idx
  on return_request_items (request_id);

comment on table return_requests is
  'A buyer asking to send something back. Not a return: it moves no stock and refunds nothing. Approving one calls recordReturn(). See supabase/return-requests.sql.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Reached only through server actions that have already proved ref + phone,
-- exactly like every other buyer-facing write in this shop. Nothing here is
-- readable with the anon key: a request names what somebody bought and how
-- much of it they are sending back.
alter table return_requests enable row level security;
alter table return_request_items enable row level security;
revoke all on return_requests from anon, authenticated;
revoke all on return_request_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Until this file is run, the buyer-facing form is not offered at all --
-- the action reports the table missing and the tracking page shows what it
-- always showed. Returns keep working; they just keep starting with a phone
-- call.
-- ---------------------------------------------------------------------------


-- ==== supplier-returns.sql ==============================================

-- ===========================================================================
-- Loja AIAI -- sending goods back to the supplier
--
-- Run AFTER supabase/procurement.sql and supabase/stock-reservation.sql.
-- Safe to re-run.
--
-- Goods could come back from a customer and could not go back to a supplier.
-- The shop could record that a pair of shoes arrived broken in a delivery --
-- supabase/receiving.sql has always let a receipt be short or damaged -- but
-- once the box had been received there was no document for "we sent it
-- back". So a carton of faulty stock either sat on the shelf as sellable
-- inventory, or was quietly adjusted away as if it had evaporated, and the
-- money the supplier owed for it was remembered by one person.
--
-- THIS IS NOT A CUSTOMER RETURN POINTING THE OTHER WAY. The two documents
-- share a shape and almost nothing else:
--
--   order_returns     goods arrive, stock goes UP, the shop owes money OUT.
--   supplier_returns  goods leave,  stock goes DOWN, money is owed INWARD
--                     and often as a credit note rather than cash.
--
-- The reasons differ too. A supplier cannot change their mind; a supplier
-- can over-deliver, and can send something already expired. Sharing one
-- vocabulary would have meant a list where half the options are wrong
-- whichever screen you are on.
-- ===========================================================================

create table if not exists supplier_returns (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references suppliers(id) on delete restrict,
  -- restrict, not cascade: the same reasoning purchase_orders uses. Deleting
  -- a supplier must not erase the record of a claim against them.

  -- The purchase order the goods arrived on, where it is known. Optional
  -- because stock predating procurement, or a sample that never had a PO,
  -- can still be faulty and still has to go back.
  po_id         uuid references purchase_orders(id) on delete set null,

  -- SRT + year + six random. Readable over a phone call, like an order
  -- reference and a customer return reference.
  ref           text not null unique,

  reason        text not null check (reason in
                  ('damaged','wrong_item','not_as_described',
                   'over_delivery','expired','other')),
  note          text not null default '',

  -- What the shop expects back, in `currency`, and what actually arrived.
  -- Two columns rather than one, because the gap between them is the whole
  -- point: a claim nobody chased is the reason this table exists.
  currency          text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  fx_rate           numeric(14,6) not null default 1 check (fx_rate > 0),
  credit_expected   numeric(14,2) not null default 0 check (credit_expected >= 0),
  credit_received   numeric(14,2) not null default 0 check (credit_received >= 0),
  -- Null until the money or the credit note actually lands. The same
  -- discipline supabase/refund-settlement.sql imposed on refunds going the
  -- other way: agreed is not settled, and a screen that conflates the two
  -- tells the shop it has money it does not have.
  credited_at       timestamptz,

  -- In USD, so a claim raised in euros can be added to one raised in
  -- dollars without every reader repeating the multiplication. Generated,
  -- so it cannot drift from the figures above.
  credit_expected_usd numeric(14,2)
    generated always as (round(credit_expected * fx_rate, 2)) stored,
  credit_received_usd numeric(14,2)
    generated always as (round(credit_received * fx_rate, 2)) stored,

  -- Where the parcel is. Deliberately short: the shop either still has the
  -- goods, has sent them, or the matter is closed one way or the other.
  status        text not null default 'draft' check (status in
                  ('draft','sent','credited','rejected','cancelled')),

  shipped_on    date,
  created_by    text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists supplier_returns_supplier_idx
  on supplier_returns (supplier_id, created_at desc);
create index if not exists supplier_returns_po_idx on supplier_returns (po_id);
-- The question the dashboard asks most: what is still owed to us.
create index if not exists supplier_returns_open_credit_idx
  on supplier_returns (created_at desc)
  where credited_at is null and status in ('draft','sent');

create table if not exists supplier_return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references supplier_returns(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  -- Copied, not joined, exactly as an order line and a purchase order line
  -- are: the document has to stay readable after a product is deleted.
  product_name  text not null default '',
  qty           numeric(14,3) not null check (qty > 0),
  -- What the shop paid for one, so the claim has a basis. Not read back
  -- from the product's current cost: that changes.
  unit_cost     numeric(14,4) not null default 0 check (unit_cost >= 0),

  -- Do these units leave the shelf?
  --
  -- The mirror image of order_return_items.restock, and it exists for the
  -- same reason. Goods quarantined on arrival were never received into
  -- stock, so sending them back must not decrement a balance they were
  -- never part of. Defaults true, because the ordinary case is faulty
  -- stock discovered after it was put away.
  from_stock    boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists supplier_return_items_return_idx
  on supplier_return_items (return_id);
create index if not exists supplier_return_items_product_idx
  on supplier_return_items (product_id);

-- ---------------------------------------------------------------------------
-- The ledger learns one more word
-- ---------------------------------------------------------------------------
-- Replaced rather than added to, so re-running this file is a no-op rather
-- than leaving two constraints saying subtly different things.

alter table stock_movements
  drop constraint if exists stock_movements_reason_check;

alter table stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('purchase_receipt','sale','adjustment','return',
                    'correction','reservation','supplier_return'));

comment on column stock_movements.reason is
  'purchase_receipt, sale, return (from a customer), supplier_return (back to a supplier), adjustment, correction, or reservation. See supabase/supplier-returns.sql.';

-- ---------------------------------------------------------------------------
-- Goods leaving go through the ledger, like everything else
-- ---------------------------------------------------------------------------
-- Per line, not per return: one parcel back to a supplier can hold two
-- faulty lamps that were on the shelf and one that was quarantined on
-- arrival, and only the two ever counted as stock.
--
-- On insert, because recording a supplier return IS the act of sending the
-- goods -- there is no separate "picked" step in this shop, and a document
-- that took stock out at some later click would leave the shelf wrong in
-- between.

create or replace function apply_supplier_return_stock() returns trigger
language plpgsql as $$
declare r_ref text;
begin
  if not new.from_stock or new.product_id is null then return new; end if;

  select r.ref into r_ref from supplier_returns r where r.id = new.return_id;

  insert into stock_movements (product_id, delta, reason, note)
  values (new.product_id, -new.qty, 'supplier_return',
          'returned to supplier on ' || coalesce(r_ref, ''));
  return new;
end $$;

drop trigger if exists trg_apply_supplier_return_stock on supplier_return_items;
create trigger trg_apply_supplier_return_stock
  after insert on supplier_return_items
  for each row execute function apply_supplier_return_stock();

comment on function apply_supplier_return_stock is
  'Units going back to a supplier leave through the ledger, so products.qty still has exactly one writer.';

-- ---------------------------------------------------------------------------
-- The status follows the credit, rather than being typed beside it
-- ---------------------------------------------------------------------------
-- The same discipline the order refund status follows: two people
-- maintaining one fact is how they come to disagree. A return that has been
-- paid in full is credited; one where the money landed short stays open,
-- because a partial credit is an unfinished argument, not a closed one.

create or replace function sync_supplier_return_status() returns trigger
language plpgsql as $$
begin
  if new.credited_at is not null
     and new.credit_received >= new.credit_expected
     and new.status in ('draft','sent') then
    new.status := 'credited';
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_supplier_return_status on supplier_returns;
create trigger trg_sync_supplier_return_status
  before insert or update on supplier_returns
  for each row execute function sync_supplier_return_status();

-- ---------------------------------------------------------------------------
-- Grants -- a claim against a supplier is admin-only, like purchasing
-- ---------------------------------------------------------------------------
alter table supplier_returns enable row level security;
alter table supplier_return_items enable row level security;
-- No policy at all: RLS with zero policies denies everyone, and the admin
-- pages reach these through the service-role client the way orders and
-- purchase orders already are.
--
-- Both revokes are needed. Supabase's default privileges grant every new
-- table to anon and authenticated DIRECTLY, and PUBLIC holds a separate
-- grant that those two inherit -- revoking one leaves the other standing.
revoke all on supplier_returns from public, anon, authenticated;
revoke all on supplier_return_items from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;
-- Still nothing: a supplier return is a movement like any other.
-- ---------------------------------------------------------------------------


-- ==== size-stock.sql ====================================================

-- ===========================================================================
-- Loja AIAI -- stock, per size
--
-- Run AFTER supabase/stock-reservation.sql and supabase/procurement.sql.
-- Safe to re-run.
--
-- THE SHOP HAS THIRTY T-SHIRTS AND CANNOT SAY HOW MANY ARE MEDIUM.
--
-- products.sizes has always been a list of labels -- S, M, L -- and
-- products.qty a single number for all of them together. So a shopper is
-- offered Large on a product with none left in Large, the shelf runs out of
-- one size while the reorder alert stays quiet because the total still looks
-- healthy, and nobody can answer "how many Medium do we have" without going
-- to look.
--
-- WHAT THIS DOES NOT DO: invent a split for the stock already on the shelf.
-- The database does not know how those thirty shirts divide, and guessing
-- would put fabricated inventory in front of somebody ordering from it.
-- Existing stock stays UNSIZED, which is an honest third state, and the shop
-- converts it by counting -- see section 6.
--
-- THE SHAPE. stock_movements gains a size, and that is the whole mechanism:
-- the ledger already is the truth and products.qty already is its running
-- total. Per-size balances are the same sum grouped one column further, so
--
--   * products.qty keeps meaning exactly what it meant, and every screen,
--     view and trigger that reads it keeps working untouched;
--   * history stays reconstructable, per size, back to the first movement;
--   * there is still exactly ONE writer of stock.
--
-- A separate per-size table would have been a second source of truth, and
-- the two would have disagreed the first time anything failed midway.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The ledger learns the size
-- ---------------------------------------------------------------------------
-- '' rather than null for "no size", and the column is NOT NULL. A nullable
-- size would make every aggregate below need `is not distinct from`, and one
-- forgotten `= ''` would silently split a product's stock into two piles.
-- Empty string is one value that groups, compares and indexes like any other.

alter table stock_movements
  add column if not exists size text not null default '';

comment on column stock_movements.size is
  'Which size this movement is of, or '''' for goods that have no size (a fridge) and for stock counted before sizes were tracked. See supabase/size-stock.sql.';

-- The question every screen below asks: what is the balance of this product
-- in this size.
create index if not exists stock_movements_product_size_idx
  on stock_movements (product_id, size);

-- ---------------------------------------------------------------------------
-- 2. What is on the shelf, per size
-- ---------------------------------------------------------------------------
-- A view, not a table. It is a GROUP BY over the ledger, so it cannot drift
-- from the ledger, cannot be written to by mistake, and needs no trigger to
-- keep it honest.

create or replace view product_size_stock as
  select m.product_id,
         m.size,
         sum(m.delta)::int as qty
    from stock_movements m
   group by m.product_id, m.size;

comment on view product_size_stock is
  'Balance per product per size, summed from the ledger. size = '''' is stock with no size recorded -- either goods that have none, or stock counted before sizes were tracked.';

-- security_invoker so the view cannot be a way around the caller's own
-- permissions on stock_movements, which anon has none of.
alter view product_size_stock set (security_invoker = on);
revoke all on product_size_stock from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What a shopper may take
-- ---------------------------------------------------------------------------
-- THE RULE, and the reason it is not simply "the balance for that size":
--
--   available(product, size) = balance(size) + balance('')
--
-- Unsized stock is not stock of no size; it is stock whose size nobody has
-- recorded. Thirty shirts counted before this file existed can still be sold
-- as Medium, because some of them are Medium. So the unsized pool backs
-- every size, and a shop that has never tracked sizes behaves exactly as it
-- did yesterday -- which is the only acceptable behaviour on the day this
-- runs.
--
-- The TOTAL check in reserve_order_stock stays as well, and both must pass.
-- Together they can only ever refuse more than before, never allow more,
-- which is the safe direction for the one function standing between this
-- shop and overselling.

create or replace function size_available(p_product_id uuid, p_size text)
returns int language sql stable as $$
  select coalesce(sum(m.delta) filter (
           where m.size = coalesce(p_size, '') or m.size = ''), 0)::int
    from stock_movements m
   where m.product_id = p_product_id;
$$;

comment on function size_available is
  'Units of one size a shopper may take: that size plus the unsized pool, which is stock whose size was never recorded and could be any of them.';

revoke all on function size_available(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Holding and selling the right size
-- ---------------------------------------------------------------------------
-- sync_order_stock_state grouped by product and said so in a comment:
-- "the same product can appear twice under two sizes, and stock does not
-- care about sizes". It does now. Grouping one column further is the whole
-- change; the reconciliation logic underneath -- write only the difference,
-- so calling it twice is harmless -- is untouched.

create or replace function sync_order_stock_state(p_order_id uuid, p_state text)
returns void language plpgsql as $$
begin
  if p_state not in ('reserved', 'sold', 'released') then
    raise exception 'sync_order_stock_state: unknown state %', p_state;
  end if;

  with want as (
    -- Per product AND per size. Two lines of the same shirt in M and L are
    -- two rows here, and each moves its own size's balance.
    select (i->>'product_id')::uuid        as product_id,
           coalesce(i->>'size', '')        as size,
           sum((i->>'qty')::int)::int      as want,
           max(o.ref)                      as ref
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
       and exists (select 1 from products p where p.id = (i->>'product_id')::uuid)
     group by 1, 2
  ),
  done as (
    select m.product_id,
           m.size,
           sum(m.delta) filter (where m.reason = 'reservation')       as held,
           sum(m.delta) filter (where m.reason in ('sale','return'))  as sold
      from stock_movements m
     where m.order_id = p_order_id
     group by 1, 2
  ),
  move as (
    select w.product_id,
           w.size,
           w.ref,
           (case when p_state = 'reserved' then -w.want else 0 end)
             - coalesce(d.held, 0) as need_hold,
           (case when p_state = 'sold' then -w.want else 0 end)
             - coalesce(d.sold, 0) as need_sale
      from want w
      left join done d
        on d.product_id = w.product_id and d.size = w.size
  ),
  rows_to_write as (
    select product_id, size, need_hold as delta, 'reservation'::text as reason, ref
      from move where need_hold <> 0
    union all
    select product_id, size, need_sale,
           case when need_sale < 0 then 'sale' else 'return' end, ref
      from move where need_sale <> 0
  )
  insert into stock_movements (product_id, size, delta, reason, order_id, note)
  select r.product_id, r.size, r.delta, r.reason, p_order_id,
         case
           when r.reason = 'reservation' and r.delta < 0
             then 'held for order ' || coalesce(r.ref, '')
           when r.reason = 'reservation'
             then 'hold released, order ' || coalesce(r.ref, '')
           when r.delta < 0 then 'order ' || coalesce(r.ref, '')
           else 'returned to stock, order ' || coalesce(r.ref, '')
         end
    from rows_to_write r;
end $$;

comment on function sync_order_stock_state is
  'Moves an order stock effect to one of three targets: reserved, sold, or released -- per product AND per size. Writes only the difference, so it is safe to call any number of times and in any order.';

-- ---------------------------------------------------------------------------
-- 5. Refusing a size that is not there
-- ---------------------------------------------------------------------------
-- The total check is kept exactly as it was and a per-size one added beside
-- it. Both must pass. On a shop with no sizes recorded the second is vacuous
-- (the unsized pool backs every size, so it equals the total), which is what
-- makes this safe to run on a live database in the middle of a trading day.

create or replace function reserve_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_qty    int;
  v_name   text;
  v_out    boolean;
  v_pre    boolean;
  v_avail  int;
begin
  select coalesce(is_preorder, false) into v_pre from orders where id = p_order_id;
  if v_pre then return; end if;

  -- THE PRODUCT ROW IS STILL LOCKED ONCE PER PRODUCT, not once per size.
  -- Locking per size would let two baskets for two sizes of the same shirt
  -- pass the total check at the same time and oversell it between them --
  -- which is the exact race the lock exists to close.
  for r in
    select (i->>'product_id')::uuid   as product_id,
           sum((i->>'qty')::int)::int as want
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
     group by 1
     order by 1                      -- deadlock avoidance
  loop
    select p.qty, p.name, p.stock_status = 'out'
      into v_qty, v_name, v_out
      from products p
     where p.id = r.product_id
     for update;

    if not found then
      raise exception 'A product in your basket is no longer available'
        using errcode = 'no_data_found';
    end if;

    if v_out or r.want > v_qty then
      raise exception 'Only % left of "%"', greatest(v_qty, 0), v_name
        using errcode = 'check_violation';
    end if;
  end loop;

  -- Now the sizes, under the locks taken above.
  for r in
    select (i->>'product_id')::uuid   as product_id,
           coalesce(i->>'size', '')   as size,
           sum((i->>'qty')::int)::int as want
      from orders o
      cross join lateral jsonb_array_elements(o.items) i
     where o.id = p_order_id
       and nullif(i->>'product_id', '') is not null
       and coalesce((i->>'qty')::int, 0) > 0
     group by 1, 2
     order by 1, 2
  loop
    -- An unsized line on a product the shop tracks by size is not checked
    -- against any particular size -- there is none to check -- and the
    -- total check above already covered it.
    if r.size = '' then continue; end if;

    select size_available(r.product_id, r.size) into v_avail;
    select p.name into v_name from products p where p.id = r.product_id;

    if r.want > v_avail then
      raise exception 'Only % left of "%" in size %', greatest(v_avail, 0), v_name, r.size
        using errcode = 'check_violation';
    end if;
  end loop;

  /* AND THEN ACTUALLY HOLD THEM.
   *
   * This line was in stock-reservation.sql's version and was lost when this
   * file replaced it to add the per-size check above. Checking without
   * holding is not a reservation: the check passes, nothing is written, the
   * lock is dropped at commit, and the next shopper passes the same check
   * against the same unit. Two orders for the last shirt were both accepted
   * and both confirmed, and the shelf went to -1 -- the exact oversell the
   * lock four screens up exists to prevent.
   *
   * It must stay INSIDE this function and after the loops, so it runs under
   * the row locks taken above. Writing the hold from anywhere else would
   * put it outside them, which is the same race wearing a different hat. */
  perform sync_order_stock_state(p_order_id, 'reserved');
end $$;

comment on function reserve_order_stock is
  'Locks each product row, verifies the basket fits BOTH the product total and each size, and holds the units. Raises with the product name, and the size when it is a size that ran out.';

revoke all on function reserve_order_stock(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Buying by size
-- ---------------------------------------------------------------------------
-- A purchase order line already carries a free-text `sizes` ("S, M, L"),
-- which says which sizes the product will HAVE and not how many of each.
-- This is how many of each.
--
-- jsonb rather than a child table: the line already owns its sizes as one
-- field, the object is written and read whole, and a child table would add a
-- join to every purchasing screen to hold what is always exactly one small
-- map. {"S": 5, "M": 10, "L": 15}.
--
-- qty stays the line's total and stays the number the money is calculated
-- from. The breakdown has to agree with it; the application adds the
-- breakdown up and writes the result into qty rather than trusting somebody
-- to keep two fields in step.

alter table purchase_order_items
  add column if not exists size_qty jsonb not null default '{}'::jsonb;

comment on column purchase_order_items.size_qty is
  'How many of each size this line buys, e.g. {"S":5,"M":10,"L":15}. Empty for goods with no sizes. Sums to qty -- see lib/sizeStock.ts.';

-- ---------------------------------------------------------------------------
-- 6b. Receiving the same line once PER SIZE
-- ---------------------------------------------------------------------------
-- stock_movements_receipt_once is unique on po_item_id alone. That is what
-- makes receiving idempotent -- a second click is rejected by Postgres
-- rather than by a check the application has to remember to do -- and it is
-- exactly wrong now: a line buying 5 S, 10 M and 15 L writes THREE
-- movements, and the old index would accept the first and reject the other
-- two. The shop would receive five shirts and believe it had thirty.
--
-- Replaced, not added to: two overlapping unique indexes would both have to
-- be satisfied, and the old one would still reject the second size.
--
-- The guarantee is unchanged in the case it was written for -- one receipt
-- per line per size, and an unsized line has exactly one size ('') so it is
-- still once per line.

drop index if exists stock_movements_receipt_once;

create unique index if not exists stock_movements_receipt_once
  on stock_movements (po_item_id, size)
  where reason = 'purchase_receipt' and po_item_id is not null;

comment on index stock_movements_receipt_once is
  'Receiving is idempotent per purchase-order line PER SIZE. A second receipt of the same line and size is rejected by Postgres, not by a check-then-insert that two concurrent clicks could both pass.';

-- ---------------------------------------------------------------------------
-- 7. Who the goods are for, decided when they are bought
-- ---------------------------------------------------------------------------
-- products.audience (men / women / unisex / unset) is set by hand in the
-- catalog today, which means every product created by receiving a purchase
-- order arrives unlabelled and has to be edited afterwards -- a second job,
-- done from memory, on a product whose buyer already knew the answer when
-- they ordered it.
--
-- Recorded on the LINE rather than on the order: one delivery routinely
-- carries men's and women's stock, and forcing a whole purchase order to be
-- one or the other would just move the re-editing somewhere else.
--
-- Null means "not said", which is also what it means on products: a fridge
-- is not unisex, it is simply not a question that applies. See
-- src/lib/audience.ts, which has documented that distinction since the
-- filter shipped.

alter table purchase_order_items
  add column if not exists audience text
    check (audience is null or audience in ('men','women','unisex'));

comment on column purchase_order_items.audience is
  'Who the goods on this line are for. Copied onto the product at receipt so the catalog does not have to be edited afterwards. Null = not said, which is not the same as unisex.';

-- ---------------------------------------------------------------------------
-- Done.
--
-- Verify with:
--   select * from stock_reconciliation where drift <> 0;
-- Still nothing: a sized movement is a movement like any other, and
-- products.qty is still the sum of all of them.
--
--   select p.name, s.size, s.qty
--     from product_size_stock s join products p on p.id = s.product_id
--    order by p.name, s.size;
-- Everything will read size '' until the shop counts its shelves in, which
-- is correct: nothing here invented a split for stock it cannot see.
-- ---------------------------------------------------------------------------


-- ==== zone-cleanup.sql ==================================================

-- ===========================================================================
-- Loja AIAI -- delivery zones the shop has a name for
--
-- Run AFTER supabase/schema.sql. Safe to re-run.
--
-- WHAT WAS ON THE CHECKOUT. Four delivery options, three of them called
-- "zone_z1", "zone_z2" and "zone_z3" -- raw i18n keys, shown to shoppers as
-- if they were places, with real prices beside them.
--
-- HOW. The application names a zone by looking up t("zone_" + id), and t()
-- returns the key when it does not recognise it. supabase/seed.sql wrote
-- zones with the ids z1, z2 and z3, so every shop that ran the seed had
-- three entries nothing could name. The checkout iterated settings.zones
-- and offered all of them; the admin editor iterated a hardcoded list of
-- the three REAL ids, so it could not see the junk -- and, worse, it
-- patched the stored array rather than replacing it, so every save carried
-- the junk forward. There was no sequence of clicks that fixed it.
--
-- The code half is lib/zones.ts: one canonical list, read by the checkout,
-- the settings screen and the save action alike. This is the data half --
-- for a shop that will not have its settings touched today, and so that a
-- database is correct the moment the migration runs rather than the next
-- time somebody happens to open a form.
--
-- ONLY THE THREE THE APPLICATION CAN NAME. An id outside that set has no
-- label in any of the three languages, so it cannot be offered; keeping it
-- would be keeping the bug.
-- ---------------------------------------------------------------------------

do $$
declare
  before_ids text;
  after_ids  text;
begin
  select string_agg(z->>'id', ', ' order by z->>'id')
    into before_ids
    from settings s, jsonb_array_elements(s.zones) z
   where s.id = 1;

  update settings s set zones = (
    select coalesce(jsonb_agg(zone order by zone.ord), '[]'::jsonb)
      from (
        select
          -- Rebuilt rather than filtered, so the shape is right even for a
          -- row that was missing a zone entirely: three entries, in order,
          -- carrying whatever fee and quote flag was already recorded.
          jsonb_build_object(
            'id', want.id,
            'fee', coalesce((have.z->>'fee')::numeric, 0),
            'quote', coalesce((have.z->>'quote')::boolean, false)
          ) as zone,
          want.ord
        from (values
                ('dili_center', 1),
                ('dili_outskirts', 2),
                ('other_municipality', 3)
             ) as want(id, ord)
        left join lateral (
          select z from jsonb_array_elements(s.zones) z
           where z->>'id' = want.id
           limit 1
        ) have on true
      ) zone
  )
  where s.id = 1;

  select string_agg(z->>'id', ', ' order by z->>'id')
    into after_ids
    from settings s, jsonb_array_elements(s.zones) z
   where s.id = 1;

  if before_ids is distinct from after_ids then
    raise notice 'zones: % -> %', coalesce(before_ids, '(none)'), coalesce(after_ids, '(none)');
  else
    raise notice 'zones: already correct (%)', coalesce(after_ids, '(none)');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Done. Verify with:
--
--   select jsonb_pretty(zones) from settings where id = 1;
--
-- Exactly three entries, ids dili_center / dili_outskirts /
-- other_municipality, and no "name" field -- the label comes from the
-- application's own translations, which is why an id it does not know
-- cannot be displayed.
-- ---------------------------------------------------------------------------


-- ==== operating-costs.sql ===============================================

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


-- ==== refund-settlement.sql =============================================

-- ===========================================================================
-- Loja AIAI -- the database stops claiming a refund that has not happened
--
-- WHAT WAS WRONG. recordReturn() wrote a refund_total, restocked the goods
-- and let a trigger set orders.pay_status = 'refunded'. For cash, a bank
-- transfer or a wallet that is true: the person recording the return is the
-- same person handing the money back, at the same counter, in the same
-- minute.
--
-- For a CARD it is not true at all. Nothing in this application can move
-- money at the acquirer -- the PaymentProvider interface has createCheckout,
-- verifyWebhook, parseEvent and fetchStatus, and no refund. So the row said
-- the buyer had been refunded while their money was still with BNCTL, and
-- the only thing standing between that and a real complaint was somebody
-- remembering to open the gateway portal, with nothing anywhere prompting
-- them.
--
-- THE FIX IS TO BELIEVE refunded_at AND NOTHING ELSE. The column already
-- exists and already means "the money moved". This makes the trigger read
-- it, so a return whose money has not moved no longer rewrites the order's
-- payment status. The application stamps it immediately for the methods a
-- person settles by hand, and leaves it null for card until the owner says
-- otherwise (see markRefundSettled in src/lib/actions/returns.ts).
--
-- Safe to re-run. Run AFTER supabase/returns.sql.
-- ===========================================================================

create or replace function sync_order_refund_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o_id uuid;
  refunded numeric;
  order_total numeric;
begin
  o_id := coalesce(new.order_id, old.order_id);

  -- ONLY SETTLED REFUNDS COUNT. A return sitting with refunded_at null is a
  -- decision recorded, not money moved -- the goods may already be back on
  -- the shelf, and that is a separate fact the ledger keeps separately.
  select coalesce(sum(r.refund_total), 0) into refunded
    from order_returns r
   where r.order_id = o_id and r.refunded_at is not null;

  select o.total into order_total from orders o where o.id = o_id;

  update orders set pay_status = case
      when refunded <= 0 then pay_status
      -- Refunding everything is 'refunded'. Refunding part of it is still a
      -- deposit position: some money stayed with the shop.
      when refunded >= coalesce(order_total, 0) then 'refunded'
      else 'deposit'
    end
   where id = o_id;

  return null;
end $$;

-- The trigger itself is unchanged and already fires on insert, update and
-- delete -- which is what makes stamping refunded_at later re-run this and
-- move the order's status then.
drop trigger if exists trg_sync_order_refund on order_returns;
create trigger trg_sync_order_refund
  after insert or update or delete on order_returns
  for each row execute function sync_order_refund_status();

-- ---------------------------------------------------------------------------
-- The index behind the admin's "refunds not yet paid" list.
--
-- Partial, and narrow on purpose: the question is only ever "which returns
-- owe money that has not moved", which is a handful of rows in a table that
-- otherwise only grows. It is also what the schema-health panel probes for
-- to know this file has been run -- the trigger function above cannot serve
-- that purpose, because supabase/returns.sql creates one of the same name
-- and an owner who had run only that would be told they were up to date.
-- ---------------------------------------------------------------------------
create index if not exists order_returns_unsettled_idx
  on order_returns (created_at desc)
  where refunded_at is null and refund_total > 0;

comment on column order_returns.refunded_at is
  'When the money actually moved. Null means the refund is agreed and not yet paid -- which for a card order means nobody has done it at the gateway yet. Only settled returns move orders.pay_status.';

-- ---------------------------------------------------------------------------
-- Done. On a database where this has not been run, the old trigger still
-- counts every return as settled -- the behaviour being fixed -- and the
-- admin's "refunds to settle" list still shows the card returns that are
-- waiting, because that list reads refunded_at directly rather than
-- inferring it from pay_status.
-- ---------------------------------------------------------------------------

-- Same rule as the rest: a trigger function is nobody's to call directly.
revoke all on function sync_order_refund_status() from public, anon, authenticated;


-- ==== sales.sql =========================================================

-- ===========================================================================
-- sales.sql — what the sales management dashboard needs and the schema
--             did not already have.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor -> New query.
--
-- Three things are added, and nothing existing is changed:
--
--   1. product_costs   unit cost per product, so gross profit and margin
--                      can be computed at all.
--   2. orders          expected_delivery / delivered_at / invoiced_at, so
--                      delivery lateness and invoicing are answerable.
--   3. sales_targets   a target per period, so "are we on track" has an
--                      answer instead of a shrug.
--
-- WHY COST LIVES IN ITS OWN TABLE, not as products.cost_price
-- -----------------------------------------------------------
-- `products` is readable with the browser's anon key -- that is the whole
-- storefront. In Postgres a table-level `grant select on products` covers
-- every column, INCLUDING ones added later, so a cost_price column on
-- products would be readable by anyone who opens the site and reads the
-- network tab. Purchase cost is the single most commercially sensitive
-- number a shop has. A separate table with no anon grant cannot leak that
-- way, whatever a future migration does to products.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Unit cost
-- ---------------------------------------------------------------------------

create table if not exists product_costs (
  product_id  uuid primary key references products(id) on delete cascade,
  -- What one unit costs the store to acquire. Excludes delivery to the
  -- buyer: that is charged separately as `fee` and is not part of COGS.
  cost_price  numeric(12,2) not null check (cost_price >= 0),
  note        text not null default '',
  updated_at  timestamptz not null default now()
);

comment on table product_costs is
  'Unit acquisition cost per product. Service-role only -- never exposed to anon.';

alter table product_costs enable row level security;

-- No policies at all, plus an explicit revoke. RLS with zero policies
-- already denies everything to anon/authenticated; the revoke is the second,
-- independent lock, so forgetting one does not open the door. The service
-- role bypasses RLS, which is how the admin pages read it.
revoke all on product_costs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Delivery and invoice dates on orders
-- ---------------------------------------------------------------------------
-- Dates, not timestamps: an order is promised for a DAY. A timestamp here
-- only ever produces off-by-one bugs across time zones -- the same reasoning
-- as purchase_orders.order_date in procurement.sql.

alter table orders add column if not exists expected_delivery date;
alter table orders add column if not exists delivered_at      date;
alter table orders add column if not exists invoiced_at       date;

comment on column orders.expected_delivery is
  'The day the buyer was promised delivery. NULL = never promised a date, which is why lateness reads "unknown" rather than "on time".';
comment on column orders.delivered_at is
  'The day it actually reached the buyer. Set automatically on the first move into arrived/completed.';

-- Stamp the delivery day automatically on the first transition into a
-- delivered state, so history fills in from normal admin work rather than
-- needing anyone to remember. Only ever writes when the column is still
-- empty: a hand-corrected date is never overwritten by a later status
-- change, and re-running this migration cannot rewrite past orders.
create or replace function orders_stamp_fulfilment() returns trigger
language plpgsql as $$
begin
  if new.status in ('arrived', 'completed') and new.delivered_at is null then
    new.delivered_at := current_date;
  end if;
  if new.status = 'completed' and new.invoiced_at is null then
    new.invoiced_at := current_date;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_stamp_fulfilment on orders;
create trigger trg_orders_stamp_fulfilment
  before insert or update of status on orders
  for each row execute function orders_stamp_fulfilment();

-- ---------------------------------------------------------------------------
-- 3. Sales targets
-- ---------------------------------------------------------------------------

create table if not exists sales_targets (
  id         uuid primary key default gen_random_uuid(),
  -- '2026' (year), '2026-Q3' (quarter) or '2026-08' (month). One text column
  -- rather than period_type + period_number: the format IS the type, the
  -- check constraint enforces it, and it sorts correctly as plain text.
  period     text not null check (period ~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$'),
  scope      text not null default 'global'
             check (scope in ('global', 'category', 'seller', 'municipality')),
  -- Empty for a global target; a category id, seller id or municipality
  -- name otherwise. Deliberately NOT a foreign key: a target set against a
  -- category that is later deleted should keep reporting its history rather
  -- than vanish or block the delete.
  scope_id   text not null default '',
  amount     numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (period, scope, scope_id)
);

comment on table sales_targets is
  'Revenue target per period and scope. Service-role only.';

alter table sales_targets enable row level security;
revoke all on sales_targets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- The dashboard reads the whole order book and aggregates in the
-- application (a store's history is small, and it means one round trip
-- instead of a dozen). These support the ordinary admin list views that
-- filter by date and status.

create index if not exists orders_created_at_idx    on orders (created_at desc);
create index if not exists orders_status_idx        on orders (status);
create index if not exists orders_delivered_at_idx  on orders (delivered_at)
  where delivered_at is not null;
create index if not exists sales_targets_period_idx on sales_targets (period);

-- ---------------------------------------------------------------------------
-- Done.
--
-- Until a cost is entered for at least one product, every profit and margin
-- panel on the dashboard says so plainly and shows no number. That is
-- deliberate: a margin computed against an assumed cost of zero would read
-- as 100% margin on everything, which is worse than no number at all.
-- ---------------------------------------------------------------------------


-- ==== promotions.sql ====================================================

-- ===========================================================================
-- promotions.sql — homepage promo tiles ("Oportunidades aos melhores preços")
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- ===========================================================================

create table if not exists promotions (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null default current_seller_id(),
  title       text not null,               -- "Som", "Cuidado Pessoal"
  badge_label text not null default '',    -- "-55%", "Novo", left blank = no badge
  image_url   text not null,
  -- Where the tile sends a visitor. A category slug is the common case
  -- (this is a merchandising shortcut into the existing catalog, not a
  -- second product system), but a free path also covers "/shop?sort=low"
  -- style links.
  href        text not null default '/shop',
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_promotions_active_sort on promotions(active, sort_order);

alter table promotions enable row level security;

drop policy if exists promotions_public_read on promotions;
create policy promotions_public_read on promotions for select using (active = true);
-- No public insert/update/delete: every write goes through the admin
-- server action using the service-role client, same trust model as
-- hero_slides and categories.

-- Reuses the existing public "product-images" bucket (see uploadHeroImage
-- in lib/actions/hero.ts) under a "promotions/" prefix rather than a new
-- bucket + policy set for what is still just "an image the admin uploaded".


-- ==== hero-video.sql ====================================================

-- ===========================================================================
-- Loja AIAI -- a hero slide that can be a VIDEO, not only a photo
--
-- One column. A slide with a non-empty video_url plays as a muted, looping
-- background video; every other slide stays exactly what it was, a photo.
--
-- WHY NOT A media_type COLUMN. A "type" column and a URL column can
-- disagree -- type='video' with an empty video_url renders nothing, and
-- nothing on any screen says why. The URL alone cannot: it either names a
-- file or it does not, and that single fact decides how the slide renders.
--
-- image_url KEEPS ITS MEANING on a video slide: it is the POSTER, the
-- still frame shown while the video loads and on any connection that will
-- not play it. That matters here more than most places -- this shop is
-- built for mobile data in Timor-Leste, and a visitor who never downloads
-- the video must still see a hero, not a black rectangle. It is allowed to
-- be empty ('' -- the column is NOT NULL but has no content requirement),
-- in which case the player simply starts dark.
--
-- Safe to re-run.
-- ===========================================================================

alter table hero_slides
  add column if not exists video_url text not null default '';

comment on column hero_slides.video_url is
  'MP4/WebM/MOV URL. Empty means this slide is a photo. When set, image_url is the poster frame shown until the video plays.';

-- ---------------------------------------------------------------------------
-- HOW THE PICTURE SITS IN THE FRAME.
--
-- The hero is one shape on a phone (portrait) and a very different one on
-- a desktop (a wide band). Anything filmed or photographed on a phone --
-- which is everything this shop will ever put here -- is portrait, and
-- filling a wide band with it means throwing most of it away: the reported
-- symptom was a desktop hero showing a horizontal slice of sky while the
-- phone showed the whole thing.
--
-- 'contain' shows the WHOLE picture, always, whatever shape the frame is.
-- It is the default because a picture nobody cropped is the one the owner
-- actually took.
--
-- 'cover' fills the frame edge to edge and crops whatever does not fit.
-- It stays available because it is right for genuinely wide material,
-- where 'contain' would leave bars for nothing.
--
-- media_fit, NOT video_fit, WHICH IS WHAT THIS WAS CALLED FIRST. It was
-- added for videos and then asked to govern photo slides too, and a column
-- named after one of the two things it decides is a column that lies to
-- the next person reading the table. The rename below carries any value
-- the old name already held, so it does not matter whether this file has
-- been run before or not.
--
-- A CHECK rather than an enum: two values that the app reads as a string,
-- and a constraint says which two. An enum would need its own migration to
-- gain a third.
-- ---------------------------------------------------------------------------

alter table hero_slides
  add column if not exists media_fit text not null default 'contain';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'hero_slides' and column_name = 'video_fit') then
    -- Whatever the earlier name was holding is what the slide meant.
    update hero_slides set media_fit = video_fit
      where video_fit in ('contain', 'cover');
    -- Its own CHECK goes with it.
    alter table hero_slides drop column video_fit;
  end if;
end $$;

do $$
begin
  alter table hero_slides
    add constraint hero_slides_media_fit_ck check (media_fit in ('contain', 'cover'));
exception
  when duplicate_object then null;   -- already applied; this file re-runs
end $$;

comment on column hero_slides.media_fit is
  'contain = show the whole photo or video, letterboxed. cover = fill the frame and crop.';

-- ---------------------------------------------------------------------------
-- Nothing to grant.
--
-- hero_slides is read through the hero_slides_public_read policy in
-- schema.sql, which is `using (true)` over the whole row -- unlike
-- `settings`, no column-level grant list exists on this table to add the
-- new column to. It is public catalog content by design: it is the
-- homepage.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Done.
--
-- Upload a video in /admin/hero. Videos are uploaded straight from the
-- browser to Storage with a one-time signed URL issued by the server (see
-- src/lib/actions/hero.ts) rather than through a Server Action: a Server
-- Action carries its payload in the request body, which is capped at a
-- couple of megabytes, and no useful video fits in that.
-- ---------------------------------------------------------------------------


-- ==== legal-currency-tax.sql ============================================

-- ---------------------------------------------------------------------------
-- The shop's own legal facts, a display currency, and tax on an order
-- ---------------------------------------------------------------------------
-- Three things that look unrelated and are the same kind of change: values
-- the SHOP must state, which the application had been hardcoding, guessing
-- or leaving as a marker on a public page.
--
-- Safe to re-run. Every statement is add-if-missing.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The five facts the policy pages could not know
-- ---------------------------------------------------------------------------
-- terms, privacy and returns carried FILL IN markers, live, on the public
-- site. They are not text somebody forgot to write: they are facts about
-- THIS business that no author could supply -- where it trades from, what it
-- is registered as, and the three periods it chooses to commit to.
--
-- So they become settings. The owner states them once, the policies read
-- them, and the "this policy is a draft" notice keeps showing until they
-- have. Filling a number in for them would have been the one genuinely
-- dangerous option: a policy that states a refund window the shop never
-- agreed to is a promise it did not make.
alter table settings
  add column if not exists legal_address          text not null default '',
  add column if not exists legal_registration     text not null default '',
  add column if not exists legal_retention_years  int,
  add column if not exists legal_return_days      int,
  add column if not exists legal_refund_days      int;

comment on column settings.legal_address is
  'Trading address, as it should appear on the terms page. Empty means the page still shows its unfinished-policy notice.';
comment on column settings.legal_registration is
  'Business registration as the shop is registered, for the terms page.';
comment on column settings.legal_retention_years is
  'How many years order records are kept before deletion. Null means not yet decided.';
comment on column settings.legal_return_days is
  'Days after delivery within which a buyer may ask to return. Null means not yet decided.';
comment on column settings.legal_refund_days is
  'Days after the goods come back within which the refund is made. Null means not yet decided.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_legal_periods_check') then
    alter table settings add constraint settings_legal_periods_check check (
      (legal_retention_years is null or legal_retention_years between 1 and 99) and
      (legal_return_days     is null or legal_return_days     between 1 and 365) and
      (legal_refund_days     is null or legal_refund_days     between 1 and 365));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A display currency
-- ---------------------------------------------------------------------------
-- Timor-Leste uses the US dollar, which is why money() could hardcode a "$"
-- and get away with it. It is still the default and nothing changes for a
-- shop that leaves it alone.
--
-- What it buys is the ability to be wrong later rather than now: a shop that
-- starts quoting in AUD or IDR needs the rate CAPTURED ON THE ORDER, the way
-- purchase orders have always captured fx_rate, or every historical total
-- silently restates itself the day the rate moves. That is the part that
-- cannot be retrofitted, so it goes in while there are few orders to carry.
alter table settings
  add column if not exists display_currency text not null default 'USD';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_display_currency_check') then
    alter table settings add constraint settings_display_currency_check
      check (display_currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column settings.display_currency is
  'Three-letter code the storefront quotes in. USD for Timor-Leste, which is the default and needs no rate.';

alter table orders
  -- What the shop was quoting when this order was placed, and what one unit
  -- of it was worth in USD at that moment. Both frozen: an order is a record
  -- of an agreement, and an agreement does not move when a rate does.
  add column if not exists currency text not null default 'USD',
  add column if not exists fx_rate  numeric(14,6) not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_currency_check') then
    alter table orders add constraint orders_currency_check
      check (currency ~ '^[A-Z]{3}$' and fx_rate > 0);
  end if;
end $$;

comment on column orders.currency is
  'The currency this order was quoted and agreed in. Frozen at placement.';
comment on column orders.fx_rate is
  'USD per one unit of currency, captured at placement. 1 for USD. Frozen: restating history when a rate moves would rewrite what was agreed.';

-- ---------------------------------------------------------------------------
-- 3. Tax
-- ---------------------------------------------------------------------------
-- Orders carried subtotal, fee and total and nothing between them, so a shop
-- that has to charge tax had nowhere to put it and no way to tell a buyer
-- what they had paid it on.
--
-- ON THE ORDER **AND** ON THE LINE. The order-level figure is what the buyer
-- is charged and what reconciles against a payment. The per-line figure is
-- what any return has to give back -- refunding a line at its net price
-- quietly keeps the tax on goods the shop no longer sold, which is both
-- wrong and the kind of wrong nobody notices for a year.
--
-- The RATE is stored beside the amount, not looked up when a screen renders:
-- a rate that changes must not silently restate what was charged in March.
alter table settings
  add column if not exists tax_rate    numeric(6,4) not null default 0,
  add column if not exists tax_label   text not null default '',
  add column if not exists tax_included boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_tax_rate_check') then
    alter table settings add constraint settings_tax_rate_check
      check (tax_rate >= 0 and tax_rate <= 1);
  end if;
end $$;

comment on column settings.tax_rate is
  'Fraction, not a percentage: 0.025 is 2.5%. Zero means this shop charges none, which is the default.';
comment on column settings.tax_label is
  'What the shop calls it on an invoice -- "Sales tax", "IVA". Empty falls back to a generic word.';
comment on column settings.tax_included is
  'true when shelf prices already contain the tax, so it is shown as "of which" rather than added on.';

alter table orders
  add column if not exists tax      numeric(10,2) not null default 0,
  add column if not exists tax_rate numeric(6,4)  not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_tax_check') then
    alter table orders add constraint orders_tax_check
      check (tax >= 0 and tax_rate >= 0 and tax_rate <= 1);
  end if;
end $$;

comment on column orders.tax is
  'Tax charged on this order, in the order currency. Frozen at placement.';
comment on column orders.tax_rate is
  'The rate that produced it, captured so a later rate change cannot restate this order.';

alter table order_items
  add column if not exists tax numeric(10,2) not null default 0;

comment on column order_items.tax is
  'This line''s share of the order tax. What a return of this line has to give back -- refunding the net price alone keeps tax on goods no longer sold.';

-- ---------------------------------------------------------------------------
-- 4. The line's tax reaches order_items
-- ---------------------------------------------------------------------------
-- order_items is built by a trigger from the order's `items` jsonb, so a
-- per-line figure the application computes has to travel in that jsonb and be
-- copied across here. This is supabase/order-items.sql's function with ONE
-- column added -- and it is written out in full because Postgres has no way
-- to add a column to an existing function's insert.
--
-- IF YOU CHANGE order-items.sql, CHANGE THIS TOO. That sentence is in
-- audience-restock.sql as well, where it was ignored and a copy quietly lost
-- a line, which is why tests/schemaHealth.test.ts now fails a replacement
-- that stops writing a column the original wrote.
create or replace function sync_order_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into order_items (
    order_id, product_id, seller_id, name, size, qty,
    unit_price, cost, commission_rate, tax, created_at
  )
  select new.id,
         /* AN UNKNOWN REFERENCE IS NULLED, NOT USED TO DROP THE LINE.
          *
          * The previous version excluded the row when the seller or product
          * did not exist, under a comment saying "the line is worth more
          * than the attribution" -- which is what it MEANT and the opposite
          * of what it did. The order still inserted, and the line vanished
          * from order_items: invisible to seller earnings, to per-line
          * fulfilment, and to every analytics screen, while the buyer's own
          * order still showed it.
          *
          * It is reachable. products has NO foreign key to sellers, so a
          * product can carry the id of a deleted seller indefinitely, and
          * every order for that product would silently lose its line.
          *
          * Nulling keeps the line and drops only the attribution, which is
          * also exactly what the ON DELETE SET NULL on both columns does
          * when the row disappears later. Same end state, whichever order
          * things happen in. */
         (select p.id from products p where p.id = nullif(i->>'product_id', '')::uuid),
         (select s.id from sellers  s where s.id = nullif(i->>'seller_id',  '')::uuid),
         coalesce(i->>'name', ''),
         coalesce(i->>'size', ''),
         (i->>'qty')::int,
         (i->>'price')::numeric,
         nullif(i->>'cost', '')::numeric,
         nullif(i->>'commission_rate', '')::numeric,
         -- Absent on every order placed before this ran, which is correct:
         -- they were not taxed.
         coalesce(nullif(i->>'tax', '')::numeric, 0),
         new.created_at
    from jsonb_array_elements(new.items) i
   where coalesce((i->>'qty')::int, 0) > 0
  on conflict do nothing;

  return null;
end $$;

comment on function sync_order_items is
  'Builds order_items rows from the order''s items jsonb, including each line''s share of the tax. The ONLY writer of order_items at placement.';

-- ---------------------------------------------------------------------------
-- AND THE PUBLIC MAY READ THE NINE COLUMNS ABOVE
-- ---------------------------------------------------------------------------
-- Added later, after a live shop reported all three of these at once:
--
--   "I fill in the trading address and registration, and Terms still says
--    {REGISTRATION — FILL IN}"
--   "I change USD to EUR and every price is still in dollars"
--   "I set Tax to 10% and nothing about tax appears at checkout"
--
-- None of it was the app failing to read the settings. schema.sql revokes
-- select on settings from anon and grants back a NAMED LIST of columns --
-- which is right, and is what stops the public key in the browser reading
-- totp_secret. This file added nine columns to that table and never added
-- them to the list, so for the anon key they did not exist. The storefront
-- asked for what it was allowed to ask for, got no legal or money facts
-- back, and printed the unfilled markers exactly as designed.
--
-- Every column here is something the shop tells the public on purpose: the
-- policy pages print the legal facts, the symbol beside every price comes
-- from display_currency, and a tax added at the last step without having
-- been shown is the thing consumer law is most insistent about.
--
-- What stays out stays out. commission_rate is between the shop and its
-- sellers; totp_secret is a credential. Both are read with the service-role
-- client, which bypasses these grants entirely.
--
-- Column-by-column and guarded, so a partially-migrated database grants
-- what it has rather than failing the file and leaving the rest ungranted.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'legal_address') then
    execute 'grant select (legal_address, legal_registration, legal_retention_years,
                           legal_return_days, legal_refund_days)
             on settings to anon, authenticated';
  end if;

  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'display_currency') then
    execute 'grant select (display_currency) on settings to anon, authenticated';
  end if;

  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'tax_rate') then
    execute 'grant select (tax_rate, tax_label, tax_included)
             on settings to anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ONE RATE FOR THE SHOP, AND ONLY ONE
-- ---------------------------------------------------------------------------
-- A per-category rate was built and then removed at the shop's request: it
-- asked every category for an answer to a question this shop does not have,
-- and a setting nobody can answer is a setting that gets answered wrongly.
-- The rate lives in Settings, where it was always meant to.
--
-- Dropped rather than left in place, so the column cannot be half-populated
-- with rates nothing reads -- which is how a figure ends up on an invoice
-- two years from now with no code behind it. The constraint goes with it;
-- dropping the column drops the check, and the explicit drop is for a
-- database that somehow has the constraint without the column.
-- ---------------------------------------------------------------------------
alter table categories drop constraint if exists categories_tax_rate_check;
alter table categories drop column if exists tax_rate;


-- ==== order-discount.sql ================================================

-- ---------------------------------------------------------------------------
-- What the customer saved, recorded on the order
-- ---------------------------------------------------------------------------
-- Run AFTER schema.sql. Safe to re-run.
--
-- The checkout shows a Discount line when a basket holds anything bought on
-- one. The invoice could not: nothing on the order said what the goods
-- would have cost at full price, so the document a customer keeps was
-- silently missing a line they had seen a minute earlier.
--
-- THE SUBTOTAL DOES NOT CHANGE. Line prices are, and always were, what is
-- actually charged -- the discounted figure -- so subtotal, tax and total
-- are unaffected by this column. It records the saving for its own sake,
-- the way a receipt does: "you paid 34, this is normally 45".
--
-- NOT NULL DEFAULT 0, because "no discount" and "we did not record one" are
-- the same thing on an order placed before this ran: nothing was taken off.
-- ---------------------------------------------------------------------------
alter table orders
  add column if not exists discount numeric(10,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_check') then
    -- A discount is never negative, and never more than the goods were
    -- worth: either would be arithmetic nobody can explain on an invoice.
    alter table orders add constraint orders_discount_check
      check (discount >= 0);
  end if;
end $$;

comment on column orders.discount is
  'What the buyer saved against the full price of the goods, at placement. Informational: subtotal and total are already net of it, because line prices are the discounted ones. Written by placeOrder() from the product rows, never from the basket.';


-- ==== loves.sql =========================================================

-- ===========================================================================
-- Loja AIAI -- "I like this", from someone who is not buying it today
--
-- A shop learns two things from its catalog today: what sold, and what was
-- looked at. Both are late. A product people keep opening and never buying
-- is either priced wrong or photographed badly, and by the time the sales
-- figures say so the season is over.
--
-- This is the signal in between: a heart on the card, tapped by someone who
-- is not going to buy it now but wants it seen. It costs the shopper
-- nothing and tells the shop what to restock, what to discount, and what to
-- put on the homepage.
--
-- WHAT THIS IS NOT. It is not a vote and it is not per-person. There is no
-- row per shopper, no account required, and no way to stop the same phone
-- loving something twice after clearing its browser storage -- exactly like
-- products.views, which this sits beside and is measured the same way. It
-- is a POPULARITY SIGNAL, and every screen that shows it treats it as one.
-- A per-user table is the thing to build if it ever needs to be a vote;
-- until then this is one integer and no new table.
--
-- Safe to re-run.
-- ===========================================================================

alter table products
  add column if not exists loves int not null default 0;

comment on column products.loves is
  'How many times the heart on this product has been tapped. A popularity signal, not a per-person vote -- see supabase/loves.sql.';

-- Partial, like products_audience_idx: the homepage asks for the most-loved
-- few, and the products nobody has loved are never the answer.
create index if not exists products_loves_idx
  on products (loves desc) where loves > 0;

-- ---------------------------------------------------------------------------
-- The two counters.
--
-- SECURITY DEFINER for the same reason increment_views is: an anonymous
-- visitor may move this number and nothing else. Granting them UPDATE on
-- products to let them tap a heart would also let them rewrite every price
-- in the shop.
--
-- greatest(loves - 1, 0) rather than a plain subtraction: a browser that
-- has forgotten it already un-loved something must not be able to push the
-- count below zero, and a negative popularity is not a thing.
-- ---------------------------------------------------------------------------
create or replace function increment_loves(p_id uuid) returns void
  language sql security definer set search_path = public as $$
  update products set loves = loves + 1 where id = p_id;
$$;

create or replace function decrement_loves(p_id uuid) returns void
  language sql security definer set search_path = public as $$
  update products set loves = greatest(loves - 1, 0) where id = p_id;
$$;

revoke all on function increment_loves(uuid) from public;
revoke all on function decrement_loves(uuid) from public;
grant execute on function increment_loves(uuid) to anon, authenticated;
grant execute on function decrement_loves(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- The heart appears on every product card straight away; until this file is
-- run it works for the person tapping it (their browser remembers) and the
-- shop's count stays at zero, which is what a missing column honestly means.
-- The homepage's "Most loved" row and the admin's figure appear as soon as
-- there is something to count.
-- ---------------------------------------------------------------------------


-- ==== reorder-policy.sql ================================================

-- ===========================================================================
-- Loja AIAI -- the reorder policy belongs to the shop
--
-- The reorder plan works from four numbers: how far back to measure demand,
-- how long a delivery takes when the supplier has not said, how much buffer
-- to hold, and how often orders are placed. They were constants in
-- lib/replenishment.ts, which is fine for a default and wrong as a rule:
-- a shop buying weekly from Dili and one buying quarterly from Jakarta want
-- different answers, and neither should have to edit code to get one.
--
-- Defaults match the constants they replace exactly, so a store that runs
-- this and changes nothing sees the same plan it saw yesterday.
--
-- Safe to re-run.
-- ===========================================================================

alter table settings
  -- Eight weeks: long enough to survive one quiet fortnight, short enough
  -- to notice a product that has started moving.
  add column if not exists reorder_window_days int not null default 56
    check (reorder_window_days between 7 and 365);

alter table settings
  -- How often orders are placed. Stock has to cover the wait for the NEXT
  -- order as well as this one, or every line is reordered at the last
  -- possible moment.
  add column if not exists reorder_review_days int not null default 14
    check (reorder_review_days between 1 and 180);

alter table settings
  -- Buffer on top of the lead time, for the week the boat is late.
  add column if not exists reorder_safety_days int not null default 7
    check (reorder_safety_days between 0 and 180);

alter table settings
  -- Used when a supplier has never delivered and states no lead time.
  add column if not exists reorder_default_lead_days int not null default 14
    check (reorder_default_lead_days between 1 and 365);

comment on column settings.reorder_window_days is
  'Days of sales history the reorder plan measures demand over.';
comment on column settings.reorder_review_days is
  'Days between placing purchase orders. Sets how far past the lead time an order must last.';
comment on column settings.reorder_safety_days is
  'Buffer held on top of the lead time.';
comment on column settings.reorder_default_lead_days is
  'Delivery time assumed for a supplier that states none.';

-- ---------------------------------------------------------------------------
-- Done. The reorder plan reads these; nothing else does.
-- ---------------------------------------------------------------------------


-- ==== audience-restock.sql ==============================================

-- ===========================================================================
-- Loja AIAI -- who a product is for, and a warning before a shelf empties
--
-- Two unrelated features in one file because they are one afternoon's
-- migration and splitting them would mean asking you to run two.
--
--   1. products.audience   -- men / women / unisex, or null for "does not
--                             apply". Powers the Men|Women filter in the
--                             shop.
--   2. products.restock_level + settings.restock_alert_pct
--                          -- how much was on the shelf after the last
--                             delivery, and how far it may fall before the
--                             admin says something.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Who it is for
--
-- Nullable, and null is not "unisex". A saucepan is not unisex; it is
-- simply not a question that applies to it. The application shows unset
-- products when no filter is set and hides them when one is -- see
-- src/lib/audience.ts, which explains why collapsing the two would have
-- made the filter useless on the day it shipped.
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists audience text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_audience_check') then
    alter table products
      add constraint products_audience_check
      check (audience is null or audience in ('men', 'women', 'unisex'));
  end if;
end $$;

-- The shop filters on it, so it is worth an index. Partial: the rows with
-- no audience are the majority in most catalogs and are never the ones
-- being looked up by it.
create index if not exists products_audience_idx
  on products (audience) where audience is not null;

comment on column products.audience is
  'men | women | unisex, or null when the question does not apply. Null is NOT unisex -- see src/lib/audience.ts.';

-- ---------------------------------------------------------------------------
-- 2. How full the shelf was last time
--
-- The reference the alert compares against: quantity on hand immediately
-- after the most recent delivery or count-up.
--
-- Maintained by the trigger below rather than by the application. Stock
-- arrives through several paths -- receiving a purchase order, a manual
-- adjustment, an order being cancelled and its units returned -- and every
-- one of them ends in a stock_movements row. Writing it in one trigger is
-- the only version that cannot be bypassed by adding a path later.
--
-- NOT a high-water mark. A shop that once held 500 of something and now
-- deliberately stocks 20 would sit permanently in alert.
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists restock_level int;

comment on column products.restock_level is
  'Quantity on hand just after the last movement that ADDED stock. The reference for the low-stock alert; maintained by apply_stock_movement().';

-- ---------------------------------------------------------------------------
-- The trigger, extended
--
-- This is the same function from supabase/stock-ledger.sql that moves
-- products.qty, with one added line. It is repeated in full because
-- Postgres has no way to add a statement to an existing function, and
-- because a copy that silently drifts from the original would be worse
-- than an obvious one. If you change stock-ledger.sql, change this too.
--
-- IT DRIFTED. The copy below used to set qty and restock_level and NOT
-- stock_status, which the original sets and which nothing else writes. This
-- file runs last, so on every database built from run-all.sql the column
-- froze at whatever it held when the product was created. A shop that
-- received twenty-one shirts had twenty-one shirts and a catalog, a product
-- page and a stock screen all saying OUT OF STOCK -- because the only line
-- that could have said otherwise had been dropped in a copy that claimed in
-- its own comment to be adding one.
--
-- The lesson is in the comment above, and the comment was right. The guard
-- is now in tests/schemaHealth.test.ts: a declared replacement has to keep
-- writing every column the definition it replaces wrote.
-- ---------------------------------------------------------------------------
create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
begin
  update products
     set qty = qty + new.delta,
         -- The shopper's answer, and the same thresholds stock-ledger.sql
         -- has always used. Deliberately NOT the shop's restock percentage:
         -- that is read from settings at the moment a screen is drawn, so
         -- changing it takes effect at once instead of waiting for each
         -- product's next delivery to re-stamp a column.
         stock_status = case
           when qty + new.delta <= 0 then 'out'
           when qty + new.delta <= 2 then 'low'
           else 'in' end,
         -- Only a delivery moves the reference. A sale must not, or the
         -- alert would re-baseline itself downward on every purchase and
         -- never fire at all.
         restock_level = case when new.delta > 0
                              then qty + new.delta
                              else restock_level end
   where id = new.product_id;
  return new;
end $$;

comment on function apply_stock_movement is
  'Turns a stock_movements row into the products.qty balance and stock_status, and records restock_level whenever stock is added. The ONLY thing that writes products.qty.';

-- ---------------------------------------------------------------------------
-- Repairing what the drift left behind
--
-- Every database that has run this file before is carrying a stock_status
-- that stopped following the balance, in both directions: a restocked
-- product still reading 'out', and a product sold down to nothing still
-- reading 'in' -- which is the worse of the two, because it offers goods
-- the shop cannot ship.
--
-- Recomputed from the balance, which is the ledger's sum and the one number
-- that was never wrong. Only rows that actually disagree are touched, so
-- re-running this changes nothing and writes nothing.
-- ---------------------------------------------------------------------------
update products
   set stock_status = case
         when qty <= 0 then 'out'
         when qty <= 2 then 'low'
         else 'in' end
 where stock_status is distinct from (case
         when qty <= 0 then 'out'
         when qty <= 2 then 'low'
         else 'in' end);

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Existing products have no reference, so nothing alerts until their next
-- delivery. Seeding it from what is currently on the shelf is the honest
-- starting point: "as full as it is right now" is exactly what a shop
-- would say if you asked them today. It does mean nothing alerts until
-- something sells, which is correct.
--
-- Only rows that have none, so re-running never resets a real one.
-- ---------------------------------------------------------------------------
update products
   set restock_level = qty
 where restock_level is null and qty > 0;

-- ---------------------------------------------------------------------------
-- 3. How far it may fall
--
-- 75 means "tell me once a quarter of the last delivery has gone". Early
-- on purpose: it is a heads-up for ordering, not a warning that the shelf
-- is nearly bare.
-- ---------------------------------------------------------------------------
alter table settings
  add column if not exists restock_alert_pct int not null default 75;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_restock_alert_pct_check') then
    alter table settings
      add constraint settings_restock_alert_pct_check
      check (restock_alert_pct between 1 and 99);
  end if;
end $$;

comment on column settings.restock_alert_pct is
  'Alert when a product falls to this percentage of its last delivery. 1-99; 75 means "a quarter has gone".';


-- ---------------------------------------------------------------------------
-- 4. Search, taught about the audience
--
-- The filter has to happen INSIDE the query. Filtering the page after it
-- comes back would leave the total count and the page numbers describing a
-- different set of products than the one on screen.
--
-- The old signature is dropped first. Postgres treats a different argument
-- list as a different function, so "create or replace" with an added
-- parameter would leave BOTH versions in place and PostgREST would have no
-- way to choose between them.
-- ---------------------------------------------------------------------------
-- BOTH signatures. The nine-argument one is the original. The ten-argument
-- one exists on any database where an earlier version of this file ran --
-- and "create or replace" cannot rename a parameter, so without this drop a
-- re-run fails with "cannot change name of input parameter". A migration
-- that only works once is not one you can safely re-run.
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int);
drop function if exists search_products(text, uuid[], uuid[], numeric, numeric, boolean, text, int, int, text);

create or replace function search_products(
  q             text    default '',
  category_ids  uuid[]  default null,
  seller_ids    uuid[]  default null,
  min_price     numeric default null,
  max_price     numeric default null,
  in_stock_only boolean default false,
  sort          text    default 'relevance',
  lim           int     default 24,
  off           int     default 0,
  -- Added by supabase/audience-restock.sql. Last, and defaulted, so a call
  -- that does not mention it behaves exactly as it did before.
  --
  -- NOT named "audience": a parameter sharing a name with a column of the
  -- table being queried is ambiguous inside PL/pgSQL, and every call fails
  -- at run time rather than at definition time.
  audience_filter text  default null
)
returns table (product products, total_count bigint, rank real)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_terms   text;
  v_tsquery tsquery := null;
  v_limit   int := least(greatest(coalesce(lim, 24), 1), 100);
  v_offset  int := greatest(coalesce(off, 0), 0);
begin
  -- Build a prefix tsquery by hand rather than using websearch_to_tsquery:
  -- shoppers type partial words ("kame" for "kamera") far more often than
  -- they type boolean operators. Splitting on non-alphanumerics first means
  -- nothing reaching to_tsquery can be a tsquery operator, so no amount of
  -- punctuation in `q` can produce a syntax error.
  select string_agg(word || ':*', ' & ')
    into v_terms
    from regexp_split_to_table(lower(unaccent(coalesce(q, ''))), '[^[:alnum:]]+') as word
   where word <> '';

  if v_terms is not null and v_terms <> '' then
    v_tsquery := to_tsquery('simple', v_terms);
  end if;

  return query
  with matched as (
    select p,
           case when v_tsquery is null then 0::real
                else ts_rank(p.search_vector, v_tsquery) end as r,
           case when p.discount_price is not null and p.discount_price > 0
                then p.discount_price else p.price end as effective_price
      from products p
     where p.archived = false
       and p.status = 'approved'
       and (v_tsquery is null or p.search_vector @@ v_tsquery)
       and (category_ids is null or p.category_id = any(category_ids))
       and (seller_ids is null or p.seller_id = any(seller_ids))
       and (not in_stock_only or p.stock_status <> 'out')
       -- Who it is for. A filter shows that audience plus unisex, and
       -- hides both the other one and the products nobody has labelled --
       -- p.audience = audience is null for those, which is not true, which
       -- excludes them. That is the intended behaviour and not an
       -- oversight: see src/lib/audience.ts.
       and (audience_filter is null
            or p.audience = audience_filter
            or p.audience = 'unisex')
       and (min_price is null or
            (case when p.discount_price is not null and p.discount_price > 0
                  then p.discount_price else p.price end) >= min_price)
       and (max_price is null or
            (case when p.discount_price is not null and p.discount_price > 0
                  then p.discount_price else p.price end) <= max_price)
  )
  select m.p, count(*) over () as total_count, m.r
    from matched m
   order by
     -- Sort by the price a buyer would actually pay, not the list price:
     -- a discounted item belongs where its discounted price puts it.
     case when sort = 'low'  then m.effective_price end asc,
     case when sort = 'high' then m.effective_price end desc,
     case when sort = 'rating'
          then (m.p).rating_sum::numeric / nullif((m.p).rating_count, 0) end desc nulls last,
     case when sort = 'relevance' then m.r end desc,
     -- Final tiebreaker, and the whole ordering for sort = 'new'.
     (m.p).created_at desc
   limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing changes on screen until you set an audience on a product, and
-- the restock alert appears on the admin home the first time something
-- sells down past the threshold.
-- ---------------------------------------------------------------------------


-- ==== product-timestamps.sql ============================================

-- WHEN A PRODUCT LAST CHANGED.
--
-- Run AFTER supabase/schema.sql.
--
-- products has created_at and nothing else, so the sitemap had no honest
-- <lastmod> to give: a price cut, a restock, a rewritten description and a
-- new photo all left the row looking exactly as old as the day it was
-- typed. A sitemap that says a page has not changed since 2024 is worse
-- than one that says nothing -- a crawler believes it and stops coming
-- back, so the sale never shows up in a result.
--
-- Maintained by the database rather than by the app: every writer would
-- otherwise have to remember, and the one that forgets is the one that
-- matters. Backfilled from created_at so existing rows start out truthful
-- rather than all claiming to have changed the moment this ran.
alter table products add column if not exists updated_at timestamptz;
update products set updated_at = created_at where updated_at is null;
alter table products alter column updated_at set default now();

create or replace function touch_product_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_touch_updated_at on products;
create trigger products_touch_updated_at
  before update on products
  for each row execute function touch_product_updated_at();

-- The sitemap orders by it, and the admin's "recently changed" reading of
-- the catalog would too.
create index if not exists idx_products_updated_at on products (updated_at desc);


-- ==== proof-path.sql ====================================================

-- A PAYMENT PROOF THAT STOPS BEING READABLE.
--
-- Run AFTER supabase/schema.sql.
--
-- orders.proof_url held a signed Supabase Storage URL with a 365-day
-- expiry, written once at upload and then stored on the order row. Two
-- problems, and the second is the one that matters:
--
--   1. The URL grants access on its own -- no session, no cookie. Anyone
--      who ever sees that row (a backup, an export, a screenshot of an
--      admin screen, a support ticket, a leaked service key) can read a
--      customer's bank transfer slip for a year afterwards.
--   2. Because it is stored, revoking it is not possible. The only way to
--      cut off a leaked URL is to delete the file.
--
-- So the row keeps the PATH, which grants nothing, and a URL is minted
-- fresh each time somebody with the right to see it actually looks. That
-- makes the link's life the length of one viewing rather than a year, and
-- it makes the storage bucket -- which is already private -- the thing
-- that decides who may read it.
alter table orders add column if not exists proof_path text;

comment on column orders.proof_path is
  'Storage path of the payment proof. Signed URLs are minted per view; see src/lib/paymentProof.ts.';

create index if not exists orders_proof_path_idx on orders (proof_path) where proof_path is not null;


-- ==== pii-retention.sql =================================================

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


-- ==== order-idempotency.sql =============================================

-- ===========================================================================
-- Loja AIAI -- one submission, one order
--
-- THE PROBLEM. placeOrder()'s only protection against a double submission
-- was setBusy(true) in the browser. On a slow or flaky mobile connection --
-- which is the operating assumption of this entire project -- a retried or
-- replayed request created a second complete order: duplicate stock
-- movements when it was confirmed, a duplicate SMS charge, a confused
-- buyer, and a manual cleanup.
--
-- The payment layer already gets this exactly right (payments.idempotency_key
-- with a partial unique index guaranteeing one live attempt per order). The
-- order layer was not given the same treatment. This is that treatment.
--
-- Safe to re-run.
-- ===========================================================================

alter table orders
  add column if not exists idempotency_key text;

comment on column orders.idempotency_key is
  'One per checkout attempt, minted in the browser. A retry of the same attempt returns the original order rather than creating a second. See src/lib/actions/orders.ts.';

-- ---------------------------------------------------------------------------
-- PARTIAL, so the column stays optional.
--
-- Every order placed before this file existed has a null key, and null is
-- not equal to null in a unique index -- but a partial index is clearer
-- about the intent than relying on that, and it keeps the index the size of
-- the orders that actually carry one.
--
-- This is what makes the guard real rather than advisory: two identical
-- submissions racing each other do not both check-then-insert, they both
-- insert and Postgres refuses the second. The application then reads back
-- the first one's reference and hands it to the buyer, who cannot tell that
-- anything happened -- which is the whole point.
-- ---------------------------------------------------------------------------
create unique index if not exists orders_idempotency_key_uq
  on orders (idempotency_key) where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Done. Until this file is run the column is absent, the application drops
-- it from the insert (writeTolerating), and duplicate protection is what it
-- has always been -- a button that disables itself.
-- ---------------------------------------------------------------------------


-- ==== rate-limits.sql ===================================================

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


-- ==== admin-users.sql ===================================================

-- ===========================================================================
-- Loja AIAI -- named admin accounts, and a record of who did what
--
-- Until now the admin was one shared login: ADMIN_EMAIL and ADMIN_PASSWORD
-- in the environment, with a TOTP secret on the settings row. That is a
-- reasonable arrangement for one person and stops being one the moment a
-- second person has the password -- because nothing anywhere records who
-- refunded an order, who zeroed a shelf, or who changed a price.
--
-- Two tables. Staff accounts are ADDITIVE: the environment credentials keep
-- working exactly as before, as the owner. That is deliberate. A shop
-- depends on this login, and a migration that moved the only way in would
-- be one bad deploy away from locking the owner out of their own business.
--
-- Safe to re-run.
-- ===========================================================================

create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  -- Stored lower-cased by the application; the index enforces that two
  -- accounts cannot differ only by capitalisation.
  email         text not null,
  -- scrypt, as "scrypt$N$r$p$salt$hash". Node's own crypto, so no
  -- dependency to keep patched, and a real password KDF rather than a
  -- plain hash that a graphics card walks through in an afternoon.
  password_hash text not null,

  -- Same four columns settings and sellers carry, so lib/totp.ts works
  -- against this table unchanged.
  totp_secret          text,
  totp_enabled         boolean not null default false,
  totp_failed_attempts int not null default 0,
  totp_locked_until    timestamptz,

  -- Deactivated rather than deleted: removing the row would orphan every
  -- audit entry that points at it.
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists admin_users_email_key on admin_users (lower(email));

comment on table admin_users is
  'Named admin logins, in addition to the environment owner credentials. Never delete a row -- set active=false, or the audit trail loses who acted.';

-- ---------------------------------------------------------------------------
-- The record
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),

  actor_kind  text not null check (actor_kind in ('owner', 'staff', 'system')),
  actor_id    uuid references admin_users(id) on delete set null,
  -- Copied, not joined. An audit trail that forgets who did it once the
  -- account is gone is not an audit trail, and "the owner" has no row at
  -- all.
  actor_label text not null default '',

  -- What happened, in a form that can be grouped: 'stock.adjust',
  -- 'order.refund', 'product.price', 'po.receive'.
  action      text not null,
  -- What it happened to.
  entity      text not null default '',
  entity_id   text,
  -- One line a person can read without opening anything else.
  summary     text not null default '',
  -- Anything structured worth keeping: before and after values, amounts.
  meta        jsonb not null default '{}'
);

create index if not exists audit_log_at_idx     on audit_log (at desc);
create index if not exists audit_log_entity_idx on audit_log (entity, entity_id, at desc);
create index if not exists audit_log_actor_idx  on audit_log (actor_id, at desc);

comment on table audit_log is
  'Append-only record of admin actions. Nothing updates or deletes a row here.';

-- ---------------------------------------------------------------------------
-- Grants -- both tables are admin-only, and neither is ever public
-- ---------------------------------------------------------------------------
alter table admin_users enable row level security;
alter table audit_log   enable row level security;
revoke all on admin_users from anon, authenticated;
revoke all on audit_log   from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing changes until a staff account is created, in Settings -> Admin
-- users. The owner's environment login is untouched.
-- ---------------------------------------------------------------------------


-- ==== admin-roles.sql ===================================================

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

-- LOCKED DOWN LIKE EVERY OTHER INTERNAL TABLE. It holds nothing secret --
-- one timestamp, and its EXISTENCE is the whole signal -- but Supabase
-- grants new tables in `public` to anon by default, so without this the
-- public key could write to it freely. Nothing bad follows from a row
-- appearing in it; it is simply not a table the internet has any business
-- touching, and "harmless today" is how an unprotected table survives long
-- enough to stop being harmless.
--
-- Found by tests/rls/rls.test.ts, which asserts that every table in the
-- public schema has RLS on. This one did not.
alter table admin_users_roles_backfilled enable row level security;
revoke all on admin_users_roles_backfilled from anon, authenticated;

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
--
-- THE SECOND NAME IS NOT AN ALTERNATIVE SPELLING. admin-subsections.sql
-- replaces this constraint with a wider one under the name
-- admin_users_section_keys_check, because a constraint replaced in place is
-- invisible to the Settings -> Database panel, which compares NAMES.
--
-- So this file must not re-create the narrow one once the wide one is there.
-- A check constraint is enforced whenever it is present, so the two side by
-- side would mean the narrow one rejecting every tab key while the wide one
-- allowed it -- and every tab grant failing to save, on a shop whose panel
-- reported both files applied. Running the files in either order, or twice,
-- now lands in the same place.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname in ('admin_users_sections_check',
                       'admin_users_section_keys_check')
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


-- ==== admin-subsections.sql =============================================

-- ---------------------------------------------------------------------------
-- Access down to the tab, not only the area
-- ---------------------------------------------------------------------------
-- admin_users.sections held one of six area keys. It now also holds TAB keys
-- -- "settings.finance", "sales.orders" -- so an account can be given the
-- Settings area and, inside it, only Finance and Activity.
--
-- NOTHING CHANGES FOR ANY EXISTING ROW. An area key still means the whole
-- area, exactly as it always did, and every account today holds area keys.
-- The two grants are deliberately different and stay so:
--
--   'settings'         the whole area, INCLUDING tabs added in a later
--                      version. Somebody trusted with Settings was trusted
--                      with Settings, not with a list.
--   'settings.finance' exactly that tab, and nothing that appears beside it
--                      afterwards.
--
-- Getting that the other way round is how a permission quietly widens
-- between releases, which is the failure nobody is watching for.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- WHY THE CONSTRAINT IS RENAMED AND NOT JUST REPLACED
-- ---------------------------------------------------------------------------
-- admin-roles.sql creates admin_users_sections_check, allowing the six area
-- keys and nothing else. This file needs a wider list.
--
-- Replacing it under the same name works, and is invisible. schema_inventory
-- reports NAMES, so a constraint replaced in place looks identical before and
-- after, and the Settings -> Database panel would report this file as applied
-- on a shop that had never run it. That panel exists because the shop has
-- twice been broken by an unrun file; a file it cannot see is the same bug
-- with a fresh coat of paint.
--
-- A new NAME is a thing the panel can see, using names alone. So the narrow
-- constraint is dropped and a differently named wide one takes its place --
-- and the panel can tell the two states apart.
--
-- The two must never coexist: the narrow one would go on rejecting every tab
-- key while the wide one permitted it, and a check constraint that is present
-- is enforced whatever sits beside it. Hence the drop, and hence the matching
-- guard in admin-roles.sql, which now declines to re-create the narrow
-- constraint when the wide one is already there. Without that guard, running
-- admin-roles.sql on its own AFTER this file would silently re-narrow the
-- column and every tab grant would start failing to save.
-- ---------------------------------------------------------------------------

alter table admin_users drop constraint if exists admin_users_sections_check;
alter table admin_users drop constraint if exists admin_users_section_keys_check;

-- KEPT IN STEP WITH src/lib/adminSections.ts BY A TEST. tests/adminSections
-- reads this file and fails if the list here and ALL_GRANT_KEYS disagree --
-- because a key the app grants and the database refuses is a save that fails
-- with a constraint error, and a key the database allows and the app does not
-- recognise is a row that reads as a permission and grants nothing.
alter table admin_users
  add constraint admin_users_section_keys_check check (
    sections <@ array[
      -- areas
      'sales','catalog','procurement','sellers','storefront','settings',
      -- tabs
      'sales.dashboard','sales.orders','sales.returns','sales.notifications',
      'catalog.products','catalog.stock','catalog.categories','catalog.demand',
      'catalog.costs','catalog.reviews',
      -- The dynamic taxonomy (supabase/taxonomy.sql): the tree of product
      -- types, and the library of attributes they ask for.
      'catalog.types','catalog.attributes',
      'procurement.orders','procurement.reorder','procurement.suppliers',
      'sellers.list','sellers.payouts',
      'storefront.hero','storefront.promotions',
      'settings.shop','settings.finance','settings.targets','settings.activity'
    ]::text[]
  );

comment on column admin_users.sections is
  'Which parts of the admin this account may open. An area key ("settings") grants the whole area including tabs added later; a tab key ("settings.finance") grants exactly that tab. Keys from src/lib/adminSections.ts; enforced in requireSection(), src/lib/actions/guard.ts.';

-- ---------------------------------------------------------------------------
-- Note on settings.users
-- ---------------------------------------------------------------------------
-- Admin users is NOT in the list above, deliberately. It is the owner's
-- alone: an account that could edit accounts could grant itself everything,
-- which is not a permission but the absence of one. The application refuses
-- it in two independent places (normalizeSections drops it on the way in,
-- canOpenSubsection refuses it on the way out) and the database will not
-- store it at all. Either alone would do; all three means a gap in one is
-- not a breach.
--
-- ---------------------------------------------------------------------------
-- Done. Nothing on any screen changes until somebody edits an account and
-- ticks a tab rather than an area.
-- ---------------------------------------------------------------------------


-- ==== totp-replay.sql ===================================================

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


-- ==== seller-invites.sql ================================================

-- ===========================================================================
-- Loja AIAI -- becoming a seller is by invitation
--
-- HOW IT USED TO WORK. One checkbox in Settings opened /seller/register to
-- the whole internet, and closing it shut the door on everybody. Neither
-- state matches how this marketplace actually recruits: somebody messages
-- the owner, the owner decides, and the owner lets that one person in.
--
-- An invite is that decision, written down. The owner presses a button,
-- gets a link, and sends it to the person who asked. The link registers ONE
-- store and then stops working. Nothing else reaches the registration form.
--
-- WHAT AN INVITE IS NOT. It is not approval. A store registered through a
-- link is still `pending` and still cannot sell until the owner approves it
-- on the Sellers screen -- exactly as before. The invite decides who may
-- APPLY; approval still decides who may trade. Two decisions, two moments,
-- and the second one is where the owner reads what was actually typed.
--
-- Safe to re-run.
-- ===========================================================================

create table if not exists seller_invites (
  id          uuid primary key default gen_random_uuid(),

  -- The secret in the link. Unique because it IS the identifier: the
  -- registration form looks a row up by this and nothing else, and two rows
  -- sharing one token would make "which invite was used" unanswerable.
  -- Minted with crypto.randomBytes in lib/actions/seller-invites.ts, never
  -- in SQL: a token a database could regenerate is not a secret.
  token       text not null unique,

  -- Who the owner meant it for, in the owner's own words -- "Alton, AITA
  -- Store, asked on WhatsApp". Never shown to the person invited. Without
  -- it a list of eight live links is eight identical rows, and revoking the
  -- right one becomes guesswork.
  note        text not null default '',
  created_by  text not null default '',
  created_at  timestamptz not null default now(),

  -- NOT NULL on purpose: a link with no end is a permanent hole in the
  -- front door, left open by the first person who forgot about it. The
  -- application picks the span; the column simply refuses to have none.
  expires_at  timestamptz not null,

  -- Claimed. Set once, by a conditional update that only matches while it
  -- is still null -- which is what makes two people opening the same link
  -- at the same moment resolve to one registration rather than two.
  used_at     timestamptz,
  used_by     uuid references sellers(id) on delete set null,

  -- Withdrawn before it was used. Separate from used_at because they are
  -- different answers to "why did my link stop working", and the owner
  -- revoking one should not have it read as a store that registered.
  revoked_at  timestamptz
);

create index if not exists idx_seller_invites_token on seller_invites(token);
create index if not exists idx_seller_invites_open
  on seller_invites(created_at desc) where used_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Nobody reads this table but the server.
--
-- RLS on with NO policies at all, which in PostgreSQL denies every row to
-- anon and authenticated. That is the intent: a token is a credential, and
-- a table of live credentials that any visitor could list would make the
-- invitation meaningless. Every read and write goes through the service
-- role (lib/actions/seller-invites.ts and the registration action), which
-- bypasses RLS.
-- ---------------------------------------------------------------------------
alter table seller_invites enable row level security;
revoke all on seller_invites from anon, authenticated;

comment on table seller_invites is
  'One-use links that let a person reach /seller/register. Not approval -- a store registered through one is still pending. See supabase/seller-invites.sql.';

-- ---------------------------------------------------------------------------
-- Done.
--
-- settings.seller_registration_enabled is left alone and is no longer read:
-- the invite is the gate now, and a shop that had once switched that column
-- off would otherwise find its invitations silently refused. The column
-- stays for older rows rather than being dropped, because dropping it is
-- the one change this file could make that an older deployment could not
-- survive being rolled back.
-- ---------------------------------------------------------------------------


-- ==== seller-features.sql ===============================================

-- ===========================================================================
-- Loja AIAI -- what each seller has been given access to
--
-- One column on sellers. It answers one question:
--
--   features  WHICH OF THE OWNER'S TOOLS this store may open, beyond the
--             four screens that make it a seller at all.
--             Keys from src/lib/sellerFeatures.ts -- 'sales', 'stock',
--             'procurement'.
--
-- The four included screens -- dashboard, products, orders, store settings
-- -- are NOT listed here and never will be. A seller who cannot list a
-- product or see an order is not a store with fewer features, it is a
-- broken account, so they are held by every approved seller and there is
-- nothing to store. Only what is genuinely a choice lives in this column.
--
-- WHY THE DEFAULT IS EMPTY, INCLUDING FOR STORES THAT ALREADY EXIST.
--
-- supabase/admin-roles.sql, which does the same job for staff accounts,
-- backfills existing rows to full access. It has to: those accounts were
-- created when every admin had everything, and applying the safe default
-- to them would silently take away access somebody was using.
--
-- This is the opposite case and takes the opposite decision. Every feature
-- in this column is a screen that did not exist before this file, so no
-- seller has ever had one, and nobody loses anything by starting at empty.
-- Granting them all by default would instead give away, to every store on
-- the marketplace, the thing the owner intends to offer store by store.
--
-- Safe to re-run.
-- ===========================================================================

alter table sellers
  add column if not exists features text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- A key the application does not recognise is dropped when the row is read
-- (normalizeFeatures in src/lib/sellerFeatures.ts), so a bad value cannot
-- grant anything. This keeps them out of the table in the first place,
-- where a typo would otherwise sit on the Sellers screen looking like a
-- feature somebody had paid for.
--
-- ADDING A FEATURE LATER means adding it to this constraint too. The
-- constraint is dropped and recreated rather than guarded by an existence
-- check, so re-running this file after editing the list actually applies
-- the new list instead of silently keeping the old one -- which is the
-- failure mode of the "create if not exists" version of this: the app
-- offers a checkbox, the owner ticks it, and the save fails against a
-- constraint written before the feature existed.
-- ---------------------------------------------------------------------------
--
-- AND IT MUST NOT COME BACK ONCE seller-areas.sql HAS WIDENED IT.
--
-- That file replaces this constraint with sellers_area_keys_check, allowing
-- the two-level keys, and rewrites every row to match. Re-adding the narrow
-- list here afterwards fails outright -- "check constraint
-- sellers_features_check is violated by some row" -- because the rows now
-- hold 'selling.today' and this list has never heard of it.
--
-- That is not hypothetical: it is what running run-all.sql a second time
-- did, and the first run left no sign of it because a fresh database has no
-- sellers for the narrow constraint to trip over. So the guard checks for
-- EITHER name, and running the two files in either order, or twice, lands
-- in the same place.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname in ('sellers_features_check', 'sellers_area_keys_check')
  ) then
    alter table sellers
      add constraint sellers_features_check check (
        features <@ array['sales','stock','procurement','today']::text[]
      );
  end if;
end $$;

comment on column sellers.features is
  'Which of the owner''s tools this store may open, beyond the four screens every seller has. Keys from src/lib/sellerFeatures.ts. Enforced in requireSellerFeature(), src/lib/actions/guard.ts.';

-- ---------------------------------------------------------------------------
-- The column is the platform's to set, never the seller's
--
-- Every write to this column goes through setSellerFeatures(), which
-- requires an admin session and uses the service role. But "the code does
-- not do that" is not a permission, so the rule is stated here too.
--
-- WHAT ACTUALLY PROTECTS IT is that sellers has no UPDATE grant for anon
-- or authenticated at all -- see the comment in schema.sql, which refused
-- to add one precisely because a blanket UPDATE would let a store set its
-- own status to 'approved'. The same grant would let it grant itself every
-- feature on this list. This re-asserts that state rather than assuming
-- some later file has not loosened it.
--
-- A COLUMN-LEVEL REVOKE WOULD NOT WORK, and is worth writing down because
-- it looks like it should. In PostgreSQL a table-level UPDATE grant is not
-- reduced by revoking one column from it:
--
--     grant update on sellers to authenticated;
--     revoke update (features) on sellers from authenticated;
--     select has_column_privilege('authenticated','sellers','features','update');
--     -- true
--
-- The first draft of this file did exactly that and tested as protected
-- while granting nothing. Restricting by column requires revoking the
-- table-level privilege and granting the wanted columns back one by one.
-- If a "sellers edit their own profile" grant is ever added, it has to be
-- written that way, and features must not be in the list.
-- ---------------------------------------------------------------------------
revoke update on sellers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing changes for anyone until you tick something on
-- Sellers -> a store -> Access. Every store keeps exactly the four screens
-- it already had; the extra ones appear in that store's navigation the
-- moment you grant them, and disappear the moment you take them away.
-- ---------------------------------------------------------------------------


-- ==== seller-procurement.sql ============================================

-- ===========================================================================
-- Loja AIAI -- a seller's own buying
--
-- The marketplace's purchasing screens (supabase/procurement.sql) are the
-- OWNER'S buying operation: their suppliers, their orders, their landed
-- costs. A store renting a shop inside the marketplace buys too, and until
-- now had nowhere to record it -- so a seller granted "stock control" could
-- see what was running out and had no way to say what they had ordered
-- about it.
--
-- ONE COLUMN ON EACH OF TWO TABLES, and it is nullable on purpose:
--
--   null      the marketplace's own. Every supplier and every purchase
--             order that exists today, unchanged, still the owner's.
--   a seller  that store's own, visible to that store and to the owner,
--             and to nobody else.
--
-- Backfilling would have been the other choice and would have been wrong:
-- there is no seller to attribute an existing order to, and inventing one
-- would put the owner's supplier prices on somebody else's screen.
--
-- WHAT THIS IS NOT. It is not a shared supplier book. Two stores buying
-- from the same factory each keep their own row for it, because a supplier
-- row carries contact names, lead times and notes that are commercial
-- information -- and one seller editing another's supplier, or reading the
-- price the owner pays, is the failure this whole column exists to avoid.
--
-- Safe to re-run.
-- ===========================================================================

alter table suppliers
  add column if not exists seller_id uuid references sellers(id) on delete cascade;
alter table purchase_orders
  add column if not exists seller_id uuid references sellers(id) on delete cascade;

-- on delete cascade, not set null: a store leaving the marketplace must not
-- leave its purchase orders behind reading as the owner's own buying, which
-- is what "set null" would have meant here.

comment on column suppliers.seller_id is
  'Which store''s supplier. Null is the marketplace''s own. See supabase/seller-procurement.sql.';
comment on column purchase_orders.seller_id is
  'Which store placed this order. Null is the marketplace''s own.';

-- Partial, like products_loves_idx: every query that uses these asks for one
-- seller's rows, and the owner's own -- much the larger set on a young
-- marketplace -- is asked for by "is null" instead.
create index if not exists idx_suppliers_seller
  on suppliers(seller_id) where seller_id is not null;
create index if not exists idx_purchase_orders_seller
  on purchase_orders(seller_id) where seller_id is not null;

-- ---------------------------------------------------------------------------
-- The third thing a seller can be given.
--
-- supabase/seller-features.sql says, in its own comments, that adding a
-- feature means editing its constraint too -- and that the constraint is
-- dropped and recreated rather than guarded by an existence check, so that
-- re-running actually applies the new list. This is that edit. Running
-- either file after the other leaves the same three keys.
-- ---------------------------------------------------------------------------
--
-- GUARDED, LIKE THE ONE IN seller-features.sql, because seller-areas.sql
-- later replaces this constraint with sellers_area_keys_check and rewrites
-- every row to the two-level keys. Re-adding the narrow list over those rows
-- fails outright, which is what running run-all.sql a second time did.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname in ('sellers_features_check', 'sellers_area_keys_check')
  ) then
    alter table sellers
      add constraint sellers_features_check check (
        features <@ array['sales','stock','procurement','today']::text[]
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security is unchanged, and that is the point.
--
-- suppliers and purchase_orders have RLS on with no policy for anon or
-- authenticated (see procurement.sql), so neither table is readable by a
-- logged-in seller through the Supabase client at all. Every read and write
-- on these screens goes through the service role in a server action that has
-- already resolved WHICH seller is asking and filters on this column --
-- lib/actions/seller-procurement.ts, and the ownership check it shares with
-- the admin actions (lib/procurementScope.ts).
--
-- Stated rather than assumed: a later file that adds a blanket
-- "authenticated can read suppliers" policy would hand every seller the
-- owner's supplier list and every other seller's, and the column above
-- would not stop it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Done. Nothing changes for anyone until "Purchases" is ticked for a store
-- on Sellers -> that store -> Access.
-- ---------------------------------------------------------------------------


-- ==== seller-areas.sql ==================================================

-- ---------------------------------------------------------------------------
-- A store's access, down to the tab
-- ---------------------------------------------------------------------------
-- sellers.features held four flat keys -- 'sales', 'stock', 'procurement',
-- 'today' -- one per screen the owner could sell. It now holds the same
-- two-level keys the staff side uses: AREA keys and TAB keys.
--
--   'selling'       the whole area, INCLUDING tabs added in a later version
--                   of the app. A store trusted with Sales was trusted with
--                   Sales, not with a list.
--   'selling.today' exactly that tab, and nothing that appears beside it
--                   afterwards.
--
-- Getting that the other way round is how a permission quietly widens
-- between releases, which is the failure nobody is watching for.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- THE MIGRATION IS THE CAREFUL PART, AND IT MUST NOT WIDEN ANYTHING
-- ---------------------------------------------------------------------------
-- Every old key becomes a TAB key, never an area key.
--
-- THE SALES AREA IS KEYED 'selling' FOR EXACTLY THIS REASON. Had it been
-- keyed 'sales', the old flat key and the new area key would be one string
-- with two meanings and no way to tell them apart: a row reading ['sales']
-- would be either a store that bought one report before this ran or a store
-- granted the whole area after it. Old 'sales' named the My
-- sales PAGE; the Sales AREA did not exist. Mapping it to the area would
-- hand every store that had bought one report the whole of Sales, plus
-- every tab added to Sales afterwards, and nothing on any screen would say
-- it had happened.
--
--   today       -> selling.today
--   sales       -> selling.report
--   stock       -> catalog.stock
--   procurement -> purchasing.purchases
--
-- Each store ends up able to open exactly the screens it could open before.
--
-- The constraint is dropped first so the rewrite cannot fail against the
-- old list, and the new one is added after, so it validates the rewritten
-- rows rather than the ones on their way out.
-- ---------------------------------------------------------------------------

alter table sellers drop constraint if exists sellers_features_check;
alter table sellers drop constraint if exists sellers_area_keys_check;

update sellers
   set features = (
     select coalesce(array_agg(distinct new_key order by new_key), '{}')
       from unnest(features) as old_key
       cross join lateral (
         select case old_key
           when 'today'       then 'selling.today'
           when 'sales'       then 'selling.report'
           when 'stock'       then 'catalog.stock'
           when 'procurement' then 'purchasing.purchases'
           -- Already migrated, or a key from a feature since removed. Kept
           -- as-is here and dropped by normalizeFeatures() on the way out,
           -- so a second run of this file is a no-op rather than a mangling.
           else old_key
         end as new_key
       ) as mapped
   )
 where exists (
   select 1 from unnest(features) as k
    where k in ('today', 'sales', 'stock', 'procurement')
 );

-- ---------------------------------------------------------------------------
-- The new list, under a new NAME
-- ---------------------------------------------------------------------------
-- Renamed rather than replaced in place, for the same reason
-- admin_users_section_keys_check was: schema_inventory reports NAMES, so a
-- constraint swapped under its own name is invisible to the Settings ->
-- Database panel and this file would read as applied on a shop that had
-- never run it. A new name is something the panel can see.
--
-- KEPT IN STEP WITH src/lib/sellerFeatures.ts BY A TEST. tests/sellerFeatures
-- reads this file and fails if the list here and ALL_GRANT_KEYS disagree --
-- because a key the app offers and the database refuses is a save that
-- fails in the owner's face while they are trying to sell something, and a
-- key the database allows and the app does not recognise is a row that
-- reads as a paid feature and opens nothing.
-- ---------------------------------------------------------------------------
alter table sellers
  add constraint sellers_area_keys_check check (
    features <@ array[
      -- areas
      'selling','catalog','purchasing',
      -- tabs
      'selling.today','selling.report',
      'catalog.stock',
      'purchasing.purchases'
    ]::text[]
  );

comment on column sellers.features is
  'Which of the owner''s tools this store may open, beyond the screens every seller has. An area key ("selling") grants the whole area including tabs added later; a tab key ("selling.today") grants exactly that tab. Keys from src/lib/sellerFeatures.ts; enforced in requireSellerFeature(), src/lib/actions/guard.ts.';

-- ---------------------------------------------------------------------------
-- Note on what is NOT in the list
-- ---------------------------------------------------------------------------
-- The dashboard, My products, My orders and Store settings are not here,
-- deliberately. They are what makes an account a seller at all: a store
-- that could not list a product or see an order would not be a cheaper
-- store, it would be a broken one. They are held by every approved store
-- and are not a checkbox, so a key naming one would be a permission
-- nothing reads -- the screen and the database disagreeing about what was
-- sold.
--
-- 'settings' is absent for the same reason: its only tab comes free, so
-- offering the area would be offering nothing.
-- ---------------------------------------------------------------------------


-- ==== seller-address-public.sql =========================================

-- ---------------------------------------------------------------------------
-- A seller choosing to publish their address
-- ---------------------------------------------------------------------------
-- The store page shows where a store is, so a customer can decide whether
-- to collect. Until now that could only ever be the city and country,
-- because sellers.address is not granted to anon at all -- see the column
-- grant in schema.sql, which hands the public id, store_name, slug,
-- description, city, country, seller_type and created_at and nothing else.
--
-- That limit was right and stays. A seller trading from home gave that
-- address to the marketplace when they registered; nobody told them it
-- would appear on a public page, and turning it on for everybody because
-- a map pin would be more precise is not a decision the marketplace gets
-- to make on their behalf.
--
-- So it becomes theirs to make. This column is that choice.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- DEFAULT FALSE, AND THAT IS THE WHOLE POINT
-- ---------------------------------------------------------------------------
-- Every seller who registered before this existed answered no question, so
-- the answer recorded for them is no. A default of true would publish the
-- home addresses of every store on the marketplace the moment this file
-- ran, silently, with the migration reading like a feature.
--
-- `not null` so there is no third state: a null here would be "we do not
-- know whether they agreed", and code reading that as anything other than
-- no is the same leak by a slower route.
-- ---------------------------------------------------------------------------
alter table sellers
  add column if not exists address_public boolean not null default false;

comment on column sellers.address_public is
  'The seller ticked "show my address on my store page" in their own settings. False for anybody who never answered. sellers.address stays ungranted to anon whatever this says -- the address is read with the service role and withheld unless this is true; see getSellerPublicAddress() in src/lib/data/public.ts.';

-- ---------------------------------------------------------------------------
-- NOTHING NEW IS GRANTED TO anon, DELIBERATELY
-- ---------------------------------------------------------------------------
-- The obvious move is to add `address` to the public column grant and let
-- the app decide. It is the wrong one: a column grant cannot be conditional,
-- so that would publish every seller's address to anybody holding the anon
-- key -- which is in the browser -- and leave this column as decoration
-- that only the UI respected.
--
-- The address is therefore read with the SERVICE ROLE, in one function that
-- checks this flag and the seller's status before returning it, and anon
-- still cannot select the column at all. Two answers have to agree before
-- an address reaches a page, and one of them is enforced by a privilege
-- rather than by code somebody might change.
--
-- The flag itself is not granted either. The public page has no use for
-- "this seller declined": it either shows an address or does not.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Done. Nothing on any page changes until a seller opens Store settings and
-- ticks the box themselves.
-- ---------------------------------------------------------------------------


-- ==== taxonomy.sql ======================================================

-- ===========================================================================
-- Loja AIAI -- product taxonomy and dynamic attributes
--
-- Run AFTER supabase/schema.sql. Safe to re-run.
-- The seed that fills these tables is supabase/taxonomy-seed.sql.
--
-- WHAT THIS IS FOR. Until now a product was a row in `products` and every
-- property it could have was a column on that row. That works while the
-- shop sells shirts. It stops working the moment it also sells sofas,
-- smartphones and whey protein, because a sofa needs Seat Height and a
-- phone needs Storage and a shirt needs neither, and the answer cannot be
-- to keep adding columns -- product_seat_height, product_storage,
-- product_neck_type -- until the table has four hundred of them and every
-- product is mostly nulls.
--
-- So an attribute becomes a ROW, not a column:
--
--   categories -> product_types -> product_type_attributes -> attributes
--
-- and a new category is INSERT statements rather than a migration.
--
-- THREE LEVELS, AND WHY, given the specification's own database section
-- disagrees with its prose. The prose hangs attributes off a Product Type
-- (T-Shirts, Sofas, Smartphones); the schema it sketches hangs them off a
-- category and has no product_types table at all. The prose is right: a
-- category is far too coarse to carry attributes -- "Electronics" would
-- have to own Sleeve Length -- so attributes hang off the product type,
-- and a category is a place to browse.
--
-- The middle level is kept even though the specification's own data makes
-- it degenerate: all 25 categories have exactly one subcategory each. It
-- costs one nullable column, it is what the shop was asked for, and the
-- day "Electronics" needs both "Consumer Electronics" and "Components" it
-- is already there. It reuses `categories.parent_id`, which has existed
-- since schema.sql -- so subcategories are categories, and every screen
-- that already walks that tree keeps working.
--
-- GLOBAL, NOT PER SELLER. `categories` carries a seller_id; these tables
-- deliberately do not. A marketplace where five hundred sellers each
-- invent their own "Colour" cannot offer one colour filter, and its search
-- cannot match across stores. The taxonomy is the platform's, and only the
-- owner edits it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Product types
-- ---------------------------------------------------------------------------
-- The level that owns attributes. Hangs off a category row -- which is
-- either a top-level category or one of its children, because the shop is
-- free to file product types at whichever depth makes sense to it.

create table if not exists product_types (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references categories(id) on delete cascade,
  name          text not null,
  slug          text not null,
  description    text not null default '',
  status        text not null default 'active'
                  check (status in ('active', 'hidden')),
  display_order int  not null default 0,
  created_at    timestamptz not null default now(),
  -- Unique per category, not globally: "Chairs" under Furniture and
  -- "Chairs" under Office are two different things with one name, and the
  -- shop should not have to invent "office-chairs-2".
  unique (category_id, slug)
);

create index if not exists product_types_category_idx
  on product_types (category_id, display_order);

comment on table product_types is
  'The level that owns attributes: T-Shirts, Sofas, Smartphones. Hangs off a category (or subcategory, which is a category with a parent). Global -- see supabase/taxonomy.sql.';

-- ---------------------------------------------------------------------------
-- 2. Attributes
-- ---------------------------------------------------------------------------
-- One row per property the catalogue can record, reusable across every
-- product type that needs it. "Brand" is one row, used by 256 product
-- types; "Seat Height" is one row used by five.

create table if not exists attributes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,

  -- Which control the form draws. The list is section 3 of the
  -- specification; src/lib/taxonomy/fieldTypes.ts infers it from the name
  -- and the attribute builder lets the owner correct it without a
  -- migration, which is the point of holding it in a row.
  field_type    text not null default 'text' check (field_type in (
                  'text','textarea','richtext',
                  'number','decimal','currency',
                  'select','multiselect','boolean',
                  'color','image','file',
                  'date','datetime',
                  'range','dimensions','tags')),

  -- Shown after the input and stored beside the value: cm, kg, W. Null
  -- where the question has no unit, which is most of them.
  unit          text,

  -- May this attribute tell one variant from another? Size and Colour can;
  -- Brand cannot -- a product has one brand however many sizes it comes in.
  is_variant    boolean not null default false,

  -- What the storefront may do with it. A free-text field is never
  -- filterable: a filter needs a set of values to offer, and free text has
  -- as many values as there are products.
  filterable    boolean not null default false,
  searchable    boolean not null default false,
  sortable      boolean not null default false,

  -- Who may see it. An admin-only attribute is for the shop's own records
  -- -- a supplier reference, a shelf location -- and never reaches a
  -- product page.
  admin_only    boolean not null default false,

  -- Min, max, pattern, step. Read by the form and re-checked on the
  -- server; jsonb because each field type wants different keys.
  validation    jsonb not null default '{}'::jsonb,

  display_order int  not null default 0,
  created_at    timestamptz not null default now(),

  -- HAS A HUMAN TOUCHED THIS ROW?
  --
  -- The seed writes 546 attributes and infers the field type of every one
  -- from its name. Some of those guesses are wrong, and get corrected in
  -- two different ways that must not fight each other:
  --
  --   * the owner corrects one in the attribute builder;
  --   * the inference rules are fixed and the seed is pasted again.
  --
  -- With ON CONFLICT DO NOTHING the second never reaches a shop that
  -- already ran the seed -- a fix shipped today would never arrive. With
  -- DO UPDATE it arrives by trampling the first. So the seed updates only
  -- the rows it still owns: the attribute builder sets this true on any
  -- manual edit, and from then on the seed leaves that row alone forever.
  admin_edited  boolean not null default false
);

create index if not exists attributes_variant_idx
  on attributes (is_variant) where is_variant;
create index if not exists attributes_filterable_idx
  on attributes (filterable) where filterable;

comment on table attributes is
  'Every property the catalogue can record, once, reusable across product types. field_type decides which control the form draws -- see src/lib/taxonomy/fieldTypes.ts.';

-- ---------------------------------------------------------------------------
-- 3. Attribute options
-- ---------------------------------------------------------------------------
-- The values a select or multiselect offers.
--
-- AN ATTRIBUTE WITH NO OPTIONS IS NOT BROKEN. The specification names 546
-- attributes and lists the values of almost none of them -- it says a
-- T-shirt has a "Collar Type" without ever saying what the collar types
-- are. Those are seeded as selects with no options, the form renders them
-- as a text box, and the day somebody fills the options in they become
-- dropdowns everywhere they appear. No schema change, no data migration.

create table if not exists attribute_options (
  id            uuid primary key default gen_random_uuid(),
  attribute_id  uuid not null references attributes(id) on delete cascade,
  label         text not null,
  -- What gets stored. Separate from the label so the shop can rename
  -- "Black" to "Jet Black" on every product page without rewriting the
  -- value on ten thousand rows.
  value         text not null,
  display_order int  not null default 0,
  created_at    timestamptz not null default now(),
  unique (attribute_id, value)
);

create index if not exists attribute_options_attr_idx
  on attribute_options (attribute_id, display_order);

-- ---------------------------------------------------------------------------
-- 4. Which attributes a product type has
-- ---------------------------------------------------------------------------
-- The join that makes the form dynamic. A T-shirt has fourteen rows here;
-- a sofa has eighteen; they share Brand, Material and Colour and nothing
-- else.
--
-- `required` lives HERE rather than on the attribute, because it depends
-- on the product: Storage is required on a smartphone and meaningless on a
-- sofa, and it is the same attribute row.

create table if not exists product_type_attributes (
  id              uuid primary key default gen_random_uuid(),
  product_type_id uuid not null references product_types(id) on delete cascade,
  attribute_id    uuid not null references attributes(id) on delete cascade,
  required        boolean not null default false,
  display_order   int  not null default 0,
  created_at      timestamptz not null default now(),
  unique (product_type_id, attribute_id)
);

create index if not exists pta_type_idx
  on product_type_attributes (product_type_id, display_order);
create index if not exists pta_attribute_idx
  on product_type_attributes (attribute_id);

comment on table product_type_attributes is
  'Which attributes each product type asks for, and which of them are required. `required` is here and not on `attributes` because the same attribute is mandatory on one product and irrelevant on another.';

-- ---------------------------------------------------------------------------
-- 5. The product learns its type
-- ---------------------------------------------------------------------------
-- NULLABLE, and that is not an oversight. Every product that exists today
-- has no product type, and this column appearing must not stop any of them
-- being sold, edited or found. They keep working exactly as they did; the
-- migration screen fills this in afterwards, product by product, and until
-- it does a null here simply means "no dynamic attributes for this one".

alter table products
  add column if not exists product_type_id uuid
    references product_types(id) on delete set null;

create index if not exists products_product_type_idx
  on products (product_type_id) where product_type_id is not null;

comment on column products.product_type_id is
  'Which product type this is, deciding the attributes it carries. Null for products created before the taxonomy existed -- they keep selling untouched. See supabase/taxonomy.sql.';

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------
-- READABLE BY ANYONE, because the storefront needs it: a category page
-- cannot build "Brand / Colour / Size" filters without reading which
-- attributes are filterable, and that runs as anon.
--
-- Nothing here is a secret -- it is the shape of a shop's catalogue, which
-- every visitor can see anyway by looking at the products. Writing is
-- another matter and goes through the service role, which is what the
-- admin actions use.

alter table product_types            enable row level security;
alter table attributes               enable row level security;
alter table attribute_options        enable row level security;
alter table product_type_attributes  enable row level security;

drop policy if exists product_types_public_read on product_types;
create policy product_types_public_read on product_types
  for select using (status = 'active');

drop policy if exists attributes_public_read on attributes;
create policy attributes_public_read on attributes
  for select using (not admin_only);

drop policy if exists attribute_options_public_read on attribute_options;
create policy attribute_options_public_read on attribute_options
  for select using (true);

drop policy if exists pta_public_read on product_type_attributes;
create policy pta_public_read on product_type_attributes
  for select using (true);

-- Read only, and only the columns a storefront actually draws with. No
-- insert, update or delete for anon or authenticated: the taxonomy is the
-- platform's, and it changes through the admin screens or not at all.
revoke all on product_types           from anon, authenticated;
revoke all on attributes              from anon, authenticated;
revoke all on attribute_options       from anon, authenticated;
revoke all on product_type_attributes from anon, authenticated;

grant select on product_types           to anon, authenticated;
grant select on attributes              to anon, authenticated;
grant select on attribute_options       to anon, authenticated;
grant select on product_type_attributes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The integrity the application must not be trusted to keep
-- ---------------------------------------------------------------------------
-- Section 25 of the brief: never trust a category_id, a product_type_id or
-- an attribute_id off a form. The foreign keys above already stop an id
-- that names nothing. This stops the subtler one -- an id that names
-- something REAL but unrelated, which is what an attacker sends: a valid
-- attribute that belongs to a different product type.
--
-- It is a function rather than a constraint because the check spans three
-- tables, and the server action calls it before writing any value.

create or replace function attribute_belongs_to_type(
  p_product_type_id uuid, p_attribute_id uuid
) returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from product_type_attributes
     where product_type_id = p_product_type_id
       and attribute_id    = p_attribute_id
  );
$$;

comment on function attribute_belongs_to_type is
  'True when this attribute is one the product type actually asks for. The guard against a form posting a real attribute id that belongs to something else -- see section 25 of the rebuild brief.';

-- Likewise for the tree: a product type must sit under the category the
-- form claims, or under one of its children.
create or replace function type_belongs_to_category(
  p_product_type_id uuid, p_category_id uuid
) returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1
      from product_types pt
      join categories c on c.id = pt.category_id
     where pt.id = p_product_type_id
       and (c.id = p_category_id or c.parent_id = p_category_id)
  );
$$;

comment on function type_belongs_to_category is
  'True when this product type sits under that category, directly or as one of its subcategories.';


-- ==== taxonomy-seed.sql =================================================

-- ===========================================================================
-- Loja AIAI -- the taxonomy itself
--
-- GENERATED by scripts/build-taxonomy-seed.mjs. Do not edit by hand: edit
-- supabase/seed-data/taxonomy.json (what the specification says) or
-- src/lib/taxonomy/fieldTypes.ts (what kind of field each attribute is),
-- then re-run the script and `npm run sql`.
--
-- Run AFTER supabase/taxonomy.sql. Safe to re-run: everything is keyed on
-- a slug and carries an ON CONFLICT, so a second paste changes nothing --
-- including nothing the owner has corrected in the attribute builder
-- since the first paste.
--
--   25 categories
--   25 subcategories
--   267 product types
--   546 attributes
--   2568 attribute assignments
-- ===========================================================================

-- Categories and subcategories are rows in `categories`, which carries a
-- NOT NULL seller_id defaulting to current_seller_id(). The taxonomy is
-- the platform's, so it is filed under the settings row's seller -- the
-- same id the marketplace's own catalogue uses.
do $seed$
declare
  v_seller uuid;
begin
  select seller_id into v_seller from settings limit 1;
  if v_seller is null then
    raise exception 'No settings row: run supabase/schema.sql first.';
  end if;

  -- ---- categories ----
  insert into categories (seller_id, name, slug, parent_id, sort_order)
  select v_seller, v.name, v.slug, null, v.ord
    from (values
    ('Men''s Clothing', 'men_s_clothing', 0),
    ('Women''s Clothing', 'women_s_clothing', 1),
    ('Sportswear & Gym Clothing', 'sportswear_gym_clothing', 2),
    ('Shoes', 'shoes', 3),
    ('Gym & Fitness Equipment', 'gym_fitness_equipment', 4),
    ('Gym Accessories', 'gym_accessories', 5),
    ('Supplements & Sports Nutrition', 'supplements_sports_nutrition', 6),
    ('Accessories', 'accessories', 7),
    ('Electronics', 'electronics', 8),
    ('Computers & Components', 'computers_components', 9),
    ('Gaming', 'gaming', 10),
    ('Home, Furniture & Living', 'home_furniture_living', 11),
    ('Beauty & Personal Care', 'beauty_personal_care', 12),
    ('Bags & Luggage', 'bags_luggage', 13),
    ('Automotive', 'automotive', 14),
    ('Sports & Outdoor', 'sports_outdoor', 15),
    ('Books & Education', 'books_education', 16),
    ('Baby & Kids', 'baby_kids', 17),
    ('Pet Supplies', 'pet_supplies', 18),
    ('Tools & Hardware', 'tools_hardware', 19),
    ('Food & Grocery', 'food_grocery', 20),
    ('Office Supplies', 'office_supplies', 21),
    ('Musical Instruments', 'musical_instruments', 22),
    ('Collectibles & Hobbies', 'collectibles_hobbies', 23),
    ('Handmade & Crafts', 'handmade_crafts', 24)
    ) as v(name, slug, ord)
  on conflict (seller_id, slug) do nothing;

  -- ---- subcategories (categories with a parent) ----
  -- The specification gives every category exactly one subcategory, and
  -- several share a name ("Clothing" under both Men's and Women's), so each
  -- slug is qualified by its parent to stay unique per seller.
  insert into categories (seller_id, name, slug, parent_id, sort_order)
  select v_seller, v.name, v.slug, c.id, v.ord
    from (values
    ('Clothing', 'men_s_clothing__clothing', 'men_s_clothing', 0),
    ('Clothing', 'women_s_clothing__clothing', 'women_s_clothing', 1),
    ('Gym & Sportswear', 'sportswear_gym_clothing__gym_sportswear', 'sportswear_gym_clothing', 2),
    ('Footwear', 'shoes__footwear', 'shoes', 3),
    ('Fitness Equipment', 'gym_fitness_equipment__fitness_equipment', 'gym_fitness_equipment', 4),
    ('Gym Accessories', 'gym_accessories__gym_accessories', 'gym_accessories', 5),
    ('Sports Nutrition', 'supplements_sports_nutrition__sports_nutrition', 'supplements_sports_nutrition', 6),
    ('Accessories', 'accessories__accessories', 'accessories', 7),
    ('Consumer Electronics', 'electronics__consumer_electronics', 'electronics', 8),
    ('Computer Components', 'computers_components__computer_components', 'computers_components', 9),
    ('Gaming Products', 'gaming__gaming_products', 'gaming', 10),
    ('Furniture / Home Equipment / Living', 'home_furniture_living__furniture_home_equipment_living', 'home_furniture_living', 11),
    ('Personal Care', 'beauty_personal_care__personal_care', 'beauty_personal_care', 12),
    ('Bags & Travel', 'bags_luggage__bags_travel', 'bags_luggage', 13),
    ('Automotive Products', 'automotive__automotive_products', 'automotive', 14),
    ('Sports & Outdoor', 'sports_outdoor__sports_outdoor', 'sports_outdoor', 15),
    ('Education & Stationery', 'books_education__education_stationery', 'books_education', 16),
    ('Baby & Kids Products', 'baby_kids__baby_kids_products', 'baby_kids', 17),
    ('Pet Products', 'pet_supplies__pet_products', 'pet_supplies', 18),
    ('Tools & Hardware', 'tools_hardware__tools_hardware', 'tools_hardware', 19),
    ('Food & Grocery', 'food_grocery__food_grocery', 'food_grocery', 20),
    ('Office Products', 'office_supplies__office_products', 'office_supplies', 21),
    ('Music Products', 'musical_instruments__music_products', 'musical_instruments', 22),
    ('Collectibles & Hobbies', 'collectibles_hobbies__collectibles_hobbies', 'collectibles_hobbies', 23),
    ('Handmade / Custom', 'handmade_crafts__handmade_custom', 'handmade_crafts', 24)
    ) as v(name, slug, parent_slug, ord)
    join categories c on c.seller_id = v_seller and c.slug = v.parent_slug
  on conflict (seller_id, slug) do nothing;

  -- ---- product types ----
  insert into product_types (category_id, name, slug, display_order)
  select c.id, v.name, v.slug, v.ord
    from (values
    ('T-Shirts', 't_shirts', 'men_s_clothing__clothing', 0),
    ('Shirts', 'shirts', 'men_s_clothing__clothing', 1),
    ('Hoodies', 'hoodies', 'men_s_clothing__clothing', 2),
    ('Sweatshirts', 'sweatshirts', 'men_s_clothing__clothing', 3),
    ('Jackets', 'jackets', 'men_s_clothing__clothing', 4),
    ('Coats', 'coats', 'men_s_clothing__clothing', 5),
    ('Vests', 'vests', 'men_s_clothing__clothing', 6),
    ('Jeans', 'jeans', 'men_s_clothing__clothing', 7),
    ('Trousers', 'trousers', 'men_s_clothing__clothing', 8),
    ('Shorts', 'shorts', 'men_s_clothing__clothing', 9),
    ('Joggers', 'joggers', 'men_s_clothing__clothing', 10),
    ('Tracksuits', 'tracksuits', 'men_s_clothing__clothing', 11),
    ('Underwear', 'underwear', 'men_s_clothing__clothing', 12),
    ('Swimwear', 'swimwear', 'men_s_clothing__clothing', 13),
    ('T-Shirts', 't_shirts', 'women_s_clothing__clothing', 14),
    ('Tops', 'tops', 'women_s_clothing__clothing', 15),
    ('Blouses', 'blouses', 'women_s_clothing__clothing', 16),
    ('Shirts', 'shirts', 'women_s_clothing__clothing', 17),
    ('Dresses', 'dresses', 'women_s_clothing__clothing', 18),
    ('Skirts', 'skirts', 'women_s_clothing__clothing', 19),
    ('Jeans', 'jeans', 'women_s_clothing__clothing', 20),
    ('Trousers', 'trousers', 'women_s_clothing__clothing', 21),
    ('Shorts', 'shorts', 'women_s_clothing__clothing', 22),
    ('Leggings', 'leggings', 'women_s_clothing__clothing', 23),
    ('Hoodies', 'hoodies', 'women_s_clothing__clothing', 24),
    ('Sweatshirts', 'sweatshirts', 'women_s_clothing__clothing', 25),
    ('Jackets', 'jackets', 'women_s_clothing__clothing', 26),
    ('Coats', 'coats', 'women_s_clothing__clothing', 27),
    ('Jumpsuits', 'jumpsuits', 'women_s_clothing__clothing', 28),
    ('Bodysuits', 'bodysuits', 'women_s_clothing__clothing', 29),
    ('Lingerie', 'lingerie', 'women_s_clothing__clothing', 30),
    ('Swimwear', 'swimwear', 'women_s_clothing__clothing', 31),
    ('Gym T-Shirts', 'gym_t_shirts', 'sportswear_gym_clothing__gym_sportswear', 32),
    ('Stringers', 'stringers', 'sportswear_gym_clothing__gym_sportswear', 33),
    ('Tank Tops', 'tank_tops', 'sportswear_gym_clothing__gym_sportswear', 34),
    ('Compression Shirts', 'compression_shirts', 'sportswear_gym_clothing__gym_sportswear', 35),
    ('Compression Shorts', 'compression_shorts', 'sportswear_gym_clothing__gym_sportswear', 36),
    ('Gym Shorts', 'gym_shorts', 'sportswear_gym_clothing__gym_sportswear', 37),
    ('Leggings', 'leggings', 'sportswear_gym_clothing__gym_sportswear', 38),
    ('Sports Bras', 'sports_bras', 'sportswear_gym_clothing__gym_sportswear', 39),
    ('Joggers', 'joggers', 'sportswear_gym_clothing__gym_sportswear', 40),
    ('Tracksuits', 'tracksuits', 'sportswear_gym_clothing__gym_sportswear', 41),
    ('Training Jackets', 'training_jackets', 'sportswear_gym_clothing__gym_sportswear', 42),
    ('Sports Socks', 'sports_socks', 'sportswear_gym_clothing__gym_sportswear', 43),
    ('Running Shoes', 'running_shoes', 'shoes__footwear', 44),
    ('Training Shoes', 'training_shoes', 'shoes__footwear', 45),
    ('Gym Shoes', 'gym_shoes', 'shoes__footwear', 46),
    ('Basketball Shoes', 'basketball_shoes', 'shoes__footwear', 47),
    ('Football Boots', 'football_boots', 'shoes__footwear', 48),
    ('Hiking Shoes', 'hiking_shoes', 'shoes__footwear', 49),
    ('Casual Shoes', 'casual_shoes', 'shoes__footwear', 50),
    ('Sneakers', 'sneakers', 'shoes__footwear', 51),
    ('Sandals', 'sandals', 'shoes__footwear', 52),
    ('Boots', 'boots', 'shoes__footwear', 53),
    ('Slides', 'slides', 'shoes__footwear', 54),
    ('Formal Shoes', 'formal_shoes', 'shoes__footwear', 55),
    ('Dumbbells', 'dumbbells', 'gym_fitness_equipment__fitness_equipment', 56),
    ('Barbells', 'barbells', 'gym_fitness_equipment__fitness_equipment', 57),
    ('Weight Plates', 'weight_plates', 'gym_fitness_equipment__fitness_equipment', 58),
    ('Kettlebells', 'kettlebells', 'gym_fitness_equipment__fitness_equipment', 59),
    ('Resistance Bands', 'resistance_bands', 'gym_fitness_equipment__fitness_equipment', 60),
    ('Pull-Up Bars', 'pull_up_bars', 'gym_fitness_equipment__fitness_equipment', 61),
    ('Gym Benches', 'gym_benches', 'gym_fitness_equipment__fitness_equipment', 62),
    ('Squat Racks', 'squat_racks', 'gym_fitness_equipment__fitness_equipment', 63),
    ('Cable Machines', 'cable_machines', 'gym_fitness_equipment__fitness_equipment', 64),
    ('Weight Machines', 'weight_machines', 'gym_fitness_equipment__fitness_equipment', 65),
    ('Treadmills', 'treadmills', 'gym_fitness_equipment__fitness_equipment', 66),
    ('Exercise Bikes', 'exercise_bikes', 'gym_fitness_equipment__fitness_equipment', 67),
    ('Rowing Machines', 'rowing_machines', 'gym_fitness_equipment__fitness_equipment', 68),
    ('Yoga Mats', 'yoga_mats', 'gym_fitness_equipment__fitness_equipment', 69),
    ('Foam Rollers', 'foam_rollers', 'gym_fitness_equipment__fitness_equipment', 70),
    ('Ab Wheels', 'ab_wheels', 'gym_fitness_equipment__fitness_equipment', 71),
    ('Jump Ropes', 'jump_ropes', 'gym_fitness_equipment__fitness_equipment', 72),
    ('Gym Gloves', 'gym_gloves', 'gym_accessories__gym_accessories', 73),
    ('Wrist Wraps', 'wrist_wraps', 'gym_accessories__gym_accessories', 74),
    ('Lifting Straps', 'lifting_straps', 'gym_accessories__gym_accessories', 75),
    ('Knee Sleeves', 'knee_sleeves', 'gym_accessories__gym_accessories', 76),
    ('Elbow Sleeves', 'elbow_sleeves', 'gym_accessories__gym_accessories', 77),
    ('Weight Belts', 'weight_belts', 'gym_accessories__gym_accessories', 78),
    ('Ankle Straps', 'ankle_straps', 'gym_accessories__gym_accessories', 79),
    ('Lifting Hooks', 'lifting_hooks', 'gym_accessories__gym_accessories', 80),
    ('Shaker Bottles', 'shaker_bottles', 'gym_accessories__gym_accessories', 81),
    ('Gym Towels', 'gym_towels', 'gym_accessories__gym_accessories', 82),
    ('Gym Bags', 'gym_bags', 'gym_accessories__gym_accessories', 83),
    ('Training Masks', 'training_masks', 'gym_accessories__gym_accessories', 84),
    ('Whey Protein', 'whey_protein', 'supplements_sports_nutrition__sports_nutrition', 85),
    ('Protein Bars', 'protein_bars', 'supplements_sports_nutrition__sports_nutrition', 86),
    ('Creatine', 'creatine', 'supplements_sports_nutrition__sports_nutrition', 87),
    ('Pre-Workout', 'pre_workout', 'supplements_sports_nutrition__sports_nutrition', 88),
    ('BCAA', 'bcaa', 'supplements_sports_nutrition__sports_nutrition', 89),
    ('EAA', 'eaa', 'supplements_sports_nutrition__sports_nutrition', 90),
    ('Mass Gainer', 'mass_gainer', 'supplements_sports_nutrition__sports_nutrition', 91),
    ('Electrolytes', 'electrolytes', 'supplements_sports_nutrition__sports_nutrition', 92),
    ('Vitamins', 'vitamins', 'supplements_sports_nutrition__sports_nutrition', 93),
    ('Minerals', 'minerals', 'supplements_sports_nutrition__sports_nutrition', 94),
    ('Recovery Supplements', 'recovery_supplements', 'supplements_sports_nutrition__sports_nutrition', 95),
    ('Watches', 'watches', 'accessories__accessories', 96),
    ('Sunglasses', 'sunglasses', 'accessories__accessories', 97),
    ('Belts', 'belts', 'accessories__accessories', 98),
    ('Wallets', 'wallets', 'accessories__accessories', 99),
    ('Caps', 'caps', 'accessories__accessories', 100),
    ('Hats', 'hats', 'accessories__accessories', 101),
    ('Backpacks', 'backpacks', 'accessories__accessories', 102),
    ('Bags', 'bags', 'accessories__accessories', 103),
    ('Jewelry', 'jewelry', 'accessories__accessories', 104),
    ('Keychains', 'keychains', 'accessories__accessories', 105),
    ('Smartphones', 'smartphones', 'electronics__consumer_electronics', 106),
    ('Tablets', 'tablets', 'electronics__consumer_electronics', 107),
    ('Laptops', 'laptops', 'electronics__consumer_electronics', 108),
    ('Smartwatches', 'smartwatches', 'electronics__consumer_electronics', 109),
    ('Headphones', 'headphones', 'electronics__consumer_electronics', 110),
    ('Earbuds', 'earbuds', 'electronics__consumer_electronics', 111),
    ('Speakers', 'speakers', 'electronics__consumer_electronics', 112),
    ('Power Banks', 'power_banks', 'electronics__consumer_electronics', 113),
    ('Chargers', 'chargers', 'electronics__consumer_electronics', 114),
    ('Cables', 'cables', 'electronics__consumer_electronics', 115),
    ('Keyboards', 'keyboards', 'electronics__consumer_electronics', 116),
    ('Mice', 'mice', 'electronics__consumer_electronics', 117),
    ('CPUs', 'cpus', 'computers_components__computer_components', 118),
    ('GPUs', 'gpus', 'computers_components__computer_components', 119),
    ('Motherboards', 'motherboards', 'computers_components__computer_components', 120),
    ('RAM', 'ram', 'computers_components__computer_components', 121),
    ('SSDs', 'ssds', 'computers_components__computer_components', 122),
    ('HDDs', 'hdds', 'computers_components__computer_components', 123),
    ('Power Supplies', 'power_supplies', 'computers_components__computer_components', 124),
    ('PC Cases', 'pc_cases', 'computers_components__computer_components', 125),
    ('Cooling Systems', 'cooling_systems', 'computers_components__computer_components', 126),
    ('Monitors', 'monitors', 'computers_components__computer_components', 127),
    ('Keyboards', 'keyboards', 'computers_components__computer_components', 128),
    ('Mice', 'mice', 'computers_components__computer_components', 129),
    ('Gaming Consoles', 'gaming_consoles', 'gaming__gaming_products', 130),
    ('Controllers', 'controllers', 'gaming__gaming_products', 131),
    ('Gaming Headsets', 'gaming_headsets', 'gaming__gaming_products', 132),
    ('Gaming Chairs', 'gaming_chairs', 'gaming__gaming_products', 133),
    ('Gaming Desks', 'gaming_desks', 'gaming__gaming_products', 134),
    ('Gaming Keyboards', 'gaming_keyboards', 'gaming__gaming_products', 135),
    ('Gaming Mice', 'gaming_mice', 'gaming__gaming_products', 136),
    ('Mouse Pads', 'mouse_pads', 'gaming__gaming_products', 137),
    ('Games', 'games', 'gaming__gaming_products', 138),
    ('Gaming Monitors', 'gaming_monitors', 'gaming__gaming_products', 139),
    ('Sofas', 'sofas', 'home_furniture_living__furniture_home_equipment_living', 140),
    ('Armchairs', 'armchairs', 'home_furniture_living__furniture_home_equipment_living', 141),
    ('Chairs', 'chairs', 'home_furniture_living__furniture_home_equipment_living', 142),
    ('Dining Chairs', 'dining_chairs', 'home_furniture_living__furniture_home_equipment_living', 143),
    ('Office Chairs', 'office_chairs', 'home_furniture_living__furniture_home_equipment_living', 144),
    ('Gaming Chairs', 'gaming_chairs', 'home_furniture_living__furniture_home_equipment_living', 145),
    ('Dining Tables', 'dining_tables', 'home_furniture_living__furniture_home_equipment_living', 146),
    ('Coffee Tables', 'coffee_tables', 'home_furniture_living__furniture_home_equipment_living', 147),
    ('Desks', 'desks', 'home_furniture_living__furniture_home_equipment_living', 148),
    ('Office Desks', 'office_desks', 'home_furniture_living__furniture_home_equipment_living', 149),
    ('Beds', 'beds', 'home_furniture_living__furniture_home_equipment_living', 150),
    ('Mattresses', 'mattresses', 'home_furniture_living__furniture_home_equipment_living', 151),
    ('Bedside Tables', 'bedside_tables', 'home_furniture_living__furniture_home_equipment_living', 152),
    ('Wardrobes', 'wardrobes', 'home_furniture_living__furniture_home_equipment_living', 153),
    ('Cabinets', 'cabinets', 'home_furniture_living__furniture_home_equipment_living', 154),
    ('Shelves', 'shelves', 'home_furniture_living__furniture_home_equipment_living', 155),
    ('Bookcases', 'bookcases', 'home_furniture_living__furniture_home_equipment_living', 156),
    ('TV Units', 'tv_units', 'home_furniture_living__furniture_home_equipment_living', 157),
    ('Storage Boxes', 'storage_boxes', 'home_furniture_living__furniture_home_equipment_living', 158),
    ('Storage Bins', 'storage_bins', 'home_furniture_living__furniture_home_equipment_living', 159),
    ('Kitchen Cabinets', 'kitchen_cabinets', 'home_furniture_living__furniture_home_equipment_living', 160),
    ('Kitchen Tables', 'kitchen_tables', 'home_furniture_living__furniture_home_equipment_living', 161),
    ('Kitchen Chairs', 'kitchen_chairs', 'home_furniture_living__furniture_home_equipment_living', 162),
    ('Lighting', 'lighting', 'home_furniture_living__furniture_home_equipment_living', 163),
    ('Lamps', 'lamps', 'home_furniture_living__furniture_home_equipment_living', 164),
    ('Ceiling Lights', 'ceiling_lights', 'home_furniture_living__furniture_home_equipment_living', 165),
    ('Kitchenware', 'kitchenware', 'home_furniture_living__furniture_home_equipment_living', 166),
    ('Cookware', 'cookware', 'home_furniture_living__furniture_home_equipment_living', 167),
    ('Dinnerware', 'dinnerware', 'home_furniture_living__furniture_home_equipment_living', 168),
    ('Curtains', 'curtains', 'home_furniture_living__furniture_home_equipment_living', 169),
    ('Rugs', 'rugs', 'home_furniture_living__furniture_home_equipment_living', 170),
    ('Mirrors', 'mirrors', 'home_furniture_living__furniture_home_equipment_living', 171),
    ('Home Decoration', 'home_decoration', 'home_furniture_living__furniture_home_equipment_living', 172),
    ('Skincare', 'skincare', 'beauty_personal_care__personal_care', 173),
    ('Haircare', 'haircare', 'beauty_personal_care__personal_care', 174),
    ('Makeup', 'makeup', 'beauty_personal_care__personal_care', 175),
    ('Perfume', 'perfume', 'beauty_personal_care__personal_care', 176),
    ('Grooming', 'grooming', 'beauty_personal_care__personal_care', 177),
    ('Oral Care', 'oral_care', 'beauty_personal_care__personal_care', 178),
    ('Shaving Products', 'shaving_products', 'beauty_personal_care__personal_care', 179),
    ('Backpacks', 'backpacks', 'bags_luggage__bags_travel', 180),
    ('Gym Bags', 'gym_bags', 'bags_luggage__bags_travel', 181),
    ('Handbags', 'handbags', 'bags_luggage__bags_travel', 182),
    ('Shoulder Bags', 'shoulder_bags', 'bags_luggage__bags_travel', 183),
    ('Crossbody Bags', 'crossbody_bags', 'bags_luggage__bags_travel', 184),
    ('Suitcases', 'suitcases', 'bags_luggage__bags_travel', 185),
    ('Travel Bags', 'travel_bags', 'bags_luggage__bags_travel', 186),
    ('Laptop Bags', 'laptop_bags', 'bags_luggage__bags_travel', 187),
    ('Car Accessories', 'car_accessories', 'automotive__automotive_products', 188),
    ('Motorcycle Accessories', 'motorcycle_accessories', 'automotive__automotive_products', 189),
    ('Car Electronics', 'car_electronics', 'automotive__automotive_products', 190),
    ('Interior Accessories', 'interior_accessories', 'automotive__automotive_products', 191),
    ('Exterior Accessories', 'exterior_accessories', 'automotive__automotive_products', 192),
    ('Maintenance Products', 'maintenance_products', 'automotive__automotive_products', 193),
    ('Automotive Tools', 'automotive_tools', 'automotive__automotive_products', 194),
    ('Football', 'football', 'sports_outdoor__sports_outdoor', 195),
    ('Basketball', 'basketball', 'sports_outdoor__sports_outdoor', 196),
    ('Volleyball', 'volleyball', 'sports_outdoor__sports_outdoor', 197),
    ('Tennis Rackets', 'tennis_rackets', 'sports_outdoor__sports_outdoor', 198),
    ('Running Equipment', 'running_equipment', 'sports_outdoor__sports_outdoor', 199),
    ('Bicycles', 'bicycles', 'sports_outdoor__sports_outdoor', 200),
    ('Camping Equipment', 'camping_equipment', 'sports_outdoor__sports_outdoor', 201),
    ('Hiking Equipment', 'hiking_equipment', 'sports_outdoor__sports_outdoor', 202),
    ('Swimming Equipment', 'swimming_equipment', 'sports_outdoor__sports_outdoor', 203),
    ('Fishing Equipment', 'fishing_equipment', 'sports_outdoor__sports_outdoor', 204),
    ('Books', 'books', 'books_education__education_stationery', 205),
    ('Textbooks', 'textbooks', 'books_education__education_stationery', 206),
    ('Study Materials', 'study_materials', 'books_education__education_stationery', 207),
    ('Notebooks', 'notebooks', 'books_education__education_stationery', 208),
    ('Stationery', 'stationery', 'books_education__education_stationery', 209),
    ('Educational Toys', 'educational_toys', 'books_education__education_stationery', 210),
    ('Baby Clothing', 'baby_clothing', 'baby_kids__baby_kids_products', 211),
    ('Kids Clothing', 'kids_clothing', 'baby_kids__baby_kids_products', 212),
    ('Baby Shoes', 'baby_shoes', 'baby_kids__baby_kids_products', 213),
    ('Toys', 'toys', 'baby_kids__baby_kids_products', 214),
    ('Strollers', 'strollers', 'baby_kids__baby_kids_products', 215),
    ('Baby Furniture', 'baby_furniture', 'baby_kids__baby_kids_products', 216),
    ('Feeding Products', 'feeding_products', 'baby_kids__baby_kids_products', 217),
    ('School Accessories', 'school_accessories', 'baby_kids__baby_kids_products', 218),
    ('Pet Food', 'pet_food', 'pet_supplies__pet_products', 219),
    ('Pet Toys', 'pet_toys', 'pet_supplies__pet_products', 220),
    ('Pet Beds', 'pet_beds', 'pet_supplies__pet_products', 221),
    ('Collars', 'collars', 'pet_supplies__pet_products', 222),
    ('Leashes', 'leashes', 'pet_supplies__pet_products', 223),
    ('Grooming', 'grooming', 'pet_supplies__pet_products', 224),
    ('Pet Accessories', 'pet_accessories', 'pet_supplies__pet_products', 225),
    ('Hand Tools', 'hand_tools', 'tools_hardware__tools_hardware', 226),
    ('Power Tools', 'power_tools', 'tools_hardware__tools_hardware', 227),
    ('Measuring Tools', 'measuring_tools', 'tools_hardware__tools_hardware', 228),
    ('Hardware', 'hardware', 'tools_hardware__tools_hardware', 229),
    ('Electrical Tools', 'electrical_tools', 'tools_hardware__tools_hardware', 230),
    ('Workshop Equipment', 'workshop_equipment', 'tools_hardware__tools_hardware', 231),
    ('Snacks', 'snacks', 'food_grocery__food_grocery', 232),
    ('Beverages', 'beverages', 'food_grocery__food_grocery', 233),
    ('Coffee', 'coffee', 'food_grocery__food_grocery', 234),
    ('Tea', 'tea', 'food_grocery__food_grocery', 235),
    ('Canned Food', 'canned_food', 'food_grocery__food_grocery', 236),
    ('Cooking Ingredients', 'cooking_ingredients', 'food_grocery__food_grocery', 237),
    ('Frozen Food', 'frozen_food', 'food_grocery__food_grocery', 238),
    ('Sweets', 'sweets', 'food_grocery__food_grocery', 239),
    ('Printers', 'printers', 'office_supplies__office_products', 240),
    ('Paper', 'paper', 'office_supplies__office_products', 241),
    ('Ink', 'ink', 'office_supplies__office_products', 242),
    ('Toners', 'toners', 'office_supplies__office_products', 243),
    ('Pens', 'pens', 'office_supplies__office_products', 244),
    ('Notebooks', 'notebooks', 'office_supplies__office_products', 245),
    ('Office Furniture', 'office_furniture', 'office_supplies__office_products', 246),
    ('Filing Products', 'filing_products', 'office_supplies__office_products', 247),
    ('Guitars', 'guitars', 'musical_instruments__music_products', 248),
    ('Keyboards', 'keyboards', 'musical_instruments__music_products', 249),
    ('Drums', 'drums', 'musical_instruments__music_products', 250),
    ('Microphones', 'microphones', 'musical_instruments__music_products', 251),
    ('Speakers', 'speakers', 'musical_instruments__music_products', 252),
    ('Audio Interfaces', 'audio_interfaces', 'musical_instruments__music_products', 253),
    ('Musical Accessories', 'musical_accessories', 'musical_instruments__music_products', 254),
    ('Figures', 'figures', 'collectibles_hobbies__collectibles_hobbies', 255),
    ('Trading Cards', 'trading_cards', 'collectibles_hobbies__collectibles_hobbies', 256),
    ('Models', 'models', 'collectibles_hobbies__collectibles_hobbies', 257),
    ('Collectible Toys', 'collectible_toys', 'collectibles_hobbies__collectibles_hobbies', 258),
    ('Memorabilia', 'memorabilia', 'collectibles_hobbies__collectibles_hobbies', 259),
    ('Art & Crafts', 'art_crafts', 'collectibles_hobbies__collectibles_hobbies', 260),
    ('Handmade Clothing', 'handmade_clothing', 'handmade_crafts__handmade_custom', 261),
    ('Handmade Jewelry', 'handmade_jewelry', 'handmade_crafts__handmade_custom', 262),
    ('Artwork', 'artwork', 'handmade_crafts__handmade_custom', 263),
    ('Decorations', 'decorations', 'handmade_crafts__handmade_custom', 264),
    ('Crafts', 'crafts', 'handmade_crafts__handmade_custom', 265),
    ('Custom Products', 'custom_products', 'handmade_crafts__handmade_custom', 266)
    ) as v(name, slug, cat_slug, ord)
    join categories c on c.seller_id = v_seller and c.slug = v.cat_slug
  on conflict (category_id, slug) do nothing;
end $seed$;

-- ---- attributes ----
insert into attributes
  (name, slug, field_type, unit, is_variant, filterable, searchable, sortable)
select v.name, v.slug, v.field_type, v.unit, v.is_variant, v.filterable, v.searchable, v.sortable
  from (values
  ('Gender', 'gender', 'select', null::text, false, true, true, false),
    ('Size', 'size', 'select', null::text, true, true, true, false),
    ('Color', 'color', 'color', null::text, true, true, true, false),
    ('Brand', 'brand', 'select', null::text, false, true, true, false),
    ('Material', 'material', 'select', null::text, true, true, true, false),
    ('Fit', 'fit', 'select', null::text, false, true, true, false),
    ('Pattern', 'pattern', 'select', null::text, false, true, true, false),
    ('Style', 'style', 'select', null::text, false, true, true, false),
    ('Season', 'season', 'select', null::text, false, true, true, false),
    ('Occasion', 'occasion', 'select', null::text, false, true, true, false),
    ('Neck Type', 'neck_type', 'select', null::text, false, true, true, false),
    ('Sleeve Length', 'sleeve_length', 'select', null::text, false, true, true, false),
    ('Fabric Weight', 'fabric_weight', 'number', 'gsm', false, true, false, true),
    ('Stretch', 'stretch', 'select', null::text, false, true, true, false),
    ('Collar Type', 'collar_type', 'select', null::text, false, true, true, false),
    ('Sleeve Type', 'sleeve_type', 'select', null::text, false, true, true, false),
    ('Closure', 'closure', 'select', null::text, false, true, true, false),
    ('Pocket Type', 'pocket_type', 'select', null::text, false, true, true, false),
    ('Hood Type', 'hood_type', 'select', null::text, false, true, true, false),
    ('Fabric Thickness', 'fabric_thickness', 'select', null::text, false, true, true, false),
    ('Lining', 'lining', 'select', null::text, false, true, true, false),
    ('Waterproof', 'waterproof', 'boolean', null::text, false, true, false, false),
    ('Length', 'length', 'number', 'cm', false, true, false, true),
    ('Insulation', 'insulation', 'select', null::text, false, true, true, false),
    ('Waist Size', 'waist_size', 'select', null::text, false, true, true, false),
    ('Rise', 'rise', 'select', null::text, false, true, true, false),
    ('Leg Style', 'leg_style', 'select', null::text, false, true, true, false),
    ('Wash', 'wash', 'select', null::text, false, true, true, false),
    ('Liner', 'liner', 'select', null::text, false, true, true, false),
    ('Waist Type', 'waist_type', 'select', null::text, false, true, true, false),
    ('Cuff Type', 'cuff_type', 'select', null::text, false, true, true, false),
    ('Pieces Included', 'pieces_included', 'select', null::text, false, true, true, false),
    ('Waistband', 'waistband', 'select', null::text, false, true, true, false),
    ('Pack Size', 'pack_size', 'select', null::text, true, true, true, false),
    ('UV Protection', 'uv_protection', 'select', null::text, false, true, true, false),
    ('Neckline', 'neckline', 'select', null::text, false, true, true, false),
    ('Dress Type', 'dress_type', 'select', null::text, false, true, true, false),
    ('Compression', 'compression', 'select', null::text, false, true, true, false),
    ('Opacity', 'opacity', 'select', null::text, false, true, true, false),
    ('Cup Size', 'cup_size', 'select', null::text, false, true, true, false),
    ('Band Size', 'band_size', 'select', null::text, false, true, true, false),
    ('Support Level', 'support_level', 'select', null::text, false, true, true, false),
    ('Support', 'support', 'select', null::text, false, true, true, false),
    ('Activity', 'activity', 'select', null::text, false, true, true, false),
    ('Moisture Wicking', 'moisture_wicking', 'boolean', null::text, false, true, false, false),
    ('Breathability', 'breathability', 'select', null::text, false, true, true, false),
    ('Back Style', 'back_style', 'select', null::text, false, true, true, false),
    ('Compression Level', 'compression_level', 'select', null::text, false, true, true, false),
    ('Waistband Type', 'waistband_type', 'select', null::text, false, true, true, false),
    ('Cushioning', 'cushioning', 'select', null::text, false, true, true, false),
    ('Model', 'model', 'text', null::text, false, false, true, false),
    ('Upper Material', 'upper_material', 'select', null::text, false, true, true, false),
    ('Sole Material', 'sole_material', 'select', null::text, false, true, true, false),
    ('Shoe Width', 'shoe_width', 'select', null::text, false, true, true, false),
    ('Weight', 'weight', 'number', 'kg', true, true, false, true),
    ('Support Type', 'support_type', 'select', null::text, false, true, true, false),
    ('Running Type', 'running_type', 'select', null::text, false, true, true, false),
    ('Terrain', 'terrain', 'select', null::text, false, true, true, false),
    ('Heel-to-Toe Drop', 'heel_to_toe_drop', 'select', null::text, false, true, true, false),
    ('Stability', 'stability', 'select', null::text, false, true, true, false),
    ('Grip', 'grip', 'select', null::text, false, true, true, false),
    ('Ankle Support', 'ankle_support', 'select', null::text, false, true, true, false),
    ('Playing Position', 'playing_position', 'select', null::text, false, true, true, false),
    ('Stud Type', 'stud_type', 'select', null::text, false, true, true, false),
    ('Surface', 'surface', 'select', null::text, false, true, true, false),
    ('Strap Type', 'strap_type', 'select', null::text, false, true, true, false),
    ('Shaft Height', 'shaft_height', 'number', 'cm', false, true, false, true),
    ('Toe Shape', 'toe_shape', 'select', null::text, false, true, true, false),
    ('Type', 'type', 'select', null::text, false, true, true, false),
    ('Handle Material', 'handle_material', 'select', null::text, false, true, true, false),
    ('Coating', 'coating', 'select', null::text, false, true, true, false),
    ('Shape', 'shape', 'select', null::text, false, true, true, false),
    ('Adjustable/Fixed', 'adjustable_fixed', 'select', null::text, false, true, true, false),
    ('Diameter', 'diameter', 'number', 'cm', false, true, false, true),
    ('Maximum Load', 'maximum_load', 'number', 'kg', false, true, false, true),
    ('Shaft Material', 'shaft_material', 'select', null::text, false, true, true, false),
    ('Knurling', 'knurling', 'select', null::text, false, true, true, false),
    ('Bar Type', 'bar_type', 'select', null::text, false, true, true, false),
    ('Hole Diameter', 'hole_diameter', 'number', 'cm', false, true, false, true),
    ('Plate Type', 'plate_type', 'select', null::text, false, true, true, false),
    ('Thickness', 'thickness', 'select', null::text, false, true, true, false),
    ('Fixed/Adjustable', 'fixed_adjustable', 'select', null::text, false, true, true, false),
    ('Resistance Level', 'resistance_level', 'select', null::text, false, true, true, false),
    ('Width', 'width', 'number', 'cm', false, true, false, true),
    ('Handle Type', 'handle_type', 'select', null::text, false, true, true, false),
    ('Set Quantity', 'set_quantity', 'number', null::text, false, true, false, true),
    ('Bar Length', 'bar_length', 'number', 'cm', false, true, false, true),
    ('Mounting Type', 'mounting_type', 'select', null::text, false, true, true, false),
    ('Grip Type', 'grip_type', 'select', null::text, false, true, true, false),
    ('Dimensions', 'dimensions', 'dimensions', 'cm', false, false, false, false),
    ('Bench Type', 'bench_type', 'select', null::text, false, true, true, false),
    ('Adjustable Positions', 'adjustable_positions', 'select', null::text, false, true, true, false),
    ('Padding Material', 'padding_material', 'select', null::text, false, true, true, false),
    ('Frame Material', 'frame_material', 'select', null::text, false, true, true, false),
    ('Height', 'height', 'number', 'cm', false, true, false, true),
    ('Depth', 'depth', 'number', 'cm', false, true, false, true),
    ('Rack Type', 'rack_type', 'select', null::text, false, true, true, false),
    ('Adjustable', 'adjustable', 'boolean', null::text, false, true, false, false),
    ('Machine Type', 'machine_type', 'select', null::text, false, true, true, false),
    ('Cable Ratio', 'cable_ratio', 'text', null::text, false, false, true, false),
    ('Weight Stack', 'weight_stack', 'select', null::text, false, true, true, false),
    ('Attachments Included', 'attachments_included', 'multiselect', null::text, false, true, true, false),
    ('Target Muscle', 'target_muscle', 'select', null::text, false, true, true, false),
    ('Adjustability', 'adjustability', 'select', null::text, false, true, true, false),
    ('Motor Power', 'motor_power', 'number', 'W', false, true, false, true),
    ('Speed Range', 'speed_range', 'select', null::text, false, true, true, false),
    ('Incline Range', 'incline_range', 'select', null::text, false, true, true, false),
    ('Running Surface', 'running_surface', 'select', null::text, false, true, true, false),
    ('Maximum User Weight', 'maximum_user_weight', 'number', 'kg', false, true, false, true),
    ('Foldable', 'foldable', 'boolean', null::text, false, true, false, false),
    ('Display Features', 'display_features', 'select', null::text, false, true, true, false),
    ('Bike Type', 'bike_type', 'select', null::text, false, true, true, false),
    ('Resistance Type', 'resistance_type', 'select', null::text, false, true, true, false),
    ('Resistance Levels', 'resistance_levels', 'select', null::text, false, true, true, false),
    ('Rail Length', 'rail_length', 'number', 'cm', false, true, false, true),
    ('Non-Slip', 'non_slip', 'boolean', null::text, false, true, false, false),
    ('Firmness', 'firmness', 'select', null::text, false, true, true, false),
    ('Surface Type', 'surface_type', 'select', null::text, false, true, true, false),
    ('Wheel Diameter', 'wheel_diameter', 'number', 'cm', false, true, false, true),
    ('Single/Dual Wheel', 'single_dual_wheel', 'select', null::text, false, true, true, false),
    ('Bearing Type', 'bearing_type', 'select', null::text, false, true, true, false),
    ('Palm Padding', 'palm_padding', 'select', null::text, false, true, true, false),
    ('Buckle Type', 'buckle_type', 'select', null::text, false, true, true, false),
    ('Padding', 'padding', 'select', null::text, false, true, true, false),
    ('Capacity', 'capacity', 'number', 'L', false, true, false, true),
    ('Leakproof', 'leakproof', 'boolean', null::text, false, true, false, false),
    ('Mixing System', 'mixing_system', 'select', null::text, false, true, true, false),
    ('Compartments', 'compartments', 'select', null::text, false, true, true, false),
    ('Absorbency', 'absorbency', 'select', null::text, false, true, true, false),
    ('Shoe Compartment', 'shoe_compartment', 'select', null::text, false, true, true, false),
    ('Protein Type', 'protein_type', 'select', null::text, false, true, true, false),
    ('Flavor', 'flavor', 'select', null::text, true, true, true, false),
    ('Net Weight', 'net_weight', 'number', 'kg', false, true, false, true),
    ('Serving Size', 'serving_size', 'select', null::text, false, true, true, false),
    ('Servings', 'servings', 'select', null::text, false, true, true, false),
    ('Protein per Serving', 'protein_per_serving', 'select', null::text, false, true, true, false),
    ('Calories', 'calories', 'select', null::text, false, true, true, false),
    ('Carbohydrates', 'carbohydrates', 'select', null::text, false, true, true, false),
    ('Fat', 'fat', 'select', null::text, false, true, true, false),
    ('Ingredients', 'ingredients', 'textarea', null::text, false, false, true, false),
    ('Sweetener', 'sweetener', 'select', null::text, false, true, true, false),
    ('Allergen Information', 'allergen_information', 'textarea', null::text, false, false, false, false),
    ('Recommended Usage', 'recommended_usage', 'select', null::text, false, true, true, false),
    ('Expiration Date', 'expiration_date', 'date', null::text, false, true, false, false),
    ('Batch Number', 'batch_number', 'select', null::text, false, true, true, false),
    ('Allergens', 'allergens', 'multiselect', null::text, false, true, true, false),
    ('Creatine Type', 'creatine_type', 'select', null::text, false, true, true, false),
    ('Creatine per Serving', 'creatine_per_serving', 'select', null::text, false, true, true, false),
    ('Caffeine per Serving', 'caffeine_per_serving', 'select', null::text, false, true, true, false),
    ('Beta-Alanine', 'beta_alanine', 'select', null::text, false, true, true, false),
    ('Citrulline', 'citrulline', 'select', null::text, false, true, true, false),
    ('BCAA Ratio', 'bcaa_ratio', 'text', null::text, false, false, true, false),
    ('Amino Acids', 'amino_acids', 'multiselect', null::text, false, true, true, false),
    ('Amino Acid Profile', 'amino_acid_profile', 'select', null::text, false, true, true, false),
    ('Protein', 'protein', 'select', null::text, false, true, true, false),
    ('Sodium', 'sodium', 'select', null::text, false, true, true, false),
    ('Potassium', 'potassium', 'select', null::text, false, true, true, false),
    ('Magnesium', 'magnesium', 'select', null::text, false, true, true, false),
    ('Vitamin Type', 'vitamin_type', 'select', null::text, false, true, true, false),
    ('Form', 'form', 'select', null::text, false, true, true, false),
    ('Dosage', 'dosage', 'select', null::text, false, true, true, false),
    ('Mineral Type', 'mineral_type', 'select', null::text, false, true, true, false),
    ('Product Type', 'product_type', 'select', null::text, false, true, true, false),
    ('Movement', 'movement', 'select', null::text, false, true, true, false),
    ('Case Material', 'case_material', 'select', null::text, false, true, true, false),
    ('Case Diameter', 'case_diameter', 'number', 'cm', false, true, false, true),
    ('Strap Material', 'strap_material', 'select', null::text, false, true, true, false),
    ('Strap Color', 'strap_color', 'color', null::text, false, true, true, false),
    ('Water Resistance', 'water_resistance', 'select', null::text, false, true, true, false),
    ('Display Type', 'display_type', 'select', null::text, false, true, true, false),
    ('Battery Type', 'battery_type', 'select', null::text, false, true, true, false),
    ('Features', 'features', 'multiselect', null::text, false, true, true, false),
    ('Lens Material', 'lens_material', 'select', null::text, false, true, true, false),
    ('Lens Color', 'lens_color', 'color', null::text, false, true, true, false),
    ('Frame Color', 'frame_color', 'color', null::text, false, true, true, false),
    ('Lens Type', 'lens_type', 'select', null::text, false, true, true, false),
    ('Polarized', 'polarized', 'select', null::text, false, true, true, false),
    ('Frame Shape', 'frame_shape', 'select', null::text, false, true, true, false),
    ('Card Slots', 'card_slots', 'select', null::text, false, true, true, false),
    ('Coin Pocket', 'coin_pocket', 'select', null::text, false, true, true, false),
    ('Closure Type', 'closure_type', 'select', null::text, false, true, true, false),
    ('Laptop Compatibility', 'laptop_compatibility', 'select', null::text, false, true, true, false),
    ('Jewelry Type', 'jewelry_type', 'select', null::text, false, true, true, false),
    ('Metal Type', 'metal_type', 'select', null::text, false, true, true, false),
    ('Stone Type', 'stone_type', 'select', null::text, false, true, true, false),
    ('Plating', 'plating', 'select', null::text, false, true, true, false),
    ('Theme', 'theme', 'select', null::text, false, true, true, false),
    ('Attachment Type', 'attachment_type', 'select', null::text, false, true, true, false),
    ('Condition', 'condition', 'select', null::text, false, true, true, false),
    ('Operating System', 'operating_system', 'select', null::text, false, true, true, false),
    ('Screen Size', 'screen_size', 'number', 'in', false, true, false, true),
    ('Resolution', 'resolution', 'select', null::text, false, true, true, false),
    ('Refresh Rate', 'refresh_rate', 'number', 'Hz', false, true, false, true),
    ('RAM', 'ram', 'select', null::text, true, true, true, false),
    ('Storage', 'storage', 'select', null::text, true, true, true, false),
    ('Processor', 'processor', 'select', null::text, false, true, true, false),
    ('Main Camera', 'main_camera', 'select', null::text, false, true, true, false),
    ('Front Camera', 'front_camera', 'select', null::text, false, true, true, false),
    ('Battery Capacity', 'battery_capacity', 'number', 'mAh', false, true, false, true),
    ('5G', '5g', 'boolean', null::text, false, true, false, false),
    ('SIM Type', 'sim_type', 'select', null::text, false, true, true, false),
    ('NFC', 'nfc', 'boolean', null::text, false, true, false, false),
    ('Bluetooth', 'bluetooth', 'boolean', null::text, false, true, false, false),
    ('Wi-Fi', 'wi_fi', 'select', null::text, false, true, true, false),
    ('Camera', 'camera', 'select', null::text, false, true, true, false),
    ('Cellular Connectivity', 'cellular_connectivity', 'select', null::text, false, true, true, false),
    ('GPU', 'gpu', 'select', null::text, false, true, true, false),
    ('Battery', 'battery', 'select', null::text, false, true, true, false),
    ('Ports', 'ports', 'select', null::text, false, true, true, false),
    ('Keyboard Layout', 'keyboard_layout', 'select', null::text, false, true, true, false),
    ('OS', 'os', 'select', null::text, false, true, true, false),
    ('Battery Life', 'battery_life', 'number', 'h', false, true, false, true),
    ('GPS', 'gps', 'select', null::text, false, true, true, false),
    ('Health Features', 'health_features', 'select', null::text, false, true, true, false),
    ('Connectivity', 'connectivity', 'select', null::text, false, true, true, false),
    ('Connection', 'connection', 'select', null::text, false, true, true, false),
    ('Bluetooth Version', 'bluetooth_version', 'select', null::text, false, true, true, false),
    ('Noise Cancellation', 'noise_cancellation', 'select', null::text, false, true, true, false),
    ('Microphone', 'microphone', 'select', null::text, false, true, true, false),
    ('Driver Size', 'driver_size', 'select', null::text, false, true, true, false),
    ('Charging Case Capacity', 'charging_case_capacity', 'number', 'L', false, true, false, true),
    ('Power Output', 'power_output', 'number', 'W', false, true, false, true),
    ('Frequency Response', 'frequency_response', 'select', null::text, false, true, true, false),
    ('Input', 'input', 'select', null::text, false, true, true, false),
    ('Output', 'output', 'select', null::text, false, true, true, false),
    ('Fast Charging', 'fast_charging', 'select', null::text, false, true, true, false),
    ('Number of Ports', 'number_of_ports', 'number', null::text, false, true, false, true),
    ('Charger Type', 'charger_type', 'select', null::text, false, true, true, false),
    ('Voltage', 'voltage', 'number', 'V', false, true, false, true),
    ('Current', 'current', 'select', null::text, false, true, true, false),
    ('Port Type', 'port_type', 'select', null::text, false, true, true, false),
    ('Compatibility', 'compatibility', 'multiselect', null::text, false, true, true, false),
    ('Cable Type', 'cable_type', 'select', null::text, false, true, true, false),
    ('Connector A', 'connector_a', 'select', null::text, false, true, true, false),
    ('Connector B', 'connector_b', 'select', null::text, false, true, true, false),
    ('Data Transfer Speed', 'data_transfer_speed', 'select', null::text, false, true, true, false),
    ('Charging Power', 'charging_power', 'select', null::text, false, true, true, false),
    ('Switch Type', 'switch_type', 'select', null::text, false, true, true, false),
    ('Layout', 'layout', 'select', null::text, false, true, true, false),
    ('RGB', 'rgb', 'select', null::text, false, true, true, false),
    ('Backlight', 'backlight', 'select', null::text, false, true, true, false),
    ('Sensor Type', 'sensor_type', 'select', null::text, false, true, true, false),
    ('DPI', 'dpi', 'select', null::text, false, true, true, false),
    ('Buttons', 'buttons', 'select', null::text, false, true, true, false),
    ('Polling Rate', 'polling_rate', 'select', null::text, false, true, true, false),
    ('Socket', 'socket', 'select', null::text, false, true, true, false),
    ('Cores', 'cores', 'select', null::text, false, true, true, false),
    ('Threads', 'threads', 'select', null::text, false, true, true, false),
    ('Base Clock', 'base_clock', 'select', null::text, false, true, true, false),
    ('Boost Clock', 'boost_clock', 'select', null::text, false, true, true, false),
    ('Cache', 'cache', 'select', null::text, false, true, true, false),
    ('TDP', 'tdp', 'select', null::text, false, true, true, false),
    ('Integrated Graphics', 'integrated_graphics', 'select', null::text, false, true, true, false),
    ('VRAM', 'vram', 'select', null::text, false, true, true, false),
    ('Memory Type', 'memory_type', 'select', null::text, false, true, true, false),
    ('Memory Interface', 'memory_interface', 'select', null::text, false, true, true, false),
    ('Power Consumption', 'power_consumption', 'select', null::text, false, true, true, false),
    ('Recommended PSU', 'recommended_psu', 'select', null::text, false, true, true, false),
    ('Chipset', 'chipset', 'select', null::text, false, true, true, false),
    ('Form Factor', 'form_factor', 'select', null::text, false, true, true, false),
    ('RAM Type', 'ram_type', 'select', null::text, false, true, true, false),
    ('Maximum RAM', 'maximum_ram', 'select', null::text, false, true, true, false),
    ('RAM Slots', 'ram_slots', 'select', null::text, false, true, true, false),
    ('Expansion Slots', 'expansion_slots', 'select', null::text, false, true, true, false),
    ('Storage Interfaces', 'storage_interfaces', 'select', null::text, false, true, true, false),
    ('Speed', 'speed', 'select', null::text, false, true, true, false),
    ('CAS Latency', 'cas_latency', 'select', null::text, false, true, true, false),
    ('Module Type', 'module_type', 'select', null::text, false, true, true, false),
    ('Number of Modules', 'number_of_modules', 'number', null::text, false, true, false, true),
    ('Interface', 'interface', 'select', null::text, false, true, true, false),
    ('Read Speed', 'read_speed', 'select', null::text, false, true, true, false),
    ('Write Speed', 'write_speed', 'select', null::text, false, true, true, false),
    ('NAND Type', 'nand_type', 'select', null::text, false, true, true, false),
    ('TBW', 'tbw', 'select', null::text, false, true, true, false),
    ('RPM', 'rpm', 'select', null::text, false, true, true, false),
    ('Cache Size', 'cache_size', 'select', null::text, false, true, true, false),
    ('Recording Technology', 'recording_technology', 'select', null::text, false, true, true, false),
    ('Efficiency Rating', 'efficiency_rating', 'select', null::text, false, true, true, false),
    ('Modular', 'modular', 'select', null::text, false, true, true, false),
    ('Connectors', 'connectors', 'select', null::text, false, true, true, false),
    ('Fan Size', 'fan_size', 'select', null::text, false, true, true, false),
    ('Motherboard Compatibility', 'motherboard_compatibility', 'select', null::text, false, true, true, false),
    ('GPU Length', 'gpu_length', 'number', 'cm', false, true, false, true),
    ('CPU Cooler Height', 'cpu_cooler_height', 'number', 'cm', false, true, false, true),
    ('Fan Support', 'fan_support', 'select', null::text, false, true, true, false),
    ('Radiator Support', 'radiator_support', 'select', null::text, false, true, true, false),
    ('Cooling Type', 'cooling_type', 'select', null::text, false, true, true, false),
    ('Socket Compatibility', 'socket_compatibility', 'select', null::text, false, true, true, false),
    ('Fan Speed', 'fan_speed', 'select', null::text, false, true, true, false),
    ('Noise Level', 'noise_level', 'select', null::text, false, true, true, false),
    ('Radiator Size', 'radiator_size', 'select', null::text, false, true, true, false),
    ('Panel Type', 'panel_type', 'select', null::text, false, true, true, false),
    ('Response Time', 'response_time', 'select', null::text, false, true, true, false),
    ('HDR', 'hdr', 'select', null::text, false, true, true, false),
    ('Adaptive Sync', 'adaptive_sync', 'select', null::text, false, true, true, false),
    ('VESA Mount', 'vesa_mount', 'select', null::text, false, true, true, false),
    ('Platform', 'platform', 'select', null::text, false, true, true, false),
    ('Included Accessories', 'included_accessories', 'multiselect', null::text, false, true, true, false),
    ('Region', 'region', 'select', null::text, false, true, true, false),
    ('Connection Type', 'connection_type', 'select', null::text, false, true, true, false),
    ('Vibration', 'vibration', 'select', null::text, false, true, true, false),
    ('Motion Control', 'motion_control', 'select', null::text, false, true, true, false),
    ('Surround Sound', 'surround_sound', 'select', null::text, false, true, true, false),
    ('Upholstery', 'upholstery', 'select', null::text, false, true, true, false),
    ('Seat Width', 'seat_width', 'number', 'cm', false, true, false, true),
    ('Height Range', 'height_range', 'select', null::text, false, true, true, false),
    ('Recline Angle', 'recline_angle', 'select', null::text, false, true, true, false),
    ('Armrest Type', 'armrest_type', 'select', null::text, false, true, true, false),
    ('Footrest', 'footrest', 'boolean', null::text, false, true, false, false),
    ('Cable Management', 'cable_management', 'select', null::text, false, true, true, false),
    ('Adjustable Height', 'adjustable_height', 'boolean', null::text, false, true, false, false),
    ('Macro Support', 'macro_support', 'select', null::text, false, true, true, false),
    ('Sensor', 'sensor', 'select', null::text, false, true, true, false),
    ('Title', 'title', 'select', null::text, false, true, true, false),
    ('Genre', 'genre', 'select', null::text, false, true, true, false),
    ('Edition', 'edition', 'select', null::text, false, true, true, false),
    ('Age Rating', 'age_rating', 'select', null::text, false, true, true, false),
    ('Physical/Digital', 'physical_digital', 'select', null::text, false, true, true, false),
    ('Language', 'language', 'select', null::text, false, true, true, false),
    ('Upholstery Material', 'upholstery_material', 'select', null::text, false, true, true, false),
    ('Seat Height', 'seat_height', 'number', 'cm', false, true, false, true),
    ('Number of Seats', 'number_of_seats', 'number', null::text, false, true, false, true),
    ('Cushion Material', 'cushion_material', 'select', null::text, false, true, true, false),
    ('Cushion Removable', 'cushion_removable', 'boolean', null::text, false, true, false, false),
    ('Reclining', 'reclining', 'boolean', null::text, false, true, false, false),
    ('Sofa Configuration', 'sofa_configuration', 'select', null::text, false, true, true, false),
    ('Assembly Required', 'assembly_required', 'boolean', null::text, false, true, false, false),
    ('Room Type', 'room_type', 'select', null::text, false, true, true, false),
    ('Chair Type', 'chair_type', 'select', null::text, false, true, true, false),
    ('Armrests', 'armrests', 'boolean', null::text, false, true, false, false),
    ('Wheels', 'wheels', 'boolean', null::text, false, true, false, false),
    ('Stackable', 'stackable', 'boolean', null::text, false, true, false, false),
    ('Seat Height Range', 'seat_height_range', 'select', null::text, false, true, true, false),
    ('Backrest Type', 'backrest_type', 'select', null::text, false, true, true, false),
    ('Lumbar Support', 'lumbar_support', 'boolean', null::text, false, true, false, false),
    ('Headrest', 'headrest', 'boolean', null::text, false, true, false, false),
    ('Table Type', 'table_type', 'select', null::text, false, true, true, false),
    ('Extendable', 'extendable', 'boolean', null::text, false, true, false, false),
    ('Number of Shelves', 'number_of_shelves', 'number', null::text, false, true, false, true),
    ('Desk Type', 'desk_type', 'select', null::text, false, true, true, false),
    ('Number of Drawers', 'number_of_drawers', 'number', null::text, false, true, false, true),
    ('Bed Type', 'bed_type', 'select', null::text, false, true, true, false),
    ('Mattress Size', 'mattress_size', 'select', null::text, false, true, true, false),
    ('Headboard', 'headboard', 'select', null::text, false, true, true, false),
    ('Mattress Type', 'mattress_type', 'select', null::text, false, true, true, false),
    ('Filling Material', 'filling_material', 'select', null::text, false, true, true, false),
    ('Hypoallergenic', 'hypoallergenic', 'boolean', null::text, false, true, false, false),
    ('Removable Cover', 'removable_cover', 'select', null::text, false, true, true, false),
    ('Number of Doors', 'number_of_doors', 'number', null::text, false, true, false, true),
    ('Door Type', 'door_type', 'select', null::text, false, true, true, false),
    ('Hanging Rail', 'hanging_rail', 'select', null::text, false, true, true, false),
    ('Drawers', 'drawers', 'select', null::text, false, true, true, false),
    ('Door Count', 'door_count', 'number', null::text, false, true, false, true),
    ('Drawer Count', 'drawer_count', 'number', null::text, false, true, false, true),
    ('Shelf Count', 'shelf_count', 'number', null::text, false, true, false, true),
    ('Lockable', 'lockable', 'boolean', null::text, false, true, false, false),
    ('Maximum Load Per Shelf', 'maximum_load_per_shelf', 'number', 'kg', false, true, false, true),
    ('Wall Mounted/Freestanding', 'wall_mounted_freestanding', 'select', null::text, false, true, true, false),
    ('Adjustable Shelves', 'adjustable_shelves', 'boolean', null::text, false, true, false, false),
    ('TV Size Compatibility', 'tv_size_compatibility', 'select', null::text, false, true, true, false),
    ('Shelves', 'shelves', 'select', null::text, false, true, true, false),
    ('Cabinets', 'cabinets', 'select', null::text, false, true, true, false),
    ('Lid Type', 'lid_type', 'select', null::text, false, true, true, false),
    ('Handles', 'handles', 'select', null::text, false, true, true, false),
    ('Installation Type', 'installation_type', 'select', null::text, false, true, true, false),
    ('Light Type', 'light_type', 'select', null::text, false, true, true, false),
    ('Bulb Type', 'bulb_type', 'select', null::text, false, true, true, false),
    ('Wattage', 'wattage', 'number', 'W', false, true, false, true),
    ('Lumens', 'lumens', 'number', 'lm', false, true, false, true),
    ('Color Temperature', 'color_temperature', 'number', 'K', false, true, false, true),
    ('Dimmable', 'dimmable', 'boolean', null::text, false, true, false, false),
    ('IP Rating', 'ip_rating', 'select', null::text, false, true, true, false),
    ('Smart Features', 'smart_features', 'select', null::text, false, true, true, false),
    ('Lamp Type', 'lamp_type', 'select', null::text, false, true, true, false),
    ('Cable Length', 'cable_length', 'number', 'cm', false, true, false, true),
    ('Quantity', 'quantity', 'number', null::text, false, true, false, true),
    ('Dishwasher Safe', 'dishwasher_safe', 'boolean', null::text, false, true, false, false),
    ('Microwave Safe', 'microwave_safe', 'boolean', null::text, false, true, false, false),
    ('Oven Safe', 'oven_safe', 'boolean', null::text, false, true, false, false),
    ('Food Safe', 'food_safe', 'boolean', null::text, false, true, false, false),
    ('Non-Stick', 'non_stick', 'boolean', null::text, false, true, false, false),
    ('Induction Compatible', 'induction_compatible', 'boolean', null::text, false, true, false, false),
    ('Blackout', 'blackout', 'boolean', null::text, false, true, false, false),
    ('Thermal Insulation', 'thermal_insulation', 'boolean', null::text, false, true, false, false),
    ('Pile Height', 'pile_height', 'number', 'cm', false, true, false, true),
    ('Indoor/Outdoor', 'indoor_outdoor', 'select', null::text, false, true, true, false),
    ('Washable', 'washable', 'boolean', null::text, false, true, false, false),
    ('Mirror Type', 'mirror_type', 'select', null::text, false, true, true, false),
    ('Handmade', 'handmade', 'boolean', null::text, false, true, false, false),
    ('Volume', 'volume', 'select', null::text, false, true, true, false),
    ('Skin Type', 'skin_type', 'select', null::text, false, true, true, false),
    ('Fragrance', 'fragrance', 'select', null::text, false, true, true, false),
    ('Benefits', 'benefits', 'multiselect', null::text, false, true, true, false),
    ('SPF', 'spf', 'select', null::text, false, true, true, false),
    ('Skin Concern', 'skin_concern', 'select', null::text, false, true, true, false),
    ('Suitable Age', 'suitable_age', 'select', null::text, false, true, true, false),
    ('Hair Type', 'hair_type', 'select', null::text, false, true, true, false),
    ('Hair Concern', 'hair_concern', 'select', null::text, false, true, true, false),
    ('Shade', 'shade', 'select', null::text, false, true, true, false),
    ('Finish', 'finish', 'select', null::text, false, true, true, false),
    ('Coverage', 'coverage', 'select', null::text, false, true, true, false),
    ('Fragrance Family', 'fragrance_family', 'select', null::text, false, true, true, false),
    ('Top Notes', 'top_notes', 'select', null::text, false, true, true, false),
    ('Heart Notes', 'heart_notes', 'select', null::text, false, true, true, false),
    ('Base Notes', 'base_notes', 'select', null::text, false, true, true, false),
    ('Concentration', 'concentration', 'select', null::text, false, true, true, false),
    ('Power Source', 'power_source', 'select', null::text, false, true, true, false),
    ('Attachments', 'attachments', 'multiselect', null::text, false, true, true, false),
    ('Skin/Hair Type', 'skin_hair_type', 'select', null::text, false, true, true, false),
    ('Blade Count', 'blade_count', 'number', null::text, false, true, false, true),
    ('Laptop Size', 'laptop_size', 'select', null::text, false, true, true, false),
    ('Adjustable Strap', 'adjustable_strap', 'boolean', null::text, false, true, false, false),
    ('Lock Type', 'lock_type', 'select', null::text, false, true, true, false),
    ('Expandable', 'expandable', 'select', null::text, false, true, true, false),
    ('Hard/Soft Shell', 'hard_soft_shell', 'select', null::text, false, true, true, false),
    ('Vehicle Make', 'vehicle_make', 'select', null::text, false, true, true, false),
    ('Vehicle Model', 'vehicle_model', 'select', null::text, false, true, true, false),
    ('Vehicle Year', 'vehicle_year', 'select', null::text, false, true, true, false),
    ('Motorcycle Make', 'motorcycle_make', 'select', null::text, false, true, true, false),
    ('Year', 'year', 'select', null::text, false, true, true, false),
    ('Device Type', 'device_type', 'select', null::text, false, true, true, false),
    ('Vehicle Compatibility', 'vehicle_compatibility', 'select', null::text, false, true, true, false),
    ('Power', 'power', 'number', 'W', false, true, false, true),
    ('Display', 'display', 'select', null::text, false, true, true, false),
    ('Application', 'application', 'select', null::text, false, true, true, false),
    ('Tool Type', 'tool_type', 'select', null::text, false, true, true, false),
    ('Construction', 'construction', 'select', null::text, false, true, true, false),
    ('Certification', 'certification', 'select', null::text, false, true, true, false),
    ('Head Size', 'head_size', 'select', null::text, false, true, true, false),
    ('Balance', 'balance', 'select', null::text, false, true, true, false),
    ('String Pattern', 'string_pattern', 'select', null::text, false, true, true, false),
    ('Grip Size', 'grip_size', 'select', null::text, false, true, true, false),
    ('Frame Size', 'frame_size', 'select', null::text, false, true, true, false),
    ('Wheel Size', 'wheel_size', 'select', null::text, false, true, true, false),
    ('Brake Type', 'brake_type', 'select', null::text, false, true, true, false),
    ('Gear Count', 'gear_count', 'number', null::text, false, true, false, true),
    ('Suspension', 'suspension', 'select', null::text, false, true, true, false),
    ('Number of Persons', 'number_of_persons', 'number', null::text, false, true, false, true),
    ('Line Capacity', 'line_capacity', 'number', 'L', false, true, false, true),
    ('Action', 'action', 'select', null::text, false, true, true, false),
    ('Author', 'author', 'select', null::text, false, true, true, false),
    ('Publisher', 'publisher', 'select', null::text, false, true, true, false),
    ('ISBN', 'isbn', 'select', null::text, false, true, true, false),
    ('Publication Date', 'publication_date', 'date', null::text, false, true, false, false),
    ('Number of Pages', 'number_of_pages', 'number', null::text, false, true, false, true),
    ('Format', 'format', 'select', null::text, false, true, true, false),
    ('Subject', 'subject', 'select', null::text, false, true, true, false),
    ('Education Level', 'education_level', 'select', null::text, false, true, true, false),
    ('Author/Creator', 'author_creator', 'select', null::text, false, true, true, false),
    ('Paper Type', 'paper_type', 'select', null::text, false, true, true, false),
    ('Cover Material', 'cover_material', 'select', null::text, false, true, true, false),
    ('Binding Type', 'binding_type', 'select', null::text, false, true, true, false),
    ('Intended Use', 'intended_use', 'select', null::text, false, true, true, false),
    ('Age Group', 'age_group', 'select', null::text, false, true, true, false),
    ('Educational Level', 'educational_level', 'select', null::text, false, true, true, false),
    ('Skill Developed', 'skill_developed', 'select', null::text, false, true, true, false),
    ('Safety Certification', 'safety_certification', 'select', null::text, false, true, true, false),
    ('Age Range', 'age_range', 'select', null::text, false, true, true, false),
    ('Care Instructions', 'care_instructions', 'select', null::text, false, true, true, false),
    ('Toy Type', 'toy_type', 'select', null::text, false, true, true, false),
    ('Battery Required', 'battery_required', 'boolean', null::text, false, true, false, false),
    ('Wheel Type', 'wheel_type', 'select', null::text, false, true, true, false),
    ('Safety Features', 'safety_features', 'select', null::text, false, true, true, false),
    ('BPA Free', 'bpa_free', 'boolean', null::text, false, true, false, false),
    ('Pet Type', 'pet_type', 'select', null::text, false, true, true, false),
    ('Breed Size', 'breed_size', 'select', null::text, false, true, true, false),
    ('Age', 'age', 'select', null::text, false, true, true, false),
    ('Nutritional Information', 'nutritional_information', 'select', null::text, false, true, true, false),
    ('Chew Resistant', 'chew_resistant', 'boolean', null::text, false, true, false, false),
    ('Weight Capacity', 'weight_capacity', 'number', 'L', false, true, false, true),
    ('Suitable Coat Type', 'suitable_coat_type', 'select', null::text, false, true, true, false),
    ('Battery Included', 'battery_included', 'boolean', null::text, false, true, false, false),
    ('Torque', 'torque', 'select', null::text, false, true, true, false),
    ('Measurement Range', 'measurement_range', 'select', null::text, false, true, true, false),
    ('Accuracy', 'accuracy', 'select', null::text, false, true, true, false),
    ('Units', 'units', 'select', null::text, false, true, true, false),
    ('Equipment Type', 'equipment_type', 'select', null::text, false, true, true, false),
    ('Country of Origin', 'country_of_origin', 'select', null::text, false, true, true, false),
    ('Caffeine', 'caffeine', 'select', null::text, false, true, true, false),
    ('Roast Level', 'roast_level', 'select', null::text, false, true, true, false),
    ('Origin', 'origin', 'select', null::text, false, true, true, false),
    ('Grind Type', 'grind_type', 'select', null::text, false, true, true, false),
    ('Flavor Notes', 'flavor_notes', 'select', null::text, false, true, true, false),
    ('Storage Instructions', 'storage_instructions', 'select', null::text, false, true, true, false),
    ('Storage Temperature', 'storage_temperature', 'select', null::text, false, true, true, false),
    ('Cooking Instructions', 'cooking_instructions', 'select', null::text, false, true, true, false),
    ('Print Technology', 'print_technology', 'select', null::text, false, true, true, false),
    ('Print Speed', 'print_speed', 'select', null::text, false, true, true, false),
    ('Paper Sizes', 'paper_sizes', 'select', null::text, false, true, true, false),
    ('Duplex Printing', 'duplex_printing', 'select', null::text, false, true, true, false),
    ('Ink/Toner Type', 'ink_toner_type', 'select', null::text, false, true, true, false),
    ('Paper Size', 'paper_size', 'select', null::text, false, true, true, false),
    ('Paper Weight', 'paper_weight', 'number', 'kg', false, true, false, true),
    ('Recycled', 'recycled', 'select', null::text, false, true, true, false),
    ('Ink Type', 'ink_type', 'select', null::text, false, true, true, false),
    ('Printer Compatibility', 'printer_compatibility', 'select', null::text, false, true, true, false),
    ('Page Yield', 'page_yield', 'select', null::text, false, true, true, false),
    ('Toner Type', 'toner_type', 'select', null::text, false, true, true, false),
    ('Pen Type', 'pen_type', 'select', null::text, false, true, true, false),
    ('Ink Color', 'ink_color', 'color', null::text, false, true, true, false),
    ('Tip Size', 'tip_size', 'select', null::text, false, true, true, false),
    ('Guitar Type', 'guitar_type', 'select', null::text, false, true, true, false),
    ('Body Material', 'body_material', 'select', null::text, false, true, true, false),
    ('Neck Material', 'neck_material', 'select', null::text, false, true, true, false),
    ('Number of Strings', 'number_of_strings', 'number', null::text, false, true, false, true),
    ('Number of Frets', 'number_of_frets', 'number', null::text, false, true, false, true),
    ('Pickup Type', 'pickup_type', 'select', null::text, false, true, true, false),
    ('Number of Keys', 'number_of_keys', 'number', null::text, false, true, false, true),
    ('Key Type', 'key_type', 'select', null::text, false, true, true, false),
    ('Polyphony', 'polyphony', 'select', null::text, false, true, true, false),
    ('Voices', 'voices', 'select', null::text, false, true, true, false),
    ('Drum Type', 'drum_type', 'select', null::text, false, true, true, false),
    ('Shell Material', 'shell_material', 'select', null::text, false, true, true, false),
    ('Number of Pieces', 'number_of_pieces', 'number', null::text, false, true, false, true),
    ('Microphone Type', 'microphone_type', 'select', null::text, false, true, true, false),
    ('Polar Pattern', 'polar_pattern', 'select', null::text, false, true, true, false),
    ('Sensitivity', 'sensitivity', 'select', null::text, false, true, true, false),
    ('Phantom Power', 'phantom_power', 'select', null::text, false, true, true, false),
    ('Speaker Type', 'speaker_type', 'select', null::text, false, true, true, false),
    ('Inputs', 'inputs', 'select', null::text, false, true, true, false),
    ('Number of Inputs', 'number_of_inputs', 'number', null::text, false, true, false, true),
    ('Number of Outputs', 'number_of_outputs', 'number', null::text, false, true, false, true),
    ('Sample Rate', 'sample_rate', 'select', null::text, false, true, true, false),
    ('Bit Depth', 'bit_depth', 'select', null::text, false, true, true, false),
    ('Series', 'series', 'select', null::text, false, true, true, false),
    ('Character', 'character', 'select', null::text, false, true, true, false),
    ('Scale', 'scale', 'select', null::text, false, true, true, false),
    ('Release Year', 'release_year', 'select', null::text, false, true, true, false),
    ('Limited Edition', 'limited_edition', 'select', null::text, false, true, true, false),
    ('Authenticity', 'authenticity', 'select', null::text, false, true, true, false),
    ('Character/Player', 'character_player', 'select', null::text, false, true, true, false),
    ('Card Number', 'card_number', 'select', null::text, false, true, true, false),
    ('Rarity', 'rarity', 'select', null::text, false, true, true, false),
    ('Model Type', 'model_type', 'select', null::text, false, true, true, false),
    ('Item Type', 'item_type', 'select', null::text, false, true, true, false),
    ('Certificate of Authenticity', 'certificate_of_authenticity', 'select', null::text, false, true, true, false),
    ('Technique', 'technique', 'select', null::text, false, true, true, false),
    ('Customizable', 'customizable', 'select', null::text, false, true, true, false),
    ('Personalization', 'personalization', 'select', null::text, false, true, true, false),
    ('Production Time', 'production_time', 'select', null::text, false, true, true, false),
    ('Artwork Type', 'artwork_type', 'select', null::text, false, true, true, false),
    ('Artist', 'artist', 'select', null::text, false, true, true, false),
    ('Medium', 'medium', 'select', null::text, false, true, true, false),
    ('Framed', 'framed', 'select', null::text, false, true, true, false),
    ('Custom Text', 'custom_text', 'select', null::text, false, true, true, false),
    ('Custom Image', 'custom_image', 'select', null::text, false, true, true, false)
  ) as v(name, slug, field_type, unit, is_variant, filterable, searchable, sortable)
on conflict (slug) do update set
    field_type = excluded.field_type,
    unit       = excluded.unit,
    is_variant = excluded.is_variant,
    filterable = excluded.filterable,
    searchable = excluded.searchable,
    sortable   = excluded.sortable
  -- Only rows the seed still owns. Once the owner has corrected one in
  -- the attribute builder, admin_edited is true and the seed never writes
  -- over it again -- see supabase/taxonomy.sql.
  where not attributes.admin_edited;

-- ---- attribute options (only where the values are universal) ----
insert into attribute_options (attribute_id, label, value, display_order)
select a.id, v.label, v.label, v.ord
  from (values
  ('gender', 'Men', 0),
    ('gender', 'Women', 1),
    ('gender', 'Unisex', 2),
    ('gender', 'Boys', 3),
    ('gender', 'Girls', 4),
    ('material', 'Cotton', 0),
    ('material', 'Polyester', 1),
    ('material', 'Wool', 2),
    ('material', 'Linen', 3),
    ('material', 'Silk', 4),
    ('material', 'Leather', 5),
    ('material', 'Denim', 6),
    ('material', 'Nylon', 7),
    ('material', 'Wood', 8),
    ('material', 'Metal', 9),
    ('material', 'Steel', 10),
    ('material', 'Aluminium', 11),
    ('material', 'Plastic', 12),
    ('material', 'Glass', 13),
    ('material', 'Ceramic', 14),
    ('material', 'Rubber', 15),
    ('material', 'Bamboo', 16),
    ('material', 'Marble', 17),
    ('fit', 'Slim', 0),
    ('fit', 'Regular', 1),
    ('fit', 'Relaxed', 2),
    ('fit', 'Oversized', 3),
    ('fit', 'Athletic', 4),
    ('pattern', 'Solid', 0),
    ('pattern', 'Striped', 1),
    ('pattern', 'Checked', 2),
    ('pattern', 'Floral', 3),
    ('pattern', 'Printed', 4),
    ('pattern', 'Camouflage', 5),
    ('season', 'Spring', 0),
    ('season', 'Summer', 1),
    ('season', 'Autumn', 2),
    ('season', 'Winter', 3),
    ('season', 'All Season', 4),
    ('closure', 'Button', 0),
    ('closure', 'Zip', 1),
    ('closure', 'Drawstring', 2),
    ('closure', 'Elastic', 3),
    ('closure', 'Velcro', 4),
    ('closure', 'Buckle', 5),
    ('closure', 'Snap', 6),
    ('closure', 'Lace-Up', 7),
    ('closure', 'Pull-On', 8),
    ('condition', 'New', 0),
    ('condition', 'Used - Like New', 1),
    ('condition', 'Used - Good', 2),
    ('condition', 'Used - Fair', 3),
    ('condition', 'Refurbished', 4)
  ) as v(attr_slug, label, ord)
  join attributes a on a.slug = v.attr_slug
on conflict (attribute_id, value) do nothing;

-- ---- which attributes each product type asks for ----
insert into product_type_attributes (product_type_id, attribute_id, display_order)
select pt.id, a.id, v.ord
  from (values
  ('men_s_clothing__clothing', 't_shirts', 'gender', 0),
    ('men_s_clothing__clothing', 't_shirts', 'size', 1),
    ('men_s_clothing__clothing', 't_shirts', 'color', 2),
    ('men_s_clothing__clothing', 't_shirts', 'brand', 3),
    ('men_s_clothing__clothing', 't_shirts', 'material', 4),
    ('men_s_clothing__clothing', 't_shirts', 'fit', 5),
    ('men_s_clothing__clothing', 't_shirts', 'pattern', 6),
    ('men_s_clothing__clothing', 't_shirts', 'style', 7),
    ('men_s_clothing__clothing', 't_shirts', 'season', 8),
    ('men_s_clothing__clothing', 't_shirts', 'occasion', 9),
    ('men_s_clothing__clothing', 't_shirts', 'neck_type', 10),
    ('men_s_clothing__clothing', 't_shirts', 'sleeve_length', 11),
    ('men_s_clothing__clothing', 't_shirts', 'fabric_weight', 12),
    ('men_s_clothing__clothing', 't_shirts', 'stretch', 13),
    ('men_s_clothing__clothing', 'shirts', 'gender', 0),
    ('men_s_clothing__clothing', 'shirts', 'size', 1),
    ('men_s_clothing__clothing', 'shirts', 'color', 2),
    ('men_s_clothing__clothing', 'shirts', 'brand', 3),
    ('men_s_clothing__clothing', 'shirts', 'material', 4),
    ('men_s_clothing__clothing', 'shirts', 'fit', 5),
    ('men_s_clothing__clothing', 'shirts', 'pattern', 6),
    ('men_s_clothing__clothing', 'shirts', 'style', 7),
    ('men_s_clothing__clothing', 'shirts', 'collar_type', 8),
    ('men_s_clothing__clothing', 'shirts', 'sleeve_type', 9),
    ('men_s_clothing__clothing', 'shirts', 'closure', 10),
    ('men_s_clothing__clothing', 'shirts', 'pocket_type', 11),
    ('men_s_clothing__clothing', 'shirts', 'season', 12),
    ('men_s_clothing__clothing', 'hoodies', 'gender', 0),
    ('men_s_clothing__clothing', 'hoodies', 'size', 1),
    ('men_s_clothing__clothing', 'hoodies', 'color', 2),
    ('men_s_clothing__clothing', 'hoodies', 'brand', 3),
    ('men_s_clothing__clothing', 'hoodies', 'material', 4),
    ('men_s_clothing__clothing', 'hoodies', 'fit', 5),
    ('men_s_clothing__clothing', 'hoodies', 'pattern', 6),
    ('men_s_clothing__clothing', 'hoodies', 'hood_type', 7),
    ('men_s_clothing__clothing', 'hoodies', 'closure', 8),
    ('men_s_clothing__clothing', 'hoodies', 'pocket_type', 9),
    ('men_s_clothing__clothing', 'hoodies', 'fabric_thickness', 10),
    ('men_s_clothing__clothing', 'hoodies', 'season', 11),
    ('men_s_clothing__clothing', 'sweatshirts', 'gender', 0),
    ('men_s_clothing__clothing', 'sweatshirts', 'size', 1),
    ('men_s_clothing__clothing', 'sweatshirts', 'color', 2),
    ('men_s_clothing__clothing', 'sweatshirts', 'brand', 3),
    ('men_s_clothing__clothing', 'sweatshirts', 'material', 4),
    ('men_s_clothing__clothing', 'sweatshirts', 'fit', 5),
    ('men_s_clothing__clothing', 'sweatshirts', 'pattern', 6),
    ('men_s_clothing__clothing', 'sweatshirts', 'neck_type', 7),
    ('men_s_clothing__clothing', 'sweatshirts', 'fabric_thickness', 8),
    ('men_s_clothing__clothing', 'sweatshirts', 'season', 9),
    ('men_s_clothing__clothing', 'jackets', 'gender', 0),
    ('men_s_clothing__clothing', 'jackets', 'size', 1),
    ('men_s_clothing__clothing', 'jackets', 'color', 2),
    ('men_s_clothing__clothing', 'jackets', 'brand', 3),
    ('men_s_clothing__clothing', 'jackets', 'material', 4),
    ('men_s_clothing__clothing', 'jackets', 'fit', 5),
    ('men_s_clothing__clothing', 'jackets', 'pattern', 6),
    ('men_s_clothing__clothing', 'jackets', 'closure', 7),
    ('men_s_clothing__clothing', 'jackets', 'pocket_type', 8),
    ('men_s_clothing__clothing', 'jackets', 'lining', 9),
    ('men_s_clothing__clothing', 'jackets', 'waterproof', 10),
    ('men_s_clothing__clothing', 'jackets', 'season', 11),
    ('men_s_clothing__clothing', 'coats', 'gender', 0),
    ('men_s_clothing__clothing', 'coats', 'size', 1),
    ('men_s_clothing__clothing', 'coats', 'color', 2),
    ('men_s_clothing__clothing', 'coats', 'brand', 3),
    ('men_s_clothing__clothing', 'coats', 'material', 4),
    ('men_s_clothing__clothing', 'coats', 'fit', 5),
    ('men_s_clothing__clothing', 'coats', 'length', 6),
    ('men_s_clothing__clothing', 'coats', 'closure', 7),
    ('men_s_clothing__clothing', 'coats', 'hood_type', 8),
    ('men_s_clothing__clothing', 'coats', 'lining', 9),
    ('men_s_clothing__clothing', 'coats', 'insulation', 10),
    ('men_s_clothing__clothing', 'coats', 'waterproof', 11),
    ('men_s_clothing__clothing', 'coats', 'season', 12),
    ('men_s_clothing__clothing', 'vests', 'gender', 0),
    ('men_s_clothing__clothing', 'vests', 'size', 1),
    ('men_s_clothing__clothing', 'vests', 'color', 2),
    ('men_s_clothing__clothing', 'vests', 'brand', 3),
    ('men_s_clothing__clothing', 'vests', 'material', 4),
    ('men_s_clothing__clothing', 'vests', 'fit', 5),
    ('men_s_clothing__clothing', 'vests', 'closure', 6),
    ('men_s_clothing__clothing', 'vests', 'pocket_type', 7),
    ('men_s_clothing__clothing', 'vests', 'insulation', 8),
    ('men_s_clothing__clothing', 'vests', 'season', 9),
    ('men_s_clothing__clothing', 'jeans', 'gender', 0),
    ('men_s_clothing__clothing', 'jeans', 'waist_size', 1),
    ('men_s_clothing__clothing', 'jeans', 'length', 2),
    ('men_s_clothing__clothing', 'jeans', 'color', 3),
    ('men_s_clothing__clothing', 'jeans', 'brand', 4),
    ('men_s_clothing__clothing', 'jeans', 'material', 5),
    ('men_s_clothing__clothing', 'jeans', 'fit', 6),
    ('men_s_clothing__clothing', 'jeans', 'rise', 7),
    ('men_s_clothing__clothing', 'jeans', 'leg_style', 8),
    ('men_s_clothing__clothing', 'jeans', 'stretch', 9),
    ('men_s_clothing__clothing', 'jeans', 'wash', 10),
    ('men_s_clothing__clothing', 'jeans', 'closure', 11),
    ('men_s_clothing__clothing', 'trousers', 'gender', 0),
    ('men_s_clothing__clothing', 'trousers', 'waist_size', 1),
    ('men_s_clothing__clothing', 'trousers', 'length', 2),
    ('men_s_clothing__clothing', 'trousers', 'color', 3),
    ('men_s_clothing__clothing', 'trousers', 'brand', 4),
    ('men_s_clothing__clothing', 'trousers', 'material', 5),
    ('men_s_clothing__clothing', 'trousers', 'fit', 6),
    ('men_s_clothing__clothing', 'trousers', 'rise', 7),
    ('men_s_clothing__clothing', 'trousers', 'leg_style', 8),
    ('men_s_clothing__clothing', 'trousers', 'stretch', 9),
    ('men_s_clothing__clothing', 'trousers', 'closure', 10),
    ('men_s_clothing__clothing', 'trousers', 'pocket_type', 11),
    ('men_s_clothing__clothing', 'shorts', 'gender', 0),
    ('men_s_clothing__clothing', 'shorts', 'waist_size', 1),
    ('men_s_clothing__clothing', 'shorts', 'length', 2),
    ('men_s_clothing__clothing', 'shorts', 'color', 3),
    ('men_s_clothing__clothing', 'shorts', 'brand', 4),
    ('men_s_clothing__clothing', 'shorts', 'material', 5),
    ('men_s_clothing__clothing', 'shorts', 'fit', 6),
    ('men_s_clothing__clothing', 'shorts', 'liner', 7),
    ('men_s_clothing__clothing', 'shorts', 'stretch', 8),
    ('men_s_clothing__clothing', 'shorts', 'pocket_type', 9),
    ('men_s_clothing__clothing', 'shorts', 'closure', 10),
    ('men_s_clothing__clothing', 'joggers', 'gender', 0),
    ('men_s_clothing__clothing', 'joggers', 'size', 1),
    ('men_s_clothing__clothing', 'joggers', 'color', 2),
    ('men_s_clothing__clothing', 'joggers', 'brand', 3),
    ('men_s_clothing__clothing', 'joggers', 'material', 4),
    ('men_s_clothing__clothing', 'joggers', 'fit', 5),
    ('men_s_clothing__clothing', 'joggers', 'waist_type', 6),
    ('men_s_clothing__clothing', 'joggers', 'leg_style', 7),
    ('men_s_clothing__clothing', 'joggers', 'stretch', 8),
    ('men_s_clothing__clothing', 'joggers', 'pocket_type', 9),
    ('men_s_clothing__clothing', 'joggers', 'cuff_type', 10),
    ('men_s_clothing__clothing', 'tracksuits', 'gender', 0),
    ('men_s_clothing__clothing', 'tracksuits', 'size', 1),
    ('men_s_clothing__clothing', 'tracksuits', 'color', 2),
    ('men_s_clothing__clothing', 'tracksuits', 'brand', 3),
    ('men_s_clothing__clothing', 'tracksuits', 'material', 4),
    ('men_s_clothing__clothing', 'tracksuits', 'fit', 5),
    ('men_s_clothing__clothing', 'tracksuits', 'pieces_included', 6),
    ('men_s_clothing__clothing', 'tracksuits', 'closure', 7),
    ('men_s_clothing__clothing', 'tracksuits', 'stretch', 8),
    ('men_s_clothing__clothing', 'tracksuits', 'season', 9),
    ('men_s_clothing__clothing', 'underwear', 'gender', 0),
    ('men_s_clothing__clothing', 'underwear', 'size', 1),
    ('men_s_clothing__clothing', 'underwear', 'color', 2),
    ('men_s_clothing__clothing', 'underwear', 'brand', 3),
    ('men_s_clothing__clothing', 'underwear', 'material', 4),
    ('men_s_clothing__clothing', 'underwear', 'style', 5),
    ('men_s_clothing__clothing', 'underwear', 'fit', 6),
    ('men_s_clothing__clothing', 'underwear', 'waistband', 7),
    ('men_s_clothing__clothing', 'underwear', 'pack_size', 8),
    ('men_s_clothing__clothing', 'swimwear', 'gender', 0),
    ('men_s_clothing__clothing', 'swimwear', 'size', 1),
    ('men_s_clothing__clothing', 'swimwear', 'color', 2),
    ('men_s_clothing__clothing', 'swimwear', 'brand', 3),
    ('men_s_clothing__clothing', 'swimwear', 'material', 4),
    ('men_s_clothing__clothing', 'swimwear', 'style', 5),
    ('men_s_clothing__clothing', 'swimwear', 'fit', 6),
    ('men_s_clothing__clothing', 'swimwear', 'liner', 7),
    ('men_s_clothing__clothing', 'swimwear', 'uv_protection', 8),
    ('men_s_clothing__clothing', 'swimwear', 'pattern', 9),
    ('women_s_clothing__clothing', 't_shirts', 'gender', 0),
    ('women_s_clothing__clothing', 't_shirts', 'size', 1),
    ('women_s_clothing__clothing', 't_shirts', 'color', 2),
    ('women_s_clothing__clothing', 't_shirts', 'brand', 3),
    ('women_s_clothing__clothing', 't_shirts', 'material', 4),
    ('women_s_clothing__clothing', 't_shirts', 'fit', 5),
    ('women_s_clothing__clothing', 't_shirts', 'pattern', 6),
    ('women_s_clothing__clothing', 't_shirts', 'style', 7),
    ('women_s_clothing__clothing', 't_shirts', 'sleeve_length', 8),
    ('women_s_clothing__clothing', 't_shirts', 'neckline', 9),
    ('women_s_clothing__clothing', 't_shirts', 'stretch', 10),
    ('women_s_clothing__clothing', 'tops', 'size', 0),
    ('women_s_clothing__clothing', 'tops', 'color', 1),
    ('women_s_clothing__clothing', 'tops', 'brand', 2),
    ('women_s_clothing__clothing', 'tops', 'material', 3),
    ('women_s_clothing__clothing', 'tops', 'fit', 4),
    ('women_s_clothing__clothing', 'tops', 'pattern', 5),
    ('women_s_clothing__clothing', 'tops', 'style', 6),
    ('women_s_clothing__clothing', 'tops', 'neckline', 7),
    ('women_s_clothing__clothing', 'tops', 'sleeve_length', 8),
    ('women_s_clothing__clothing', 'tops', 'length', 9),
    ('women_s_clothing__clothing', 'tops', 'stretch', 10),
    ('women_s_clothing__clothing', 'blouses', 'size', 0),
    ('women_s_clothing__clothing', 'blouses', 'color', 1),
    ('women_s_clothing__clothing', 'blouses', 'brand', 2),
    ('women_s_clothing__clothing', 'blouses', 'material', 3),
    ('women_s_clothing__clothing', 'blouses', 'fit', 4),
    ('women_s_clothing__clothing', 'blouses', 'pattern', 5),
    ('women_s_clothing__clothing', 'blouses', 'collar_type', 6),
    ('women_s_clothing__clothing', 'blouses', 'sleeve_length', 7),
    ('women_s_clothing__clothing', 'blouses', 'closure', 8),
    ('women_s_clothing__clothing', 'blouses', 'occasion', 9),
    ('women_s_clothing__clothing', 'shirts', 'size', 0),
    ('women_s_clothing__clothing', 'shirts', 'color', 1),
    ('women_s_clothing__clothing', 'shirts', 'brand', 2),
    ('women_s_clothing__clothing', 'shirts', 'material', 3),
    ('women_s_clothing__clothing', 'shirts', 'fit', 4),
    ('women_s_clothing__clothing', 'shirts', 'pattern', 5),
    ('women_s_clothing__clothing', 'shirts', 'collar_type', 6),
    ('women_s_clothing__clothing', 'shirts', 'sleeve_type', 7),
    ('women_s_clothing__clothing', 'shirts', 'closure', 8),
    ('women_s_clothing__clothing', 'shirts', 'pocket_type', 9),
    ('women_s_clothing__clothing', 'dresses', 'size', 0),
    ('women_s_clothing__clothing', 'dresses', 'color', 1),
    ('women_s_clothing__clothing', 'dresses', 'brand', 2),
    ('women_s_clothing__clothing', 'dresses', 'material', 3),
    ('women_s_clothing__clothing', 'dresses', 'fit', 4),
    ('women_s_clothing__clothing', 'dresses', 'dress_type', 5),
    ('women_s_clothing__clothing', 'dresses', 'length', 6),
    ('women_s_clothing__clothing', 'dresses', 'neckline', 7),
    ('women_s_clothing__clothing', 'dresses', 'sleeve_length', 8),
    ('women_s_clothing__clothing', 'dresses', 'waist_type', 9),
    ('women_s_clothing__clothing', 'dresses', 'closure', 10),
    ('women_s_clothing__clothing', 'dresses', 'occasion', 11),
    ('women_s_clothing__clothing', 'skirts', 'size', 0),
    ('women_s_clothing__clothing', 'skirts', 'color', 1),
    ('women_s_clothing__clothing', 'skirts', 'brand', 2),
    ('women_s_clothing__clothing', 'skirts', 'material', 3),
    ('women_s_clothing__clothing', 'skirts', 'fit', 4),
    ('women_s_clothing__clothing', 'skirts', 'length', 5),
    ('women_s_clothing__clothing', 'skirts', 'waist_type', 6),
    ('women_s_clothing__clothing', 'skirts', 'pattern', 7),
    ('women_s_clothing__clothing', 'skirts', 'closure', 8),
    ('women_s_clothing__clothing', 'skirts', 'stretch', 9),
    ('women_s_clothing__clothing', 'jeans', 'size', 0),
    ('women_s_clothing__clothing', 'jeans', 'color', 1),
    ('women_s_clothing__clothing', 'jeans', 'brand', 2),
    ('women_s_clothing__clothing', 'jeans', 'material', 3),
    ('women_s_clothing__clothing', 'jeans', 'fit', 4),
    ('women_s_clothing__clothing', 'jeans', 'waist_size', 5),
    ('women_s_clothing__clothing', 'jeans', 'rise', 6),
    ('women_s_clothing__clothing', 'jeans', 'leg_style', 7),
    ('women_s_clothing__clothing', 'jeans', 'length', 8),
    ('women_s_clothing__clothing', 'jeans', 'stretch', 9),
    ('women_s_clothing__clothing', 'jeans', 'wash', 10),
    ('women_s_clothing__clothing', 'jeans', 'closure', 11),
    ('women_s_clothing__clothing', 'trousers', 'size', 0),
    ('women_s_clothing__clothing', 'trousers', 'color', 1),
    ('women_s_clothing__clothing', 'trousers', 'brand', 2),
    ('women_s_clothing__clothing', 'trousers', 'material', 3),
    ('women_s_clothing__clothing', 'trousers', 'fit', 4),
    ('women_s_clothing__clothing', 'trousers', 'waist_size', 5),
    ('women_s_clothing__clothing', 'trousers', 'rise', 6),
    ('women_s_clothing__clothing', 'trousers', 'leg_style', 7),
    ('women_s_clothing__clothing', 'trousers', 'length', 8),
    ('women_s_clothing__clothing', 'trousers', 'stretch', 9),
    ('women_s_clothing__clothing', 'trousers', 'closure', 10),
    ('women_s_clothing__clothing', 'shorts', 'size', 0),
    ('women_s_clothing__clothing', 'shorts', 'color', 1),
    ('women_s_clothing__clothing', 'shorts', 'brand', 2),
    ('women_s_clothing__clothing', 'shorts', 'material', 3),
    ('women_s_clothing__clothing', 'shorts', 'fit', 4),
    ('women_s_clothing__clothing', 'shorts', 'waist_size', 5),
    ('women_s_clothing__clothing', 'shorts', 'length', 6),
    ('women_s_clothing__clothing', 'shorts', 'rise', 7),
    ('women_s_clothing__clothing', 'shorts', 'stretch', 8),
    ('women_s_clothing__clothing', 'shorts', 'liner', 9),
    ('women_s_clothing__clothing', 'leggings', 'size', 0),
    ('women_s_clothing__clothing', 'leggings', 'color', 1),
    ('women_s_clothing__clothing', 'leggings', 'brand', 2),
    ('women_s_clothing__clothing', 'leggings', 'material', 3),
    ('women_s_clothing__clothing', 'leggings', 'fit', 4),
    ('women_s_clothing__clothing', 'leggings', 'waist_type', 5),
    ('women_s_clothing__clothing', 'leggings', 'length', 6),
    ('women_s_clothing__clothing', 'leggings', 'compression', 7),
    ('women_s_clothing__clothing', 'leggings', 'stretch', 8),
    ('women_s_clothing__clothing', 'leggings', 'opacity', 9),
    ('women_s_clothing__clothing', 'hoodies', 'size', 0),
    ('women_s_clothing__clothing', 'hoodies', 'color', 1),
    ('women_s_clothing__clothing', 'hoodies', 'brand', 2),
    ('women_s_clothing__clothing', 'hoodies', 'material', 3),
    ('women_s_clothing__clothing', 'hoodies', 'fit', 4),
    ('women_s_clothing__clothing', 'hoodies', 'hood_type', 5),
    ('women_s_clothing__clothing', 'hoodies', 'closure', 6),
    ('women_s_clothing__clothing', 'hoodies', 'pocket_type', 7),
    ('women_s_clothing__clothing', 'hoodies', 'fabric_thickness', 8),
    ('women_s_clothing__clothing', 'sweatshirts', 'size', 0),
    ('women_s_clothing__clothing', 'sweatshirts', 'color', 1),
    ('women_s_clothing__clothing', 'sweatshirts', 'brand', 2),
    ('women_s_clothing__clothing', 'sweatshirts', 'material', 3),
    ('women_s_clothing__clothing', 'sweatshirts', 'fit', 4),
    ('women_s_clothing__clothing', 'sweatshirts', 'neckline', 5),
    ('women_s_clothing__clothing', 'sweatshirts', 'sleeve_length', 6),
    ('women_s_clothing__clothing', 'sweatshirts', 'fabric_thickness', 7),
    ('women_s_clothing__clothing', 'jackets', 'size', 0),
    ('women_s_clothing__clothing', 'jackets', 'color', 1),
    ('women_s_clothing__clothing', 'jackets', 'brand', 2),
    ('women_s_clothing__clothing', 'jackets', 'material', 3),
    ('women_s_clothing__clothing', 'jackets', 'fit', 4),
    ('women_s_clothing__clothing', 'jackets', 'closure', 5),
    ('women_s_clothing__clothing', 'jackets', 'pocket_type', 6),
    ('women_s_clothing__clothing', 'jackets', 'lining', 7),
    ('women_s_clothing__clothing', 'jackets', 'waterproof', 8),
    ('women_s_clothing__clothing', 'jackets', 'season', 9),
    ('women_s_clothing__clothing', 'coats', 'size', 0),
    ('women_s_clothing__clothing', 'coats', 'color', 1),
    ('women_s_clothing__clothing', 'coats', 'brand', 2),
    ('women_s_clothing__clothing', 'coats', 'material', 3),
    ('women_s_clothing__clothing', 'coats', 'fit', 4),
    ('women_s_clothing__clothing', 'coats', 'length', 5),
    ('women_s_clothing__clothing', 'coats', 'closure', 6),
    ('women_s_clothing__clothing', 'coats', 'hood_type', 7),
    ('women_s_clothing__clothing', 'coats', 'lining', 8),
    ('women_s_clothing__clothing', 'coats', 'insulation', 9),
    ('women_s_clothing__clothing', 'coats', 'waterproof', 10),
    ('women_s_clothing__clothing', 'jumpsuits', 'size', 0),
    ('women_s_clothing__clothing', 'jumpsuits', 'color', 1),
    ('women_s_clothing__clothing', 'jumpsuits', 'brand', 2),
    ('women_s_clothing__clothing', 'jumpsuits', 'material', 3),
    ('women_s_clothing__clothing', 'jumpsuits', 'fit', 4),
    ('women_s_clothing__clothing', 'jumpsuits', 'length', 5),
    ('women_s_clothing__clothing', 'jumpsuits', 'sleeve_length', 6),
    ('women_s_clothing__clothing', 'jumpsuits', 'neckline', 7),
    ('women_s_clothing__clothing', 'jumpsuits', 'waist_type', 8),
    ('women_s_clothing__clothing', 'jumpsuits', 'closure', 9),
    ('women_s_clothing__clothing', 'bodysuits', 'size', 0),
    ('women_s_clothing__clothing', 'bodysuits', 'color', 1),
    ('women_s_clothing__clothing', 'bodysuits', 'brand', 2),
    ('women_s_clothing__clothing', 'bodysuits', 'material', 3),
    ('women_s_clothing__clothing', 'bodysuits', 'fit', 4),
    ('women_s_clothing__clothing', 'bodysuits', 'neckline', 5),
    ('women_s_clothing__clothing', 'bodysuits', 'sleeve_length', 6),
    ('women_s_clothing__clothing', 'bodysuits', 'closure', 7),
    ('women_s_clothing__clothing', 'bodysuits', 'stretch', 8),
    ('women_s_clothing__clothing', 'lingerie', 'size', 0),
    ('women_s_clothing__clothing', 'lingerie', 'color', 1),
    ('women_s_clothing__clothing', 'lingerie', 'brand', 2),
    ('women_s_clothing__clothing', 'lingerie', 'material', 3),
    ('women_s_clothing__clothing', 'lingerie', 'style', 4),
    ('women_s_clothing__clothing', 'lingerie', 'fit', 5),
    ('women_s_clothing__clothing', 'lingerie', 'cup_size', 6),
    ('women_s_clothing__clothing', 'lingerie', 'band_size', 7),
    ('women_s_clothing__clothing', 'lingerie', 'support_level', 8),
    ('women_s_clothing__clothing', 'lingerie', 'pack_size', 9),
    ('women_s_clothing__clothing', 'swimwear', 'size', 0),
    ('women_s_clothing__clothing', 'swimwear', 'color', 1),
    ('women_s_clothing__clothing', 'swimwear', 'brand', 2),
    ('women_s_clothing__clothing', 'swimwear', 'material', 3),
    ('women_s_clothing__clothing', 'swimwear', 'style', 4),
    ('women_s_clothing__clothing', 'swimwear', 'fit', 5),
    ('women_s_clothing__clothing', 'swimwear', 'liner', 6),
    ('women_s_clothing__clothing', 'swimwear', 'uv_protection', 7),
    ('women_s_clothing__clothing', 'swimwear', 'pattern', 8),
    ('women_s_clothing__clothing', 'swimwear', 'support', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'activity', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'moisture_wicking', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'breathability', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'stretch', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_t_shirts', 'sleeve_length', 10),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'activity', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'breathability', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'stretch', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'stringers', 'back_style', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'activity', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'moisture_wicking', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'breathability', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'tank_tops', 'stretch', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'compression_level', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'activity', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'breathability', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shirts', 'moisture_wicking', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'compression_level', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'length', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'activity', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'compression_shorts', 'stretch', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'length', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'liner', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'pocket_type', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'waistband_type', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'compression', 10),
    ('sportswear_gym_clothing__gym_sportswear', 'gym_shorts', 'activity', 11),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'length', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'waist_type', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'compression', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'stretch', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'opacity', 10),
    ('sportswear_gym_clothing__gym_sportswear', 'leggings', 'activity', 11),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'size', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'color', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'brand', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'material', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'fit', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'support_level', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'compression', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'cup_size', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'band_size', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'moisture_wicking', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_bras', 'activity', 10),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'waistband_type', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'cuff_type', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'pocket_type', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'joggers', 'activity', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'pieces_included', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'closure', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'activity', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'tracksuits', 'season', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'gender', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'size', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'color', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'brand', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'material', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'fit', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'closure', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'hood_type', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'waterproof', 8),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'breathability', 9),
    ('sportswear_gym_clothing__gym_sportswear', 'training_jackets', 'activity', 10),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'size', 0),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'color', 1),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'brand', 2),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'material', 3),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'length', 4),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'cushioning', 5),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'compression', 6),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'breathability', 7),
    ('sportswear_gym_clothing__gym_sportswear', 'sports_socks', 'activity', 8),
    ('shoes__footwear', 'running_shoes', 'gender', 0),
    ('shoes__footwear', 'running_shoes', 'size', 1),
    ('shoes__footwear', 'running_shoes', 'brand', 2),
    ('shoes__footwear', 'running_shoes', 'model', 3),
    ('shoes__footwear', 'running_shoes', 'color', 4),
    ('shoes__footwear', 'running_shoes', 'upper_material', 5),
    ('shoes__footwear', 'running_shoes', 'sole_material', 6),
    ('shoes__footwear', 'running_shoes', 'shoe_width', 7),
    ('shoes__footwear', 'running_shoes', 'weight', 8),
    ('shoes__footwear', 'running_shoes', 'cushioning', 9),
    ('shoes__footwear', 'running_shoes', 'support_type', 10),
    ('shoes__footwear', 'running_shoes', 'running_type', 11),
    ('shoes__footwear', 'running_shoes', 'terrain', 12),
    ('shoes__footwear', 'running_shoes', 'heel_to_toe_drop', 13),
    ('shoes__footwear', 'running_shoes', 'breathability', 14),
    ('shoes__footwear', 'running_shoes', 'waterproof', 15),
    ('shoes__footwear', 'training_shoes', 'gender', 0),
    ('shoes__footwear', 'training_shoes', 'size', 1),
    ('shoes__footwear', 'training_shoes', 'brand', 2),
    ('shoes__footwear', 'training_shoes', 'model', 3),
    ('shoes__footwear', 'training_shoes', 'color', 4),
    ('shoes__footwear', 'training_shoes', 'material', 5),
    ('shoes__footwear', 'training_shoes', 'sole_material', 6),
    ('shoes__footwear', 'training_shoes', 'shoe_width', 7),
    ('shoes__footwear', 'training_shoes', 'weight', 8),
    ('shoes__footwear', 'training_shoes', 'stability', 9),
    ('shoes__footwear', 'training_shoes', 'cushioning', 10),
    ('shoes__footwear', 'training_shoes', 'activity', 11),
    ('shoes__footwear', 'gym_shoes', 'gender', 0),
    ('shoes__footwear', 'gym_shoes', 'size', 1),
    ('shoes__footwear', 'gym_shoes', 'brand', 2),
    ('shoes__footwear', 'gym_shoes', 'model', 3),
    ('shoes__footwear', 'gym_shoes', 'color', 4),
    ('shoes__footwear', 'gym_shoes', 'material', 5),
    ('shoes__footwear', 'gym_shoes', 'sole_material', 6),
    ('shoes__footwear', 'gym_shoes', 'shoe_width', 7),
    ('shoes__footwear', 'gym_shoes', 'weight', 8),
    ('shoes__footwear', 'gym_shoes', 'grip', 9),
    ('shoes__footwear', 'gym_shoes', 'stability', 10),
    ('shoes__footwear', 'gym_shoes', 'activity', 11),
    ('shoes__footwear', 'basketball_shoes', 'gender', 0),
    ('shoes__footwear', 'basketball_shoes', 'size', 1),
    ('shoes__footwear', 'basketball_shoes', 'brand', 2),
    ('shoes__footwear', 'basketball_shoes', 'model', 3),
    ('shoes__footwear', 'basketball_shoes', 'color', 4),
    ('shoes__footwear', 'basketball_shoes', 'material', 5),
    ('shoes__footwear', 'basketball_shoes', 'sole_material', 6),
    ('shoes__footwear', 'basketball_shoes', 'ankle_support', 7),
    ('shoes__footwear', 'basketball_shoes', 'cushioning', 8),
    ('shoes__footwear', 'basketball_shoes', 'grip', 9),
    ('shoes__footwear', 'basketball_shoes', 'playing_position', 10),
    ('shoes__footwear', 'football_boots', 'gender', 0),
    ('shoes__footwear', 'football_boots', 'size', 1),
    ('shoes__footwear', 'football_boots', 'brand', 2),
    ('shoes__footwear', 'football_boots', 'model', 3),
    ('shoes__footwear', 'football_boots', 'color', 4),
    ('shoes__footwear', 'football_boots', 'upper_material', 5),
    ('shoes__footwear', 'football_boots', 'stud_type', 6),
    ('shoes__footwear', 'football_boots', 'surface', 7),
    ('shoes__footwear', 'football_boots', 'closure', 8),
    ('shoes__footwear', 'football_boots', 'fit', 9),
    ('shoes__footwear', 'football_boots', 'playing_position', 10),
    ('shoes__footwear', 'hiking_shoes', 'gender', 0),
    ('shoes__footwear', 'hiking_shoes', 'size', 1),
    ('shoes__footwear', 'hiking_shoes', 'brand', 2),
    ('shoes__footwear', 'hiking_shoes', 'model', 3),
    ('shoes__footwear', 'hiking_shoes', 'color', 4),
    ('shoes__footwear', 'hiking_shoes', 'upper_material', 5),
    ('shoes__footwear', 'hiking_shoes', 'sole_material', 6),
    ('shoes__footwear', 'hiking_shoes', 'terrain', 7),
    ('shoes__footwear', 'hiking_shoes', 'ankle_support', 8),
    ('shoes__footwear', 'hiking_shoes', 'waterproof', 9),
    ('shoes__footwear', 'hiking_shoes', 'insulation', 10),
    ('shoes__footwear', 'hiking_shoes', 'weight', 11),
    ('shoes__footwear', 'casual_shoes', 'gender', 0),
    ('shoes__footwear', 'casual_shoes', 'size', 1),
    ('shoes__footwear', 'casual_shoes', 'brand', 2),
    ('shoes__footwear', 'casual_shoes', 'model', 3),
    ('shoes__footwear', 'casual_shoes', 'color', 4),
    ('shoes__footwear', 'casual_shoes', 'material', 5),
    ('shoes__footwear', 'casual_shoes', 'sole_material', 6),
    ('shoes__footwear', 'casual_shoes', 'closure', 7),
    ('shoes__footwear', 'casual_shoes', 'style', 8),
    ('shoes__footwear', 'casual_shoes', 'shoe_width', 9),
    ('shoes__footwear', 'sneakers', 'gender', 0),
    ('shoes__footwear', 'sneakers', 'size', 1),
    ('shoes__footwear', 'sneakers', 'brand', 2),
    ('shoes__footwear', 'sneakers', 'model', 3),
    ('shoes__footwear', 'sneakers', 'color', 4),
    ('shoes__footwear', 'sneakers', 'material', 5),
    ('shoes__footwear', 'sneakers', 'sole_material', 6),
    ('shoes__footwear', 'sneakers', 'closure', 7),
    ('shoes__footwear', 'sneakers', 'style', 8),
    ('shoes__footwear', 'sneakers', 'cushioning', 9),
    ('shoes__footwear', 'sandals', 'gender', 0),
    ('shoes__footwear', 'sandals', 'size', 1),
    ('shoes__footwear', 'sandals', 'brand', 2),
    ('shoes__footwear', 'sandals', 'color', 3),
    ('shoes__footwear', 'sandals', 'material', 4),
    ('shoes__footwear', 'sandals', 'sole_material', 5),
    ('shoes__footwear', 'sandals', 'closure', 6),
    ('shoes__footwear', 'sandals', 'strap_type', 7),
    ('shoes__footwear', 'sandals', 'waterproof', 8),
    ('shoes__footwear', 'boots', 'gender', 0),
    ('shoes__footwear', 'boots', 'size', 1),
    ('shoes__footwear', 'boots', 'brand', 2),
    ('shoes__footwear', 'boots', 'model', 3),
    ('shoes__footwear', 'boots', 'color', 4),
    ('shoes__footwear', 'boots', 'material', 5),
    ('shoes__footwear', 'boots', 'sole_material', 6),
    ('shoes__footwear', 'boots', 'shaft_height', 7),
    ('shoes__footwear', 'boots', 'closure', 8),
    ('shoes__footwear', 'boots', 'waterproof', 9),
    ('shoes__footwear', 'boots', 'insulation', 10),
    ('shoes__footwear', 'slides', 'gender', 0),
    ('shoes__footwear', 'slides', 'size', 1),
    ('shoes__footwear', 'slides', 'brand', 2),
    ('shoes__footwear', 'slides', 'color', 3),
    ('shoes__footwear', 'slides', 'material', 4),
    ('shoes__footwear', 'slides', 'sole_material', 5),
    ('shoes__footwear', 'slides', 'waterproof', 6),
    ('shoes__footwear', 'slides', 'strap_type', 7),
    ('shoes__footwear', 'formal_shoes', 'gender', 0),
    ('shoes__footwear', 'formal_shoes', 'size', 1),
    ('shoes__footwear', 'formal_shoes', 'brand', 2),
    ('shoes__footwear', 'formal_shoes', 'model', 3),
    ('shoes__footwear', 'formal_shoes', 'color', 4),
    ('shoes__footwear', 'formal_shoes', 'material', 5),
    ('shoes__footwear', 'formal_shoes', 'sole_material', 6),
    ('shoes__footwear', 'formal_shoes', 'closure', 7),
    ('shoes__footwear', 'formal_shoes', 'toe_shape', 8),
    ('shoes__footwear', 'formal_shoes', 'style', 9),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'weight', 2),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'type', 3),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'material', 4),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'handle_material', 5),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'coating', 6),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'shape', 7),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'adjustable_fixed', 8),
    ('gym_fitness_equipment__fitness_equipment', 'dumbbells', 'color', 9),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'length', 2),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'weight', 3),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'diameter', 4),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'maximum_load', 5),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'shaft_material', 6),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'knurling', 7),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'sleeve_type', 8),
    ('gym_fitness_equipment__fitness_equipment', 'barbells', 'bar_type', 9),
    ('gym_fitness_equipment__fitness_equipment', 'weight_plates', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'weight_plates', 'weight', 1),
    ('gym_fitness_equipment__fitness_equipment', 'weight_plates', 'diameter', 2),
    ('gym_fitness_equipment__fitness_equipment', 'weight_plates', 'hole_diameter', 3),
    ('gym_fitness_equipment__fitness_equipment', 'weight_plates', 'material', 4),
    ('gym_fitness_equipment__fitness_equipment', 'weight_plates', 'plate_type', 5),
    ('gym_fitness_equipment__fitness_equipment', 'weight_plates', 'thickness', 6),
    ('gym_fitness_equipment__fitness_equipment', 'weight_plates', 'color', 7),
    ('gym_fitness_equipment__fitness_equipment', 'kettlebells', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'kettlebells', 'weight', 1),
    ('gym_fitness_equipment__fitness_equipment', 'kettlebells', 'material', 2),
    ('gym_fitness_equipment__fitness_equipment', 'kettlebells', 'handle_material', 3),
    ('gym_fitness_equipment__fitness_equipment', 'kettlebells', 'coating', 4),
    ('gym_fitness_equipment__fitness_equipment', 'kettlebells', 'color', 5),
    ('gym_fitness_equipment__fitness_equipment', 'kettlebells', 'fixed_adjustable', 6),
    ('gym_fitness_equipment__fitness_equipment', 'resistance_bands', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'resistance_bands', 'resistance_level', 1),
    ('gym_fitness_equipment__fitness_equipment', 'resistance_bands', 'length', 2),
    ('gym_fitness_equipment__fitness_equipment', 'resistance_bands', 'width', 3),
    ('gym_fitness_equipment__fitness_equipment', 'resistance_bands', 'material', 4),
    ('gym_fitness_equipment__fitness_equipment', 'resistance_bands', 'handle_type', 5),
    ('gym_fitness_equipment__fitness_equipment', 'resistance_bands', 'set_quantity', 6),
    ('gym_fitness_equipment__fitness_equipment', 'resistance_bands', 'color', 7),
    ('gym_fitness_equipment__fitness_equipment', 'pull_up_bars', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'pull_up_bars', 'material', 1),
    ('gym_fitness_equipment__fitness_equipment', 'pull_up_bars', 'bar_length', 2),
    ('gym_fitness_equipment__fitness_equipment', 'pull_up_bars', 'maximum_load', 3),
    ('gym_fitness_equipment__fitness_equipment', 'pull_up_bars', 'mounting_type', 4),
    ('gym_fitness_equipment__fitness_equipment', 'pull_up_bars', 'grip_type', 5),
    ('gym_fitness_equipment__fitness_equipment', 'pull_up_bars', 'dimensions', 6),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'bench_type', 2),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'material', 3),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'maximum_load', 4),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'adjustable_positions', 5),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'dimensions', 6),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'padding_material', 7),
    ('gym_fitness_equipment__fitness_equipment', 'gym_benches', 'frame_material', 8),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'material', 2),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'maximum_load', 3),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'height', 4),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'width', 5),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'depth', 6),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'rack_type', 7),
    ('gym_fitness_equipment__fitness_equipment', 'squat_racks', 'adjustable', 8),
    ('gym_fitness_equipment__fitness_equipment', 'cable_machines', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'cable_machines', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'cable_machines', 'machine_type', 2),
    ('gym_fitness_equipment__fitness_equipment', 'cable_machines', 'maximum_load', 3),
    ('gym_fitness_equipment__fitness_equipment', 'cable_machines', 'cable_ratio', 4),
    ('gym_fitness_equipment__fitness_equipment', 'cable_machines', 'dimensions', 5),
    ('gym_fitness_equipment__fitness_equipment', 'cable_machines', 'weight_stack', 6),
    ('gym_fitness_equipment__fitness_equipment', 'cable_machines', 'attachments_included', 7),
    ('gym_fitness_equipment__fitness_equipment', 'weight_machines', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'weight_machines', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'weight_machines', 'machine_type', 2),
    ('gym_fitness_equipment__fitness_equipment', 'weight_machines', 'target_muscle', 3),
    ('gym_fitness_equipment__fitness_equipment', 'weight_machines', 'maximum_load', 4),
    ('gym_fitness_equipment__fitness_equipment', 'weight_machines', 'dimensions', 5),
    ('gym_fitness_equipment__fitness_equipment', 'weight_machines', 'weight_stack', 6),
    ('gym_fitness_equipment__fitness_equipment', 'weight_machines', 'adjustability', 7),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'motor_power', 2),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'speed_range', 3),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'incline_range', 4),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'running_surface', 5),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'maximum_user_weight', 6),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'foldable', 7),
    ('gym_fitness_equipment__fitness_equipment', 'treadmills', 'display_features', 8),
    ('gym_fitness_equipment__fitness_equipment', 'exercise_bikes', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'exercise_bikes', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'exercise_bikes', 'bike_type', 2),
    ('gym_fitness_equipment__fitness_equipment', 'exercise_bikes', 'resistance_type', 3),
    ('gym_fitness_equipment__fitness_equipment', 'exercise_bikes', 'resistance_levels', 4),
    ('gym_fitness_equipment__fitness_equipment', 'exercise_bikes', 'maximum_user_weight', 5),
    ('gym_fitness_equipment__fitness_equipment', 'exercise_bikes', 'dimensions', 6),
    ('gym_fitness_equipment__fitness_equipment', 'exercise_bikes', 'display_features', 7),
    ('gym_fitness_equipment__fitness_equipment', 'rowing_machines', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'rowing_machines', 'model', 1),
    ('gym_fitness_equipment__fitness_equipment', 'rowing_machines', 'resistance_type', 2),
    ('gym_fitness_equipment__fitness_equipment', 'rowing_machines', 'resistance_levels', 3),
    ('gym_fitness_equipment__fitness_equipment', 'rowing_machines', 'maximum_user_weight', 4),
    ('gym_fitness_equipment__fitness_equipment', 'rowing_machines', 'rail_length', 5),
    ('gym_fitness_equipment__fitness_equipment', 'rowing_machines', 'foldable', 6),
    ('gym_fitness_equipment__fitness_equipment', 'rowing_machines', 'display_features', 7),
    ('gym_fitness_equipment__fitness_equipment', 'yoga_mats', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'yoga_mats', 'material', 1),
    ('gym_fitness_equipment__fitness_equipment', 'yoga_mats', 'length', 2),
    ('gym_fitness_equipment__fitness_equipment', 'yoga_mats', 'width', 3),
    ('gym_fitness_equipment__fitness_equipment', 'yoga_mats', 'thickness', 4),
    ('gym_fitness_equipment__fitness_equipment', 'yoga_mats', 'weight', 5),
    ('gym_fitness_equipment__fitness_equipment', 'yoga_mats', 'non_slip', 6),
    ('gym_fitness_equipment__fitness_equipment', 'yoga_mats', 'color', 7),
    ('gym_fitness_equipment__fitness_equipment', 'foam_rollers', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'foam_rollers', 'material', 1),
    ('gym_fitness_equipment__fitness_equipment', 'foam_rollers', 'length', 2),
    ('gym_fitness_equipment__fitness_equipment', 'foam_rollers', 'diameter', 3),
    ('gym_fitness_equipment__fitness_equipment', 'foam_rollers', 'firmness', 4),
    ('gym_fitness_equipment__fitness_equipment', 'foam_rollers', 'surface_type', 5),
    ('gym_fitness_equipment__fitness_equipment', 'foam_rollers', 'color', 6),
    ('gym_fitness_equipment__fitness_equipment', 'ab_wheels', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'ab_wheels', 'material', 1),
    ('gym_fitness_equipment__fitness_equipment', 'ab_wheels', 'wheel_diameter', 2),
    ('gym_fitness_equipment__fitness_equipment', 'ab_wheels', 'handle_material', 3),
    ('gym_fitness_equipment__fitness_equipment', 'ab_wheels', 'maximum_load', 4),
    ('gym_fitness_equipment__fitness_equipment', 'ab_wheels', 'single_dual_wheel', 5),
    ('gym_fitness_equipment__fitness_equipment', 'jump_ropes', 'brand', 0),
    ('gym_fitness_equipment__fitness_equipment', 'jump_ropes', 'material', 1),
    ('gym_fitness_equipment__fitness_equipment', 'jump_ropes', 'length', 2),
    ('gym_fitness_equipment__fitness_equipment', 'jump_ropes', 'handle_material', 3),
    ('gym_fitness_equipment__fitness_equipment', 'jump_ropes', 'bearing_type', 4),
    ('gym_fitness_equipment__fitness_equipment', 'jump_ropes', 'adjustable', 5),
    ('gym_fitness_equipment__fitness_equipment', 'jump_ropes', 'weight', 6),
    ('gym_accessories__gym_accessories', 'gym_gloves', 'brand', 0),
    ('gym_accessories__gym_accessories', 'gym_gloves', 'size', 1),
    ('gym_accessories__gym_accessories', 'gym_gloves', 'material', 2),
    ('gym_accessories__gym_accessories', 'gym_gloves', 'color', 3),
    ('gym_accessories__gym_accessories', 'gym_gloves', 'closure', 4),
    ('gym_accessories__gym_accessories', 'gym_gloves', 'palm_padding', 5),
    ('gym_accessories__gym_accessories', 'gym_gloves', 'breathability', 6),
    ('gym_accessories__gym_accessories', 'wrist_wraps', 'brand', 0),
    ('gym_accessories__gym_accessories', 'wrist_wraps', 'size', 1),
    ('gym_accessories__gym_accessories', 'wrist_wraps', 'material', 2),
    ('gym_accessories__gym_accessories', 'wrist_wraps', 'length', 3),
    ('gym_accessories__gym_accessories', 'wrist_wraps', 'width', 4),
    ('gym_accessories__gym_accessories', 'wrist_wraps', 'support_level', 5),
    ('gym_accessories__gym_accessories', 'wrist_wraps', 'closure', 6),
    ('gym_accessories__gym_accessories', 'wrist_wraps', 'color', 7),
    ('gym_accessories__gym_accessories', 'lifting_straps', 'brand', 0),
    ('gym_accessories__gym_accessories', 'lifting_straps', 'material', 1),
    ('gym_accessories__gym_accessories', 'lifting_straps', 'length', 2),
    ('gym_accessories__gym_accessories', 'lifting_straps', 'width', 3),
    ('gym_accessories__gym_accessories', 'lifting_straps', 'closure', 4),
    ('gym_accessories__gym_accessories', 'lifting_straps', 'maximum_load', 5),
    ('gym_accessories__gym_accessories', 'lifting_straps', 'color', 6),
    ('gym_accessories__gym_accessories', 'knee_sleeves', 'brand', 0),
    ('gym_accessories__gym_accessories', 'knee_sleeves', 'size', 1),
    ('gym_accessories__gym_accessories', 'knee_sleeves', 'material', 2),
    ('gym_accessories__gym_accessories', 'knee_sleeves', 'thickness', 3),
    ('gym_accessories__gym_accessories', 'knee_sleeves', 'compression', 4),
    ('gym_accessories__gym_accessories', 'knee_sleeves', 'support_level', 5),
    ('gym_accessories__gym_accessories', 'knee_sleeves', 'color', 6),
    ('gym_accessories__gym_accessories', 'elbow_sleeves', 'brand', 0),
    ('gym_accessories__gym_accessories', 'elbow_sleeves', 'size', 1),
    ('gym_accessories__gym_accessories', 'elbow_sleeves', 'material', 2),
    ('gym_accessories__gym_accessories', 'elbow_sleeves', 'thickness', 3),
    ('gym_accessories__gym_accessories', 'elbow_sleeves', 'compression', 4),
    ('gym_accessories__gym_accessories', 'elbow_sleeves', 'support_level', 5),
    ('gym_accessories__gym_accessories', 'elbow_sleeves', 'color', 6),
    ('gym_accessories__gym_accessories', 'weight_belts', 'brand', 0),
    ('gym_accessories__gym_accessories', 'weight_belts', 'size', 1),
    ('gym_accessories__gym_accessories', 'weight_belts', 'material', 2),
    ('gym_accessories__gym_accessories', 'weight_belts', 'width', 3),
    ('gym_accessories__gym_accessories', 'weight_belts', 'buckle_type', 4),
    ('gym_accessories__gym_accessories', 'weight_belts', 'maximum_load', 5),
    ('gym_accessories__gym_accessories', 'weight_belts', 'color', 6),
    ('gym_accessories__gym_accessories', 'ankle_straps', 'brand', 0),
    ('gym_accessories__gym_accessories', 'ankle_straps', 'material', 1),
    ('gym_accessories__gym_accessories', 'ankle_straps', 'size', 2),
    ('gym_accessories__gym_accessories', 'ankle_straps', 'closure', 3),
    ('gym_accessories__gym_accessories', 'ankle_straps', 'padding', 4),
    ('gym_accessories__gym_accessories', 'ankle_straps', 'color', 5),
    ('gym_accessories__gym_accessories', 'lifting_hooks', 'brand', 0),
    ('gym_accessories__gym_accessories', 'lifting_hooks', 'material', 1),
    ('gym_accessories__gym_accessories', 'lifting_hooks', 'maximum_load', 2),
    ('gym_accessories__gym_accessories', 'lifting_hooks', 'strap_type', 3),
    ('gym_accessories__gym_accessories', 'lifting_hooks', 'size', 4),
    ('gym_accessories__gym_accessories', 'lifting_hooks', 'color', 5),
    ('gym_accessories__gym_accessories', 'shaker_bottles', 'brand', 0),
    ('gym_accessories__gym_accessories', 'shaker_bottles', 'capacity', 1),
    ('gym_accessories__gym_accessories', 'shaker_bottles', 'material', 2),
    ('gym_accessories__gym_accessories', 'shaker_bottles', 'leakproof', 3),
    ('gym_accessories__gym_accessories', 'shaker_bottles', 'mixing_system', 4),
    ('gym_accessories__gym_accessories', 'shaker_bottles', 'compartments', 5),
    ('gym_accessories__gym_accessories', 'shaker_bottles', 'color', 6),
    ('gym_accessories__gym_accessories', 'gym_towels', 'brand', 0),
    ('gym_accessories__gym_accessories', 'gym_towels', 'material', 1),
    ('gym_accessories__gym_accessories', 'gym_towels', 'dimensions', 2),
    ('gym_accessories__gym_accessories', 'gym_towels', 'absorbency', 3),
    ('gym_accessories__gym_accessories', 'gym_towels', 'color', 4),
    ('gym_accessories__gym_accessories', 'gym_bags', 'brand', 0),
    ('gym_accessories__gym_accessories', 'gym_bags', 'material', 1),
    ('gym_accessories__gym_accessories', 'gym_bags', 'capacity', 2),
    ('gym_accessories__gym_accessories', 'gym_bags', 'dimensions', 3),
    ('gym_accessories__gym_accessories', 'gym_bags', 'compartments', 4),
    ('gym_accessories__gym_accessories', 'gym_bags', 'shoe_compartment', 5),
    ('gym_accessories__gym_accessories', 'gym_bags', 'waterproof', 6),
    ('gym_accessories__gym_accessories', 'gym_bags', 'strap_type', 7),
    ('gym_accessories__gym_accessories', 'gym_bags', 'color', 8),
    ('gym_accessories__gym_accessories', 'training_masks', 'brand', 0),
    ('gym_accessories__gym_accessories', 'training_masks', 'size', 1),
    ('gym_accessories__gym_accessories', 'training_masks', 'material', 2),
    ('gym_accessories__gym_accessories', 'training_masks', 'resistance_levels', 3),
    ('gym_accessories__gym_accessories', 'training_masks', 'adjustable', 4),
    ('gym_accessories__gym_accessories', 'training_masks', 'activity', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'protein_type', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'flavor', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'net_weight', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'serving_size', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'servings', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'protein_per_serving', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'calories', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'carbohydrates', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'fat', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'ingredients', 10),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'sweetener', 11),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'allergen_information', 12),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'recommended_usage', 13),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'expiration_date', 14),
    ('supplements_sports_nutrition__sports_nutrition', 'whey_protein', 'batch_number', 15),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'flavor', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'weight', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'servings', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'protein_per_serving', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'calories', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'carbohydrates', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'fat', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'ingredients', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'allergens', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'protein_bars', 'expiration_date', 10),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'creatine_type', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'flavor', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'net_weight', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'serving_size', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'servings', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'creatine_per_serving', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'ingredients', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'recommended_usage', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'creatine', 'expiration_date', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'flavor', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'net_weight', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'serving_size', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'servings', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'caffeine_per_serving', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'creatine_per_serving', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'beta_alanine', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'citrulline', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'ingredients', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'recommended_usage', 10),
    ('supplements_sports_nutrition__sports_nutrition', 'pre_workout', 'expiration_date', 11),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'flavor', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'net_weight', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'serving_size', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'servings', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'bcaa_ratio', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'amino_acids', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'ingredients', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'recommended_usage', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'bcaa', 'expiration_date', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'flavor', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'net_weight', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'serving_size', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'servings', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'amino_acid_profile', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'ingredients', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'recommended_usage', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'eaa', 'expiration_date', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'flavor', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'net_weight', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'serving_size', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'servings', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'calories', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'protein', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'carbohydrates', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'fat', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'ingredients', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'allergens', 10),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'recommended_usage', 11),
    ('supplements_sports_nutrition__sports_nutrition', 'mass_gainer', 'expiration_date', 12),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'flavor', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'net_weight', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'serving_size', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'servings', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'sodium', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'potassium', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'magnesium', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'ingredients', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'recommended_usage', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'electrolytes', 'expiration_date', 10),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'vitamin_type', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'form', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'net_weight', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'serving_size', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'servings', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'dosage', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'ingredients', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'recommended_usage', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'vitamins', 'expiration_date', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'mineral_type', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'form', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'net_weight', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'serving_size', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'servings', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'dosage', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'ingredients', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'recommended_usage', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'minerals', 'expiration_date', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'brand', 0),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'product_type', 1),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'flavor', 2),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'net_weight', 3),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'serving_size', 4),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'servings', 5),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'protein', 6),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'carbohydrates', 7),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'ingredients', 8),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'recommended_usage', 9),
    ('supplements_sports_nutrition__sports_nutrition', 'recovery_supplements', 'expiration_date', 10),
    ('accessories__accessories', 'watches', 'brand', 0),
    ('accessories__accessories', 'watches', 'model', 1),
    ('accessories__accessories', 'watches', 'movement', 2),
    ('accessories__accessories', 'watches', 'case_material', 3),
    ('accessories__accessories', 'watches', 'case_diameter', 4),
    ('accessories__accessories', 'watches', 'strap_material', 5),
    ('accessories__accessories', 'watches', 'strap_color', 6),
    ('accessories__accessories', 'watches', 'water_resistance', 7),
    ('accessories__accessories', 'watches', 'display_type', 8),
    ('accessories__accessories', 'watches', 'battery_type', 9),
    ('accessories__accessories', 'watches', 'features', 10),
    ('accessories__accessories', 'sunglasses', 'brand', 0),
    ('accessories__accessories', 'sunglasses', 'frame_material', 1),
    ('accessories__accessories', 'sunglasses', 'lens_material', 2),
    ('accessories__accessories', 'sunglasses', 'lens_color', 3),
    ('accessories__accessories', 'sunglasses', 'frame_color', 4),
    ('accessories__accessories', 'sunglasses', 'uv_protection', 5),
    ('accessories__accessories', 'sunglasses', 'lens_type', 6),
    ('accessories__accessories', 'sunglasses', 'polarized', 7),
    ('accessories__accessories', 'sunglasses', 'frame_shape', 8),
    ('accessories__accessories', 'sunglasses', 'gender', 9),
    ('accessories__accessories', 'belts', 'brand', 0),
    ('accessories__accessories', 'belts', 'material', 1),
    ('accessories__accessories', 'belts', 'size', 2),
    ('accessories__accessories', 'belts', 'width', 3),
    ('accessories__accessories', 'belts', 'color', 4),
    ('accessories__accessories', 'belts', 'buckle_type', 5),
    ('accessories__accessories', 'belts', 'style', 6),
    ('accessories__accessories', 'wallets', 'brand', 0),
    ('accessories__accessories', 'wallets', 'material', 1),
    ('accessories__accessories', 'wallets', 'size', 2),
    ('accessories__accessories', 'wallets', 'dimensions', 3),
    ('accessories__accessories', 'wallets', 'color', 4),
    ('accessories__accessories', 'wallets', 'card_slots', 5),
    ('accessories__accessories', 'wallets', 'coin_pocket', 6),
    ('accessories__accessories', 'wallets', 'closure_type', 7),
    ('accessories__accessories', 'caps', 'brand', 0),
    ('accessories__accessories', 'caps', 'material', 1),
    ('accessories__accessories', 'caps', 'size', 2),
    ('accessories__accessories', 'caps', 'color', 3),
    ('accessories__accessories', 'caps', 'closure', 4),
    ('accessories__accessories', 'caps', 'pattern', 5),
    ('accessories__accessories', 'caps', 'style', 6),
    ('accessories__accessories', 'hats', 'brand', 0),
    ('accessories__accessories', 'hats', 'material', 1),
    ('accessories__accessories', 'hats', 'size', 2),
    ('accessories__accessories', 'hats', 'color', 3),
    ('accessories__accessories', 'hats', 'style', 4),
    ('accessories__accessories', 'hats', 'season', 5),
    ('accessories__accessories', 'backpacks', 'brand', 0),
    ('accessories__accessories', 'backpacks', 'material', 1),
    ('accessories__accessories', 'backpacks', 'capacity', 2),
    ('accessories__accessories', 'backpacks', 'dimensions', 3),
    ('accessories__accessories', 'backpacks', 'weight', 4),
    ('accessories__accessories', 'backpacks', 'compartments', 5),
    ('accessories__accessories', 'backpacks', 'laptop_compatibility', 6),
    ('accessories__accessories', 'backpacks', 'waterproof', 7),
    ('accessories__accessories', 'backpacks', 'color', 8),
    ('accessories__accessories', 'bags', 'brand', 0),
    ('accessories__accessories', 'bags', 'material', 1),
    ('accessories__accessories', 'bags', 'capacity', 2),
    ('accessories__accessories', 'bags', 'dimensions', 3),
    ('accessories__accessories', 'bags', 'weight', 4),
    ('accessories__accessories', 'bags', 'compartments', 5),
    ('accessories__accessories', 'bags', 'closure_type', 6),
    ('accessories__accessories', 'bags', 'strap_type', 7),
    ('accessories__accessories', 'bags', 'color', 8),
    ('accessories__accessories', 'jewelry', 'brand', 0),
    ('accessories__accessories', 'jewelry', 'jewelry_type', 1),
    ('accessories__accessories', 'jewelry', 'material', 2),
    ('accessories__accessories', 'jewelry', 'metal_type', 3),
    ('accessories__accessories', 'jewelry', 'stone_type', 4),
    ('accessories__accessories', 'jewelry', 'size', 5),
    ('accessories__accessories', 'jewelry', 'color', 6),
    ('accessories__accessories', 'jewelry', 'gender', 7),
    ('accessories__accessories', 'jewelry', 'plating', 8),
    ('accessories__accessories', 'keychains', 'brand', 0),
    ('accessories__accessories', 'keychains', 'material', 1),
    ('accessories__accessories', 'keychains', 'dimensions', 2),
    ('accessories__accessories', 'keychains', 'color', 3),
    ('accessories__accessories', 'keychains', 'theme', 4),
    ('accessories__accessories', 'keychains', 'attachment_type', 5),
    ('electronics__consumer_electronics', 'smartphones', 'brand', 0),
    ('electronics__consumer_electronics', 'smartphones', 'model', 1),
    ('electronics__consumer_electronics', 'smartphones', 'condition', 2),
    ('electronics__consumer_electronics', 'smartphones', 'color', 3),
    ('electronics__consumer_electronics', 'smartphones', 'operating_system', 4),
    ('electronics__consumer_electronics', 'smartphones', 'screen_size', 5),
    ('electronics__consumer_electronics', 'smartphones', 'resolution', 6),
    ('electronics__consumer_electronics', 'smartphones', 'refresh_rate', 7),
    ('electronics__consumer_electronics', 'smartphones', 'ram', 8),
    ('electronics__consumer_electronics', 'smartphones', 'storage', 9),
    ('electronics__consumer_electronics', 'smartphones', 'processor', 10),
    ('electronics__consumer_electronics', 'smartphones', 'main_camera', 11),
    ('electronics__consumer_electronics', 'smartphones', 'front_camera', 12),
    ('electronics__consumer_electronics', 'smartphones', 'battery_capacity', 13),
    ('electronics__consumer_electronics', 'smartphones', '5g', 14),
    ('electronics__consumer_electronics', 'smartphones', 'sim_type', 15),
    ('electronics__consumer_electronics', 'smartphones', 'nfc', 16),
    ('electronics__consumer_electronics', 'smartphones', 'bluetooth', 17),
    ('electronics__consumer_electronics', 'smartphones', 'wi_fi', 18),
    ('electronics__consumer_electronics', 'tablets', 'brand', 0),
    ('electronics__consumer_electronics', 'tablets', 'model', 1),
    ('electronics__consumer_electronics', 'tablets', 'condition', 2),
    ('electronics__consumer_electronics', 'tablets', 'color', 3),
    ('electronics__consumer_electronics', 'tablets', 'operating_system', 4),
    ('electronics__consumer_electronics', 'tablets', 'screen_size', 5),
    ('electronics__consumer_electronics', 'tablets', 'resolution', 6),
    ('electronics__consumer_electronics', 'tablets', 'refresh_rate', 7),
    ('electronics__consumer_electronics', 'tablets', 'ram', 8),
    ('electronics__consumer_electronics', 'tablets', 'storage', 9),
    ('electronics__consumer_electronics', 'tablets', 'processor', 10),
    ('electronics__consumer_electronics', 'tablets', 'camera', 11),
    ('electronics__consumer_electronics', 'tablets', 'battery_capacity', 12),
    ('electronics__consumer_electronics', 'tablets', 'cellular_connectivity', 13),
    ('electronics__consumer_electronics', 'tablets', 'bluetooth', 14),
    ('electronics__consumer_electronics', 'tablets', 'wi_fi', 15),
    ('electronics__consumer_electronics', 'laptops', 'brand', 0),
    ('electronics__consumer_electronics', 'laptops', 'model', 1),
    ('electronics__consumer_electronics', 'laptops', 'condition', 2),
    ('electronics__consumer_electronics', 'laptops', 'color', 3),
    ('electronics__consumer_electronics', 'laptops', 'processor', 4),
    ('electronics__consumer_electronics', 'laptops', 'ram', 5),
    ('electronics__consumer_electronics', 'laptops', 'storage', 6),
    ('electronics__consumer_electronics', 'laptops', 'gpu', 7),
    ('electronics__consumer_electronics', 'laptops', 'screen_size', 8),
    ('electronics__consumer_electronics', 'laptops', 'resolution', 9),
    ('electronics__consumer_electronics', 'laptops', 'refresh_rate', 10),
    ('electronics__consumer_electronics', 'laptops', 'operating_system', 11),
    ('electronics__consumer_electronics', 'laptops', 'battery', 12),
    ('electronics__consumer_electronics', 'laptops', 'ports', 13),
    ('electronics__consumer_electronics', 'laptops', 'weight', 14),
    ('electronics__consumer_electronics', 'laptops', 'keyboard_layout', 15),
    ('electronics__consumer_electronics', 'smartwatches', 'brand', 0),
    ('electronics__consumer_electronics', 'smartwatches', 'model', 1),
    ('electronics__consumer_electronics', 'smartwatches', 'os', 2),
    ('electronics__consumer_electronics', 'smartwatches', 'display_type', 3),
    ('electronics__consumer_electronics', 'smartwatches', 'screen_size', 4),
    ('electronics__consumer_electronics', 'smartwatches', 'storage', 5),
    ('electronics__consumer_electronics', 'smartwatches', 'battery_life', 6),
    ('electronics__consumer_electronics', 'smartwatches', 'gps', 7),
    ('electronics__consumer_electronics', 'smartwatches', 'nfc', 8),
    ('electronics__consumer_electronics', 'smartwatches', 'water_resistance', 9),
    ('electronics__consumer_electronics', 'smartwatches', 'health_features', 10),
    ('electronics__consumer_electronics', 'smartwatches', 'connectivity', 11),
    ('electronics__consumer_electronics', 'headphones', 'brand', 0),
    ('electronics__consumer_electronics', 'headphones', 'model', 1),
    ('electronics__consumer_electronics', 'headphones', 'type', 2),
    ('electronics__consumer_electronics', 'headphones', 'connection', 3),
    ('electronics__consumer_electronics', 'headphones', 'bluetooth_version', 4),
    ('electronics__consumer_electronics', 'headphones', 'noise_cancellation', 5),
    ('electronics__consumer_electronics', 'headphones', 'battery_life', 6),
    ('electronics__consumer_electronics', 'headphones', 'microphone', 7),
    ('electronics__consumer_electronics', 'headphones', 'driver_size', 8),
    ('electronics__consumer_electronics', 'headphones', 'water_resistance', 9),
    ('electronics__consumer_electronics', 'earbuds', 'brand', 0),
    ('electronics__consumer_electronics', 'earbuds', 'model', 1),
    ('electronics__consumer_electronics', 'earbuds', 'connection', 2),
    ('electronics__consumer_electronics', 'earbuds', 'bluetooth_version', 3),
    ('electronics__consumer_electronics', 'earbuds', 'noise_cancellation', 4),
    ('electronics__consumer_electronics', 'earbuds', 'battery_life', 5),
    ('electronics__consumer_electronics', 'earbuds', 'charging_case_capacity', 6),
    ('electronics__consumer_electronics', 'earbuds', 'microphone', 7),
    ('electronics__consumer_electronics', 'earbuds', 'water_resistance', 8),
    ('electronics__consumer_electronics', 'speakers', 'brand', 0),
    ('electronics__consumer_electronics', 'speakers', 'model', 1),
    ('electronics__consumer_electronics', 'speakers', 'type', 2),
    ('electronics__consumer_electronics', 'speakers', 'power_output', 3),
    ('electronics__consumer_electronics', 'speakers', 'connectivity', 4),
    ('electronics__consumer_electronics', 'speakers', 'bluetooth_version', 5),
    ('electronics__consumer_electronics', 'speakers', 'battery_life', 6),
    ('electronics__consumer_electronics', 'speakers', 'frequency_response', 7),
    ('electronics__consumer_electronics', 'speakers', 'waterproof', 8),
    ('electronics__consumer_electronics', 'power_banks', 'brand', 0),
    ('electronics__consumer_electronics', 'power_banks', 'capacity', 1),
    ('electronics__consumer_electronics', 'power_banks', 'input', 2),
    ('electronics__consumer_electronics', 'power_banks', 'output', 3),
    ('electronics__consumer_electronics', 'power_banks', 'fast_charging', 4),
    ('electronics__consumer_electronics', 'power_banks', 'number_of_ports', 5),
    ('electronics__consumer_electronics', 'power_banks', 'battery_type', 6),
    ('electronics__consumer_electronics', 'power_banks', 'dimensions', 7),
    ('electronics__consumer_electronics', 'power_banks', 'weight', 8),
    ('electronics__consumer_electronics', 'chargers', 'brand', 0),
    ('electronics__consumer_electronics', 'chargers', 'charger_type', 1),
    ('electronics__consumer_electronics', 'chargers', 'power_output', 2),
    ('electronics__consumer_electronics', 'chargers', 'voltage', 3),
    ('electronics__consumer_electronics', 'chargers', 'current', 4),
    ('electronics__consumer_electronics', 'chargers', 'port_type', 5),
    ('electronics__consumer_electronics', 'chargers', 'fast_charging', 6),
    ('electronics__consumer_electronics', 'chargers', 'compatibility', 7),
    ('electronics__consumer_electronics', 'cables', 'brand', 0),
    ('electronics__consumer_electronics', 'cables', 'cable_type', 1),
    ('electronics__consumer_electronics', 'cables', 'connector_a', 2),
    ('electronics__consumer_electronics', 'cables', 'connector_b', 3),
    ('electronics__consumer_electronics', 'cables', 'length', 4),
    ('electronics__consumer_electronics', 'cables', 'data_transfer_speed', 5),
    ('electronics__consumer_electronics', 'cables', 'charging_power', 6),
    ('electronics__consumer_electronics', 'cables', 'material', 7),
    ('electronics__consumer_electronics', 'keyboards', 'brand', 0),
    ('electronics__consumer_electronics', 'keyboards', 'model', 1),
    ('electronics__consumer_electronics', 'keyboards', 'type', 2),
    ('electronics__consumer_electronics', 'keyboards', 'connection', 3),
    ('electronics__consumer_electronics', 'keyboards', 'switch_type', 4),
    ('electronics__consumer_electronics', 'keyboards', 'layout', 5),
    ('electronics__consumer_electronics', 'keyboards', 'rgb', 6),
    ('electronics__consumer_electronics', 'keyboards', 'backlight', 7),
    ('electronics__consumer_electronics', 'keyboards', 'compatibility', 8),
    ('electronics__consumer_electronics', 'mice', 'brand', 0),
    ('electronics__consumer_electronics', 'mice', 'model', 1),
    ('electronics__consumer_electronics', 'mice', 'connection', 2),
    ('electronics__consumer_electronics', 'mice', 'sensor_type', 3),
    ('electronics__consumer_electronics', 'mice', 'dpi', 4),
    ('electronics__consumer_electronics', 'mice', 'buttons', 5),
    ('electronics__consumer_electronics', 'mice', 'polling_rate', 6),
    ('electronics__consumer_electronics', 'mice', 'rgb', 7),
    ('electronics__consumer_electronics', 'mice', 'compatibility', 8),
    ('computers_components__computer_components', 'cpus', 'brand', 0),
    ('computers_components__computer_components', 'cpus', 'model', 1),
    ('computers_components__computer_components', 'cpus', 'socket', 2),
    ('computers_components__computer_components', 'cpus', 'cores', 3),
    ('computers_components__computer_components', 'cpus', 'threads', 4),
    ('computers_components__computer_components', 'cpus', 'base_clock', 5),
    ('computers_components__computer_components', 'cpus', 'boost_clock', 6),
    ('computers_components__computer_components', 'cpus', 'cache', 7),
    ('computers_components__computer_components', 'cpus', 'tdp', 8),
    ('computers_components__computer_components', 'cpus', 'integrated_graphics', 9),
    ('computers_components__computer_components', 'gpus', 'brand', 0),
    ('computers_components__computer_components', 'gpus', 'model', 1),
    ('computers_components__computer_components', 'gpus', 'vram', 2),
    ('computers_components__computer_components', 'gpus', 'memory_type', 3),
    ('computers_components__computer_components', 'gpus', 'memory_interface', 4),
    ('computers_components__computer_components', 'gpus', 'boost_clock', 5),
    ('computers_components__computer_components', 'gpus', 'power_consumption', 6),
    ('computers_components__computer_components', 'gpus', 'recommended_psu', 7),
    ('computers_components__computer_components', 'gpus', 'ports', 8),
    ('computers_components__computer_components', 'gpus', 'length', 9),
    ('computers_components__computer_components', 'motherboards', 'brand', 0),
    ('computers_components__computer_components', 'motherboards', 'model', 1),
    ('computers_components__computer_components', 'motherboards', 'socket', 2),
    ('computers_components__computer_components', 'motherboards', 'chipset', 3),
    ('computers_components__computer_components', 'motherboards', 'form_factor', 4),
    ('computers_components__computer_components', 'motherboards', 'ram_type', 5),
    ('computers_components__computer_components', 'motherboards', 'maximum_ram', 6),
    ('computers_components__computer_components', 'motherboards', 'ram_slots', 7),
    ('computers_components__computer_components', 'motherboards', 'expansion_slots', 8),
    ('computers_components__computer_components', 'motherboards', 'storage_interfaces', 9),
    ('computers_components__computer_components', 'motherboards', 'wi_fi', 10),
    ('computers_components__computer_components', 'motherboards', 'bluetooth', 11),
    ('computers_components__computer_components', 'ram', 'brand', 0),
    ('computers_components__computer_components', 'ram', 'capacity', 1),
    ('computers_components__computer_components', 'ram', 'type', 2),
    ('computers_components__computer_components', 'ram', 'speed', 3),
    ('computers_components__computer_components', 'ram', 'cas_latency', 4),
    ('computers_components__computer_components', 'ram', 'voltage', 5),
    ('computers_components__computer_components', 'ram', 'module_type', 6),
    ('computers_components__computer_components', 'ram', 'number_of_modules', 7),
    ('computers_components__computer_components', 'ssds', 'brand', 0),
    ('computers_components__computer_components', 'ssds', 'model', 1),
    ('computers_components__computer_components', 'ssds', 'capacity', 2),
    ('computers_components__computer_components', 'ssds', 'interface', 3),
    ('computers_components__computer_components', 'ssds', 'form_factor', 4),
    ('computers_components__computer_components', 'ssds', 'read_speed', 5),
    ('computers_components__computer_components', 'ssds', 'write_speed', 6),
    ('computers_components__computer_components', 'ssds', 'nand_type', 7),
    ('computers_components__computer_components', 'ssds', 'tbw', 8),
    ('computers_components__computer_components', 'hdds', 'brand', 0),
    ('computers_components__computer_components', 'hdds', 'model', 1),
    ('computers_components__computer_components', 'hdds', 'capacity', 2),
    ('computers_components__computer_components', 'hdds', 'form_factor', 3),
    ('computers_components__computer_components', 'hdds', 'rpm', 4),
    ('computers_components__computer_components', 'hdds', 'interface', 5),
    ('computers_components__computer_components', 'hdds', 'cache_size', 6),
    ('computers_components__computer_components', 'hdds', 'recording_technology', 7),
    ('computers_components__computer_components', 'power_supplies', 'brand', 0),
    ('computers_components__computer_components', 'power_supplies', 'model', 1),
    ('computers_components__computer_components', 'power_supplies', 'power_output', 2),
    ('computers_components__computer_components', 'power_supplies', 'efficiency_rating', 3),
    ('computers_components__computer_components', 'power_supplies', 'form_factor', 4),
    ('computers_components__computer_components', 'power_supplies', 'modular', 5),
    ('computers_components__computer_components', 'power_supplies', 'connectors', 6),
    ('computers_components__computer_components', 'power_supplies', 'fan_size', 7),
    ('computers_components__computer_components', 'pc_cases', 'brand', 0),
    ('computers_components__computer_components', 'pc_cases', 'model', 1),
    ('computers_components__computer_components', 'pc_cases', 'form_factor', 2),
    ('computers_components__computer_components', 'pc_cases', 'motherboard_compatibility', 3),
    ('computers_components__computer_components', 'pc_cases', 'gpu_length', 4),
    ('computers_components__computer_components', 'pc_cases', 'cpu_cooler_height', 5),
    ('computers_components__computer_components', 'pc_cases', 'fan_support', 6),
    ('computers_components__computer_components', 'pc_cases', 'radiator_support', 7),
    ('computers_components__computer_components', 'pc_cases', 'dimensions', 8),
    ('computers_components__computer_components', 'cooling_systems', 'brand', 0),
    ('computers_components__computer_components', 'cooling_systems', 'model', 1),
    ('computers_components__computer_components', 'cooling_systems', 'cooling_type', 2),
    ('computers_components__computer_components', 'cooling_systems', 'socket_compatibility', 3),
    ('computers_components__computer_components', 'cooling_systems', 'fan_size', 4),
    ('computers_components__computer_components', 'cooling_systems', 'fan_speed', 5),
    ('computers_components__computer_components', 'cooling_systems', 'noise_level', 6),
    ('computers_components__computer_components', 'cooling_systems', 'radiator_size', 7),
    ('computers_components__computer_components', 'monitors', 'brand', 0),
    ('computers_components__computer_components', 'monitors', 'model', 1),
    ('computers_components__computer_components', 'monitors', 'screen_size', 2),
    ('computers_components__computer_components', 'monitors', 'panel_type', 3),
    ('computers_components__computer_components', 'monitors', 'resolution', 4),
    ('computers_components__computer_components', 'monitors', 'refresh_rate', 5),
    ('computers_components__computer_components', 'monitors', 'response_time', 6),
    ('computers_components__computer_components', 'monitors', 'hdr', 7),
    ('computers_components__computer_components', 'monitors', 'adaptive_sync', 8),
    ('computers_components__computer_components', 'monitors', 'ports', 9),
    ('computers_components__computer_components', 'monitors', 'vesa_mount', 10),
    ('computers_components__computer_components', 'keyboards', 'brand', 0),
    ('computers_components__computer_components', 'keyboards', 'model', 1),
    ('computers_components__computer_components', 'keyboards', 'type', 2),
    ('computers_components__computer_components', 'keyboards', 'switch_type', 3),
    ('computers_components__computer_components', 'keyboards', 'layout', 4),
    ('computers_components__computer_components', 'keyboards', 'connection', 5),
    ('computers_components__computer_components', 'keyboards', 'rgb', 6),
    ('computers_components__computer_components', 'keyboards', 'backlight', 7),
    ('computers_components__computer_components', 'keyboards', 'compatibility', 8),
    ('computers_components__computer_components', 'mice', 'brand', 0),
    ('computers_components__computer_components', 'mice', 'model', 1),
    ('computers_components__computer_components', 'mice', 'sensor_type', 2),
    ('computers_components__computer_components', 'mice', 'dpi', 3),
    ('computers_components__computer_components', 'mice', 'buttons', 4),
    ('computers_components__computer_components', 'mice', 'polling_rate', 5),
    ('computers_components__computer_components', 'mice', 'connection', 6),
    ('computers_components__computer_components', 'mice', 'rgb', 7),
    ('computers_components__computer_components', 'mice', 'weight', 8),
    ('gaming__gaming_products', 'gaming_consoles', 'brand', 0),
    ('gaming__gaming_products', 'gaming_consoles', 'model', 1),
    ('gaming__gaming_products', 'gaming_consoles', 'platform', 2),
    ('gaming__gaming_products', 'gaming_consoles', 'storage', 3),
    ('gaming__gaming_products', 'gaming_consoles', 'resolution', 4),
    ('gaming__gaming_products', 'gaming_consoles', 'connectivity', 5),
    ('gaming__gaming_products', 'gaming_consoles', 'included_accessories', 6),
    ('gaming__gaming_products', 'gaming_consoles', 'region', 7),
    ('gaming__gaming_products', 'gaming_consoles', 'color', 8),
    ('gaming__gaming_products', 'controllers', 'brand', 0),
    ('gaming__gaming_products', 'controllers', 'model', 1),
    ('gaming__gaming_products', 'controllers', 'platform', 2),
    ('gaming__gaming_products', 'controllers', 'compatibility', 3),
    ('gaming__gaming_products', 'controllers', 'connection_type', 4),
    ('gaming__gaming_products', 'controllers', 'battery_life', 5),
    ('gaming__gaming_products', 'controllers', 'vibration', 6),
    ('gaming__gaming_products', 'controllers', 'motion_control', 7),
    ('gaming__gaming_products', 'controllers', 'rgb', 8),
    ('gaming__gaming_products', 'controllers', 'color', 9),
    ('gaming__gaming_products', 'gaming_headsets', 'brand', 0),
    ('gaming__gaming_products', 'gaming_headsets', 'model', 1),
    ('gaming__gaming_products', 'gaming_headsets', 'platform', 2),
    ('gaming__gaming_products', 'gaming_headsets', 'connection', 3),
    ('gaming__gaming_products', 'gaming_headsets', 'driver_size', 4),
    ('gaming__gaming_products', 'gaming_headsets', 'surround_sound', 5),
    ('gaming__gaming_products', 'gaming_headsets', 'microphone', 6),
    ('gaming__gaming_products', 'gaming_headsets', 'noise_cancellation', 7),
    ('gaming__gaming_products', 'gaming_headsets', 'rgb', 8),
    ('gaming__gaming_products', 'gaming_headsets', 'battery_life', 9),
    ('gaming__gaming_products', 'gaming_chairs', 'brand', 0),
    ('gaming__gaming_products', 'gaming_chairs', 'model', 1),
    ('gaming__gaming_products', 'gaming_chairs', 'material', 2),
    ('gaming__gaming_products', 'gaming_chairs', 'upholstery', 3),
    ('gaming__gaming_products', 'gaming_chairs', 'maximum_load', 4),
    ('gaming__gaming_products', 'gaming_chairs', 'seat_width', 5),
    ('gaming__gaming_products', 'gaming_chairs', 'height_range', 6),
    ('gaming__gaming_products', 'gaming_chairs', 'recline_angle', 7),
    ('gaming__gaming_products', 'gaming_chairs', 'armrest_type', 8),
    ('gaming__gaming_products', 'gaming_chairs', 'footrest', 9),
    ('gaming__gaming_products', 'gaming_desks', 'brand', 0),
    ('gaming__gaming_products', 'gaming_desks', 'material', 1),
    ('gaming__gaming_products', 'gaming_desks', 'width', 2),
    ('gaming__gaming_products', 'gaming_desks', 'height', 3),
    ('gaming__gaming_products', 'gaming_desks', 'depth', 4),
    ('gaming__gaming_products', 'gaming_desks', 'maximum_load', 5),
    ('gaming__gaming_products', 'gaming_desks', 'cable_management', 6),
    ('gaming__gaming_products', 'gaming_desks', 'rgb', 7),
    ('gaming__gaming_products', 'gaming_desks', 'adjustable_height', 8),
    ('gaming__gaming_products', 'gaming_keyboards', 'brand', 0),
    ('gaming__gaming_products', 'gaming_keyboards', 'model', 1),
    ('gaming__gaming_products', 'gaming_keyboards', 'switch_type', 2),
    ('gaming__gaming_products', 'gaming_keyboards', 'layout', 3),
    ('gaming__gaming_products', 'gaming_keyboards', 'connection', 4),
    ('gaming__gaming_products', 'gaming_keyboards', 'rgb', 5),
    ('gaming__gaming_products', 'gaming_keyboards', 'polling_rate', 6),
    ('gaming__gaming_products', 'gaming_keyboards', 'macro_support', 7),
    ('gaming__gaming_products', 'gaming_mice', 'brand', 0),
    ('gaming__gaming_products', 'gaming_mice', 'model', 1),
    ('gaming__gaming_products', 'gaming_mice', 'sensor', 2),
    ('gaming__gaming_products', 'gaming_mice', 'dpi', 3),
    ('gaming__gaming_products', 'gaming_mice', 'polling_rate', 4),
    ('gaming__gaming_products', 'gaming_mice', 'buttons', 5),
    ('gaming__gaming_products', 'gaming_mice', 'connection', 6),
    ('gaming__gaming_products', 'gaming_mice', 'rgb', 7),
    ('gaming__gaming_products', 'gaming_mice', 'weight', 8),
    ('gaming__gaming_products', 'mouse_pads', 'brand', 0),
    ('gaming__gaming_products', 'mouse_pads', 'material', 1),
    ('gaming__gaming_products', 'mouse_pads', 'dimensions', 2),
    ('gaming__gaming_products', 'mouse_pads', 'surface_type', 3),
    ('gaming__gaming_products', 'mouse_pads', 'thickness', 4),
    ('gaming__gaming_products', 'mouse_pads', 'rgb', 5),
    ('gaming__gaming_products', 'mouse_pads', 'waterproof', 6),
    ('gaming__gaming_products', 'games', 'title', 0),
    ('gaming__gaming_products', 'games', 'platform', 1),
    ('gaming__gaming_products', 'games', 'genre', 2),
    ('gaming__gaming_products', 'games', 'edition', 3),
    ('gaming__gaming_products', 'games', 'region', 4),
    ('gaming__gaming_products', 'games', 'age_rating', 5),
    ('gaming__gaming_products', 'games', 'physical_digital', 6),
    ('gaming__gaming_products', 'games', 'language', 7),
    ('gaming__gaming_products', 'gaming_monitors', 'brand', 0),
    ('gaming__gaming_products', 'gaming_monitors', 'model', 1),
    ('gaming__gaming_products', 'gaming_monitors', 'screen_size', 2),
    ('gaming__gaming_products', 'gaming_monitors', 'resolution', 3),
    ('gaming__gaming_products', 'gaming_monitors', 'refresh_rate', 4),
    ('gaming__gaming_products', 'gaming_monitors', 'response_time', 5),
    ('gaming__gaming_products', 'gaming_monitors', 'panel_type', 6),
    ('gaming__gaming_products', 'gaming_monitors', 'hdr', 7),
    ('gaming__gaming_products', 'gaming_monitors', 'adaptive_sync', 8),
    ('gaming__gaming_products', 'gaming_monitors', 'ports', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'product_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'upholstery_material', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'frame_material', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'color', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'width', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'height', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'depth', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'seat_height', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'number_of_seats', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'maximum_load', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'cushion_material', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'cushion_removable', 13),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'reclining', 14),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'sofa_configuration', 15),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'assembly_required', 16),
    ('home_furniture_living__furniture_home_equipment_living', 'sofas', 'room_type', 17),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'product_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'upholstery_material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'frame_material', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'color', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'width', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'height', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'depth', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'seat_height', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'maximum_load', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'cushion_material', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'armrest_type', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'reclining', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'assembly_required', 13),
    ('home_furniture_living__furniture_home_equipment_living', 'armchairs', 'room_type', 14),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'chair_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'upholstery_material', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'frame_material', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'color', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'width', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'height', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'depth', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'seat_height', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'maximum_load', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'armrests', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'adjustable_height', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'wheels', 13),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'stackable', 14),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'assembly_required', 15),
    ('home_furniture_living__furniture_home_equipment_living', 'chairs', 'room_type', 16),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'upholstery_material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'frame_material', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'color', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'width', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'height', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'depth', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'seat_height', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'maximum_load', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'armrests', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'stackable', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_chairs', 'assembly_required', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'model', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'upholstery_material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'frame_material', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'color', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'seat_height_range', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'maximum_load', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'adjustable_height', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'armrests', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'backrest_type', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'lumbar_support', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'headrest', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'wheels', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'office_chairs', 'recline_angle', 13),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'model', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'upholstery_material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'frame_material', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'color', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'maximum_load', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'seat_width', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'height_range', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'recline_angle', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'armrest_type', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'lumbar_support', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'headrest', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'footrest', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'gaming_chairs', 'wheels', 13),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'table_type', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'color', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'length', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'width', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'height', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'maximum_load', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'number_of_seats', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'shape', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'extendable', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'foldable', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'assembly_required', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'dining_tables', 'room_type', 13),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'length', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'width', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'height', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'shape', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'maximum_load', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'storage', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'number_of_shelves', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'assembly_required', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'coffee_tables', 'room_type', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'maximum_load', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'desk_type', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'adjustable_height', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'storage', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'number_of_drawers', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'cable_management', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'desks', 'assembly_required', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'maximum_load', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'adjustable_height', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'number_of_drawers', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'cable_management', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'storage', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'office_desks', 'assembly_required', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'bed_type', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'frame_material', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'color', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'mattress_size', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'width', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'length', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'height', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'maximum_load', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'storage', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'headboard', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'adjustable', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'assembly_required', 13),
    ('home_furniture_living__furniture_home_equipment_living', 'beds', 'room_type', 14),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'mattress_type', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'size', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'length', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'width', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'height', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'firmness', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'material', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'filling_material', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'support_type', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'hypoallergenic', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'removable_cover', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'mattresses', 'breathability', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'number_of_drawers', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'number_of_shelves', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'maximum_load', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'bedside_tables', 'assembly_required', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'number_of_doors', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'door_type', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'number_of_shelves', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'hanging_rail', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'drawers', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'maximum_load', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'wardrobes', 'assembly_required', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'door_count', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'drawer_count', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'shelf_count', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'maximum_load', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'lockable', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'assembly_required', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'cabinets', 'room_type', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'number_of_shelves', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'maximum_load_per_shelf', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'wall_mounted_freestanding', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'adjustable_shelves', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'shelves', 'assembly_required', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'number_of_shelves', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'maximum_load_per_shelf', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'adjustable_shelves', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'bookcases', 'assembly_required', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'tv_size_compatibility', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'maximum_load', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'shelves', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'cabinets', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'cable_management', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'tv_units', 'assembly_required', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'capacity', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'width', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'height', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'depth', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'lid_type', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'stackable', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_boxes', 'foldable', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'capacity', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'width', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'height', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'depth', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'lid_type', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'stackable', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'storage_bins', 'handles', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'door_count', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'drawer_count', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'shelf_count', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'installation_type', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_cabinets', 'assembly_required', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'length', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'width', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'height', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'shape', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'number_of_seats', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'maximum_load', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'extendable', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_tables', 'assembly_required', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'depth', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'seat_height', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'maximum_load', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'stackable', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchen_chairs', 'assembly_required', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'product_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'color', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'light_type', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'bulb_type', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'wattage', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'lumens', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'color_temperature', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'dimmable', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'voltage', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'ip_rating', 11),
    ('home_furniture_living__furniture_home_equipment_living', 'lighting', 'smart_features', 12),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'lamp_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'color', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'bulb_type', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'wattage', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'lumens', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'color_temperature', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'dimmable', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'switch_type', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'lamps', 'cable_length', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'bulb_type', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'wattage', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'lumens', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'color_temperature', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'dimmable', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'voltage', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'ip_rating', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'ceiling_lights', 'installation_type', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'product_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'color', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'capacity', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'dimensions', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'quantity', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'dishwasher_safe', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'microwave_safe', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'oven_safe', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'kitchenware', 'food_safe', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'product_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'diameter', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'capacity', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'handle_material', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'non_stick', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'induction_compatible', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'oven_safe', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'cookware', 'dishwasher_safe', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'product_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'color', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'diameter', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'capacity', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'quantity', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'dishwasher_safe', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'dinnerware', 'microwave_safe', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'length', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'pattern', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'opacity', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'blackout', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'thermal_insulation', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'curtains', 'mounting_type', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'length', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'width', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'shape', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'pile_height', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'pattern', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'indoor_outdoor', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'non_slip', 9),
    ('home_furniture_living__furniture_home_equipment_living', 'rugs', 'washable', 10),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'brand', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'frame_material', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'frame_color', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'width', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'height', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'shape', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'mirror_type', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'mounting_type', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'mirrors', 'room_type', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'product_type', 0),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'brand', 1),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'material', 2),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'color', 3),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'dimensions', 4),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'weight', 5),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'style', 6),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'room_type', 7),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'handmade', 8),
    ('home_furniture_living__furniture_home_equipment_living', 'home_decoration', 'mounting_type', 9),
    ('beauty_personal_care__personal_care', 'skincare', 'brand', 0),
    ('beauty_personal_care__personal_care', 'skincare', 'product_type', 1),
    ('beauty_personal_care__personal_care', 'skincare', 'volume', 2),
    ('beauty_personal_care__personal_care', 'skincare', 'weight', 3),
    ('beauty_personal_care__personal_care', 'skincare', 'skin_type', 4),
    ('beauty_personal_care__personal_care', 'skincare', 'ingredients', 5),
    ('beauty_personal_care__personal_care', 'skincare', 'fragrance', 6),
    ('beauty_personal_care__personal_care', 'skincare', 'benefits', 7),
    ('beauty_personal_care__personal_care', 'skincare', 'spf', 8),
    ('beauty_personal_care__personal_care', 'skincare', 'skin_concern', 9),
    ('beauty_personal_care__personal_care', 'skincare', 'suitable_age', 10),
    ('beauty_personal_care__personal_care', 'skincare', 'expiration_date', 11),
    ('beauty_personal_care__personal_care', 'haircare', 'brand', 0),
    ('beauty_personal_care__personal_care', 'haircare', 'product_type', 1),
    ('beauty_personal_care__personal_care', 'haircare', 'volume', 2),
    ('beauty_personal_care__personal_care', 'haircare', 'hair_type', 3),
    ('beauty_personal_care__personal_care', 'haircare', 'ingredients', 4),
    ('beauty_personal_care__personal_care', 'haircare', 'fragrance', 5),
    ('beauty_personal_care__personal_care', 'haircare', 'benefits', 6),
    ('beauty_personal_care__personal_care', 'haircare', 'hair_concern', 7),
    ('beauty_personal_care__personal_care', 'haircare', 'suitable_age', 8),
    ('beauty_personal_care__personal_care', 'haircare', 'expiration_date', 9),
    ('beauty_personal_care__personal_care', 'makeup', 'brand', 0),
    ('beauty_personal_care__personal_care', 'makeup', 'product_type', 1),
    ('beauty_personal_care__personal_care', 'makeup', 'shade', 2),
    ('beauty_personal_care__personal_care', 'makeup', 'finish', 3),
    ('beauty_personal_care__personal_care', 'makeup', 'skin_type', 4),
    ('beauty_personal_care__personal_care', 'makeup', 'volume', 5),
    ('beauty_personal_care__personal_care', 'makeup', 'ingredients', 6),
    ('beauty_personal_care__personal_care', 'makeup', 'spf', 7),
    ('beauty_personal_care__personal_care', 'makeup', 'coverage', 8),
    ('beauty_personal_care__personal_care', 'makeup', 'expiration_date', 9),
    ('beauty_personal_care__personal_care', 'perfume', 'brand', 0),
    ('beauty_personal_care__personal_care', 'perfume', 'product_type', 1),
    ('beauty_personal_care__personal_care', 'perfume', 'volume', 2),
    ('beauty_personal_care__personal_care', 'perfume', 'fragrance_family', 3),
    ('beauty_personal_care__personal_care', 'perfume', 'top_notes', 4),
    ('beauty_personal_care__personal_care', 'perfume', 'heart_notes', 5),
    ('beauty_personal_care__personal_care', 'perfume', 'base_notes', 6),
    ('beauty_personal_care__personal_care', 'perfume', 'gender', 7),
    ('beauty_personal_care__personal_care', 'perfume', 'concentration', 8),
    ('beauty_personal_care__personal_care', 'perfume', 'expiration_date', 9),
    ('beauty_personal_care__personal_care', 'grooming', 'brand', 0),
    ('beauty_personal_care__personal_care', 'grooming', 'product_type', 1),
    ('beauty_personal_care__personal_care', 'grooming', 'material', 2),
    ('beauty_personal_care__personal_care', 'grooming', 'power_source', 3),
    ('beauty_personal_care__personal_care', 'grooming', 'battery_life', 4),
    ('beauty_personal_care__personal_care', 'grooming', 'attachments', 5),
    ('beauty_personal_care__personal_care', 'grooming', 'skin_hair_type', 6),
    ('beauty_personal_care__personal_care', 'grooming', 'waterproof', 7),
    ('beauty_personal_care__personal_care', 'oral_care', 'brand', 0),
    ('beauty_personal_care__personal_care', 'oral_care', 'product_type', 1),
    ('beauty_personal_care__personal_care', 'oral_care', 'ingredients', 2),
    ('beauty_personal_care__personal_care', 'oral_care', 'volume', 3),
    ('beauty_personal_care__personal_care', 'oral_care', 'quantity', 4),
    ('beauty_personal_care__personal_care', 'oral_care', 'suitable_age', 5),
    ('beauty_personal_care__personal_care', 'oral_care', 'benefits', 6),
    ('beauty_personal_care__personal_care', 'oral_care', 'expiration_date', 7),
    ('beauty_personal_care__personal_care', 'shaving_products', 'brand', 0),
    ('beauty_personal_care__personal_care', 'shaving_products', 'product_type', 1),
    ('beauty_personal_care__personal_care', 'shaving_products', 'material', 2),
    ('beauty_personal_care__personal_care', 'shaving_products', 'blade_count', 3),
    ('beauty_personal_care__personal_care', 'shaving_products', 'quantity', 4),
    ('beauty_personal_care__personal_care', 'shaving_products', 'skin_type', 5),
    ('beauty_personal_care__personal_care', 'shaving_products', 'ingredients', 6),
    ('beauty_personal_care__personal_care', 'shaving_products', 'suitable_age', 7),
    ('bags_luggage__bags_travel', 'backpacks', 'brand', 0),
    ('bags_luggage__bags_travel', 'backpacks', 'material', 1),
    ('bags_luggage__bags_travel', 'backpacks', 'color', 2),
    ('bags_luggage__bags_travel', 'backpacks', 'capacity', 3),
    ('bags_luggage__bags_travel', 'backpacks', 'dimensions', 4),
    ('bags_luggage__bags_travel', 'backpacks', 'weight', 5),
    ('bags_luggage__bags_travel', 'backpacks', 'compartments', 6),
    ('bags_luggage__bags_travel', 'backpacks', 'laptop_compatibility', 7),
    ('bags_luggage__bags_travel', 'backpacks', 'laptop_size', 8),
    ('bags_luggage__bags_travel', 'backpacks', 'waterproof', 9),
    ('bags_luggage__bags_travel', 'backpacks', 'strap_type', 10),
    ('bags_luggage__bags_travel', 'gym_bags', 'brand', 0),
    ('bags_luggage__bags_travel', 'gym_bags', 'material', 1),
    ('bags_luggage__bags_travel', 'gym_bags', 'capacity', 2),
    ('bags_luggage__bags_travel', 'gym_bags', 'dimensions', 3),
    ('bags_luggage__bags_travel', 'gym_bags', 'compartments', 4),
    ('bags_luggage__bags_travel', 'gym_bags', 'shoe_compartment', 5),
    ('bags_luggage__bags_travel', 'gym_bags', 'waterproof', 6),
    ('bags_luggage__bags_travel', 'gym_bags', 'strap_type', 7),
    ('bags_luggage__bags_travel', 'gym_bags', 'color', 8),
    ('bags_luggage__bags_travel', 'handbags', 'brand', 0),
    ('bags_luggage__bags_travel', 'handbags', 'material', 1),
    ('bags_luggage__bags_travel', 'handbags', 'color', 2),
    ('bags_luggage__bags_travel', 'handbags', 'capacity', 3),
    ('bags_luggage__bags_travel', 'handbags', 'dimensions', 4),
    ('bags_luggage__bags_travel', 'handbags', 'compartments', 5),
    ('bags_luggage__bags_travel', 'handbags', 'closure_type', 6),
    ('bags_luggage__bags_travel', 'handbags', 'strap_type', 7),
    ('bags_luggage__bags_travel', 'handbags', 'style', 8),
    ('bags_luggage__bags_travel', 'shoulder_bags', 'brand', 0),
    ('bags_luggage__bags_travel', 'shoulder_bags', 'material', 1),
    ('bags_luggage__bags_travel', 'shoulder_bags', 'color', 2),
    ('bags_luggage__bags_travel', 'shoulder_bags', 'capacity', 3),
    ('bags_luggage__bags_travel', 'shoulder_bags', 'dimensions', 4),
    ('bags_luggage__bags_travel', 'shoulder_bags', 'compartments', 5),
    ('bags_luggage__bags_travel', 'shoulder_bags', 'closure_type', 6),
    ('bags_luggage__bags_travel', 'shoulder_bags', 'strap_type', 7),
    ('bags_luggage__bags_travel', 'crossbody_bags', 'brand', 0),
    ('bags_luggage__bags_travel', 'crossbody_bags', 'material', 1),
    ('bags_luggage__bags_travel', 'crossbody_bags', 'color', 2),
    ('bags_luggage__bags_travel', 'crossbody_bags', 'capacity', 3),
    ('bags_luggage__bags_travel', 'crossbody_bags', 'dimensions', 4),
    ('bags_luggage__bags_travel', 'crossbody_bags', 'compartments', 5),
    ('bags_luggage__bags_travel', 'crossbody_bags', 'closure_type', 6),
    ('bags_luggage__bags_travel', 'crossbody_bags', 'adjustable_strap', 7),
    ('bags_luggage__bags_travel', 'suitcases', 'brand', 0),
    ('bags_luggage__bags_travel', 'suitcases', 'material', 1),
    ('bags_luggage__bags_travel', 'suitcases', 'size', 2),
    ('bags_luggage__bags_travel', 'suitcases', 'capacity', 3),
    ('bags_luggage__bags_travel', 'suitcases', 'dimensions', 4),
    ('bags_luggage__bags_travel', 'suitcases', 'weight', 5),
    ('bags_luggage__bags_travel', 'suitcases', 'wheels', 6),
    ('bags_luggage__bags_travel', 'suitcases', 'handle_type', 7),
    ('bags_luggage__bags_travel', 'suitcases', 'lock_type', 8),
    ('bags_luggage__bags_travel', 'suitcases', 'expandable', 9),
    ('bags_luggage__bags_travel', 'suitcases', 'hard_soft_shell', 10),
    ('bags_luggage__bags_travel', 'travel_bags', 'brand', 0),
    ('bags_luggage__bags_travel', 'travel_bags', 'material', 1),
    ('bags_luggage__bags_travel', 'travel_bags', 'capacity', 2),
    ('bags_luggage__bags_travel', 'travel_bags', 'dimensions', 3),
    ('bags_luggage__bags_travel', 'travel_bags', 'weight', 4),
    ('bags_luggage__bags_travel', 'travel_bags', 'compartments', 5),
    ('bags_luggage__bags_travel', 'travel_bags', 'shoe_compartment', 6),
    ('bags_luggage__bags_travel', 'travel_bags', 'waterproof', 7),
    ('bags_luggage__bags_travel', 'travel_bags', 'strap_type', 8),
    ('bags_luggage__bags_travel', 'laptop_bags', 'brand', 0),
    ('bags_luggage__bags_travel', 'laptop_bags', 'material', 1),
    ('bags_luggage__bags_travel', 'laptop_bags', 'laptop_size', 2),
    ('bags_luggage__bags_travel', 'laptop_bags', 'capacity', 3),
    ('bags_luggage__bags_travel', 'laptop_bags', 'compartments', 4),
    ('bags_luggage__bags_travel', 'laptop_bags', 'waterproof', 5),
    ('bags_luggage__bags_travel', 'laptop_bags', 'strap_type', 6),
    ('bags_luggage__bags_travel', 'laptop_bags', 'closure_type', 7),
    ('bags_luggage__bags_travel', 'laptop_bags', 'color', 8),
    ('automotive__automotive_products', 'car_accessories', 'brand', 0),
    ('automotive__automotive_products', 'car_accessories', 'product_type', 1),
    ('automotive__automotive_products', 'car_accessories', 'vehicle_make', 2),
    ('automotive__automotive_products', 'car_accessories', 'vehicle_model', 3),
    ('automotive__automotive_products', 'car_accessories', 'vehicle_year', 4),
    ('automotive__automotive_products', 'car_accessories', 'compatibility', 5),
    ('automotive__automotive_products', 'car_accessories', 'material', 6),
    ('automotive__automotive_products', 'car_accessories', 'color', 7),
    ('automotive__automotive_products', 'car_accessories', 'dimensions', 8),
    ('automotive__automotive_products', 'car_accessories', 'installation_type', 9),
    ('automotive__automotive_products', 'motorcycle_accessories', 'brand', 0),
    ('automotive__automotive_products', 'motorcycle_accessories', 'product_type', 1),
    ('automotive__automotive_products', 'motorcycle_accessories', 'motorcycle_make', 2),
    ('automotive__automotive_products', 'motorcycle_accessories', 'model', 3),
    ('automotive__automotive_products', 'motorcycle_accessories', 'year', 4),
    ('automotive__automotive_products', 'motorcycle_accessories', 'compatibility', 5),
    ('automotive__automotive_products', 'motorcycle_accessories', 'material', 6),
    ('automotive__automotive_products', 'motorcycle_accessories', 'color', 7),
    ('automotive__automotive_products', 'motorcycle_accessories', 'dimensions', 8),
    ('automotive__automotive_products', 'motorcycle_accessories', 'installation_type', 9),
    ('automotive__automotive_products', 'car_electronics', 'brand', 0),
    ('automotive__automotive_products', 'car_electronics', 'model', 1),
    ('automotive__automotive_products', 'car_electronics', 'device_type', 2),
    ('automotive__automotive_products', 'car_electronics', 'vehicle_compatibility', 3),
    ('automotive__automotive_products', 'car_electronics', 'voltage', 4),
    ('automotive__automotive_products', 'car_electronics', 'power', 5),
    ('automotive__automotive_products', 'car_electronics', 'connectivity', 6),
    ('automotive__automotive_products', 'car_electronics', 'display', 7),
    ('automotive__automotive_products', 'car_electronics', 'installation_type', 8),
    ('automotive__automotive_products', 'interior_accessories', 'brand', 0),
    ('automotive__automotive_products', 'interior_accessories', 'product_type', 1),
    ('automotive__automotive_products', 'interior_accessories', 'vehicle_make', 2),
    ('automotive__automotive_products', 'interior_accessories', 'model', 3),
    ('automotive__automotive_products', 'interior_accessories', 'year', 4),
    ('automotive__automotive_products', 'interior_accessories', 'material', 5),
    ('automotive__automotive_products', 'interior_accessories', 'color', 6),
    ('automotive__automotive_products', 'interior_accessories', 'dimensions', 7),
    ('automotive__automotive_products', 'interior_accessories', 'quantity', 8),
    ('automotive__automotive_products', 'exterior_accessories', 'brand', 0),
    ('automotive__automotive_products', 'exterior_accessories', 'product_type', 1),
    ('automotive__automotive_products', 'exterior_accessories', 'vehicle_make', 2),
    ('automotive__automotive_products', 'exterior_accessories', 'model', 3),
    ('automotive__automotive_products', 'exterior_accessories', 'year', 4),
    ('automotive__automotive_products', 'exterior_accessories', 'material', 5),
    ('automotive__automotive_products', 'exterior_accessories', 'color', 6),
    ('automotive__automotive_products', 'exterior_accessories', 'dimensions', 7),
    ('automotive__automotive_products', 'exterior_accessories', 'waterproof', 8),
    ('automotive__automotive_products', 'maintenance_products', 'brand', 0),
    ('automotive__automotive_products', 'maintenance_products', 'product_type', 1),
    ('automotive__automotive_products', 'maintenance_products', 'compatibility', 2),
    ('automotive__automotive_products', 'maintenance_products', 'volume', 3),
    ('automotive__automotive_products', 'maintenance_products', 'weight', 4),
    ('automotive__automotive_products', 'maintenance_products', 'ingredients', 5),
    ('automotive__automotive_products', 'maintenance_products', 'application', 6),
    ('automotive__automotive_products', 'maintenance_products', 'quantity', 7),
    ('automotive__automotive_products', 'automotive_tools', 'brand', 0),
    ('automotive__automotive_products', 'automotive_tools', 'tool_type', 1),
    ('automotive__automotive_products', 'automotive_tools', 'material', 2),
    ('automotive__automotive_products', 'automotive_tools', 'dimensions', 3),
    ('automotive__automotive_products', 'automotive_tools', 'weight', 4),
    ('automotive__automotive_products', 'automotive_tools', 'maximum_load', 5),
    ('automotive__automotive_products', 'automotive_tools', 'power_source', 6),
    ('automotive__automotive_products', 'automotive_tools', 'voltage', 7),
    ('sports_outdoor__sports_outdoor', 'football', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'football', 'size', 1),
    ('sports_outdoor__sports_outdoor', 'football', 'material', 2),
    ('sports_outdoor__sports_outdoor', 'football', 'weight', 3),
    ('sports_outdoor__sports_outdoor', 'football', 'construction', 4),
    ('sports_outdoor__sports_outdoor', 'football', 'surface', 5),
    ('sports_outdoor__sports_outdoor', 'football', 'certification', 6),
    ('sports_outdoor__sports_outdoor', 'football', 'color', 7),
    ('sports_outdoor__sports_outdoor', 'basketball', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'basketball', 'size', 1),
    ('sports_outdoor__sports_outdoor', 'basketball', 'material', 2),
    ('sports_outdoor__sports_outdoor', 'basketball', 'weight', 3),
    ('sports_outdoor__sports_outdoor', 'basketball', 'surface', 4),
    ('sports_outdoor__sports_outdoor', 'basketball', 'construction', 5),
    ('sports_outdoor__sports_outdoor', 'basketball', 'color', 6),
    ('sports_outdoor__sports_outdoor', 'volleyball', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'volleyball', 'size', 1),
    ('sports_outdoor__sports_outdoor', 'volleyball', 'material', 2),
    ('sports_outdoor__sports_outdoor', 'volleyball', 'weight', 3),
    ('sports_outdoor__sports_outdoor', 'volleyball', 'construction', 4),
    ('sports_outdoor__sports_outdoor', 'volleyball', 'surface', 5),
    ('sports_outdoor__sports_outdoor', 'volleyball', 'color', 6),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'model', 1),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'head_size', 2),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'weight', 3),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'balance', 4),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'string_pattern', 5),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'length', 6),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'grip_size', 7),
    ('sports_outdoor__sports_outdoor', 'tennis_rackets', 'material', 8),
    ('sports_outdoor__sports_outdoor', 'running_equipment', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'running_equipment', 'product_type', 1),
    ('sports_outdoor__sports_outdoor', 'running_equipment', 'size', 2),
    ('sports_outdoor__sports_outdoor', 'running_equipment', 'material', 3),
    ('sports_outdoor__sports_outdoor', 'running_equipment', 'weight', 4),
    ('sports_outdoor__sports_outdoor', 'running_equipment', 'activity', 5),
    ('sports_outdoor__sports_outdoor', 'running_equipment', 'terrain', 6),
    ('sports_outdoor__sports_outdoor', 'running_equipment', 'color', 7),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'model', 1),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'bike_type', 2),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'frame_material', 3),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'frame_size', 4),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'wheel_size', 5),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'brake_type', 6),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'gear_count', 7),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'suspension', 8),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'weight', 9),
    ('sports_outdoor__sports_outdoor', 'bicycles', 'color', 10),
    ('sports_outdoor__sports_outdoor', 'camping_equipment', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'camping_equipment', 'product_type', 1),
    ('sports_outdoor__sports_outdoor', 'camping_equipment', 'material', 2),
    ('sports_outdoor__sports_outdoor', 'camping_equipment', 'capacity', 3),
    ('sports_outdoor__sports_outdoor', 'camping_equipment', 'dimensions', 4),
    ('sports_outdoor__sports_outdoor', 'camping_equipment', 'weight', 5),
    ('sports_outdoor__sports_outdoor', 'camping_equipment', 'waterproof', 6),
    ('sports_outdoor__sports_outdoor', 'camping_equipment', 'number_of_persons', 7),
    ('sports_outdoor__sports_outdoor', 'hiking_equipment', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'hiking_equipment', 'product_type', 1),
    ('sports_outdoor__sports_outdoor', 'hiking_equipment', 'material', 2),
    ('sports_outdoor__sports_outdoor', 'hiking_equipment', 'size', 3),
    ('sports_outdoor__sports_outdoor', 'hiking_equipment', 'weight', 4),
    ('sports_outdoor__sports_outdoor', 'hiking_equipment', 'waterproof', 5),
    ('sports_outdoor__sports_outdoor', 'hiking_equipment', 'terrain', 6),
    ('sports_outdoor__sports_outdoor', 'hiking_equipment', 'support_level', 7),
    ('sports_outdoor__sports_outdoor', 'swimming_equipment', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'swimming_equipment', 'product_type', 1),
    ('sports_outdoor__sports_outdoor', 'swimming_equipment', 'size', 2),
    ('sports_outdoor__sports_outdoor', 'swimming_equipment', 'material', 3),
    ('sports_outdoor__sports_outdoor', 'swimming_equipment', 'color', 4),
    ('sports_outdoor__sports_outdoor', 'swimming_equipment', 'uv_protection', 5),
    ('sports_outdoor__sports_outdoor', 'swimming_equipment', 'waterproof', 6),
    ('sports_outdoor__sports_outdoor', 'swimming_equipment', 'activity', 7),
    ('sports_outdoor__sports_outdoor', 'fishing_equipment', 'brand', 0),
    ('sports_outdoor__sports_outdoor', 'fishing_equipment', 'product_type', 1),
    ('sports_outdoor__sports_outdoor', 'fishing_equipment', 'material', 2),
    ('sports_outdoor__sports_outdoor', 'fishing_equipment', 'length', 3),
    ('sports_outdoor__sports_outdoor', 'fishing_equipment', 'weight', 4),
    ('sports_outdoor__sports_outdoor', 'fishing_equipment', 'line_capacity', 5),
    ('sports_outdoor__sports_outdoor', 'fishing_equipment', 'action', 6),
    ('sports_outdoor__sports_outdoor', 'fishing_equipment', 'power', 7),
    ('books_education__education_stationery', 'books', 'title', 0),
    ('books_education__education_stationery', 'books', 'author', 1),
    ('books_education__education_stationery', 'books', 'publisher', 2),
    ('books_education__education_stationery', 'books', 'isbn', 3),
    ('books_education__education_stationery', 'books', 'language', 4),
    ('books_education__education_stationery', 'books', 'edition', 5),
    ('books_education__education_stationery', 'books', 'publication_date', 6),
    ('books_education__education_stationery', 'books', 'number_of_pages', 7),
    ('books_education__education_stationery', 'books', 'format', 8),
    ('books_education__education_stationery', 'books', 'condition', 9),
    ('books_education__education_stationery', 'books', 'subject', 10),
    ('books_education__education_stationery', 'books', 'genre', 11),
    ('books_education__education_stationery', 'textbooks', 'title', 0),
    ('books_education__education_stationery', 'textbooks', 'author', 1),
    ('books_education__education_stationery', 'textbooks', 'publisher', 2),
    ('books_education__education_stationery', 'textbooks', 'isbn', 3),
    ('books_education__education_stationery', 'textbooks', 'language', 4),
    ('books_education__education_stationery', 'textbooks', 'edition', 5),
    ('books_education__education_stationery', 'textbooks', 'publication_date', 6),
    ('books_education__education_stationery', 'textbooks', 'number_of_pages', 7),
    ('books_education__education_stationery', 'textbooks', 'subject', 8),
    ('books_education__education_stationery', 'textbooks', 'education_level', 9),
    ('books_education__education_stationery', 'textbooks', 'condition', 10),
    ('books_education__education_stationery', 'study_materials', 'title', 0),
    ('books_education__education_stationery', 'study_materials', 'subject', 1),
    ('books_education__education_stationery', 'study_materials', 'education_level', 2),
    ('books_education__education_stationery', 'study_materials', 'language', 3),
    ('books_education__education_stationery', 'study_materials', 'format', 4),
    ('books_education__education_stationery', 'study_materials', 'author_creator', 5),
    ('books_education__education_stationery', 'study_materials', 'edition', 6),
    ('books_education__education_stationery', 'study_materials', 'quantity', 7),
    ('books_education__education_stationery', 'notebooks', 'brand', 0),
    ('books_education__education_stationery', 'notebooks', 'size', 1),
    ('books_education__education_stationery', 'notebooks', 'paper_type', 2),
    ('books_education__education_stationery', 'notebooks', 'number_of_pages', 3),
    ('books_education__education_stationery', 'notebooks', 'cover_material', 4),
    ('books_education__education_stationery', 'notebooks', 'binding_type', 5),
    ('books_education__education_stationery', 'notebooks', 'color', 6),
    ('books_education__education_stationery', 'notebooks', 'quantity', 7),
    ('books_education__education_stationery', 'stationery', 'brand', 0),
    ('books_education__education_stationery', 'stationery', 'product_type', 1),
    ('books_education__education_stationery', 'stationery', 'material', 2),
    ('books_education__education_stationery', 'stationery', 'color', 3),
    ('books_education__education_stationery', 'stationery', 'quantity', 4),
    ('books_education__education_stationery', 'stationery', 'size', 5),
    ('books_education__education_stationery', 'stationery', 'intended_use', 6),
    ('books_education__education_stationery', 'educational_toys', 'brand', 0),
    ('books_education__education_stationery', 'educational_toys', 'product_type', 1),
    ('books_education__education_stationery', 'educational_toys', 'age_group', 2),
    ('books_education__education_stationery', 'educational_toys', 'material', 3),
    ('books_education__education_stationery', 'educational_toys', 'educational_level', 4),
    ('books_education__education_stationery', 'educational_toys', 'skill_developed', 5),
    ('books_education__education_stationery', 'educational_toys', 'safety_certification', 6),
    ('books_education__education_stationery', 'educational_toys', 'quantity', 7),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'brand', 0),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'age_range', 1),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'gender', 2),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'size', 3),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'material', 4),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'color', 5),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'season', 6),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'closure', 7),
    ('baby_kids__baby_kids_products', 'baby_clothing', 'care_instructions', 8),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'brand', 0),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'age_range', 1),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'gender', 2),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'size', 3),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'material', 4),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'color', 5),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'style', 6),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'season', 7),
    ('baby_kids__baby_kids_products', 'kids_clothing', 'care_instructions', 8),
    ('baby_kids__baby_kids_products', 'baby_shoes', 'brand', 0),
    ('baby_kids__baby_kids_products', 'baby_shoes', 'age_range', 1),
    ('baby_kids__baby_kids_products', 'baby_shoes', 'size', 2),
    ('baby_kids__baby_kids_products', 'baby_shoes', 'material', 3),
    ('baby_kids__baby_kids_products', 'baby_shoes', 'color', 4),
    ('baby_kids__baby_kids_products', 'baby_shoes', 'sole_material', 5),
    ('baby_kids__baby_kids_products', 'baby_shoes', 'closure', 6),
    ('baby_kids__baby_kids_products', 'baby_shoes', 'weight', 7),
    ('baby_kids__baby_kids_products', 'toys', 'brand', 0),
    ('baby_kids__baby_kids_products', 'toys', 'toy_type', 1),
    ('baby_kids__baby_kids_products', 'toys', 'age_range', 2),
    ('baby_kids__baby_kids_products', 'toys', 'material', 3),
    ('baby_kids__baby_kids_products', 'toys', 'dimensions', 4),
    ('baby_kids__baby_kids_products', 'toys', 'battery_required', 5),
    ('baby_kids__baby_kids_products', 'toys', 'safety_certification', 6),
    ('baby_kids__baby_kids_products', 'toys', 'educational_level', 7),
    ('baby_kids__baby_kids_products', 'strollers', 'brand', 0),
    ('baby_kids__baby_kids_products', 'strollers', 'model', 1),
    ('baby_kids__baby_kids_products', 'strollers', 'type', 2),
    ('baby_kids__baby_kids_products', 'strollers', 'age_range', 3),
    ('baby_kids__baby_kids_products', 'strollers', 'maximum_load', 4),
    ('baby_kids__baby_kids_products', 'strollers', 'weight', 5),
    ('baby_kids__baby_kids_products', 'strollers', 'dimensions', 6),
    ('baby_kids__baby_kids_products', 'strollers', 'foldable', 7),
    ('baby_kids__baby_kids_products', 'strollers', 'wheel_type', 8),
    ('baby_kids__baby_kids_products', 'strollers', 'safety_features', 9),
    ('baby_kids__baby_kids_products', 'baby_furniture', 'brand', 0),
    ('baby_kids__baby_kids_products', 'baby_furniture', 'product_type', 1),
    ('baby_kids__baby_kids_products', 'baby_furniture', 'material', 2),
    ('baby_kids__baby_kids_products', 'baby_furniture', 'color', 3),
    ('baby_kids__baby_kids_products', 'baby_furniture', 'dimensions', 4),
    ('baby_kids__baby_kids_products', 'baby_furniture', 'maximum_load', 5),
    ('baby_kids__baby_kids_products', 'baby_furniture', 'safety_certification', 6),
    ('baby_kids__baby_kids_products', 'baby_furniture', 'assembly_required', 7),
    ('baby_kids__baby_kids_products', 'feeding_products', 'brand', 0),
    ('baby_kids__baby_kids_products', 'feeding_products', 'product_type', 1),
    ('baby_kids__baby_kids_products', 'feeding_products', 'material', 2),
    ('baby_kids__baby_kids_products', 'feeding_products', 'capacity', 3),
    ('baby_kids__baby_kids_products', 'feeding_products', 'quantity', 4),
    ('baby_kids__baby_kids_products', 'feeding_products', 'bpa_free', 5),
    ('baby_kids__baby_kids_products', 'feeding_products', 'dishwasher_safe', 6),
    ('baby_kids__baby_kids_products', 'feeding_products', 'suitable_age', 7),
    ('baby_kids__baby_kids_products', 'school_accessories', 'brand', 0),
    ('baby_kids__baby_kids_products', 'school_accessories', 'product_type', 1),
    ('baby_kids__baby_kids_products', 'school_accessories', 'material', 2),
    ('baby_kids__baby_kids_products', 'school_accessories', 'color', 3),
    ('baby_kids__baby_kids_products', 'school_accessories', 'dimensions', 4),
    ('baby_kids__baby_kids_products', 'school_accessories', 'capacity', 5),
    ('baby_kids__baby_kids_products', 'school_accessories', 'age_range', 6),
    ('pet_supplies__pet_products', 'pet_food', 'brand', 0),
    ('pet_supplies__pet_products', 'pet_food', 'pet_type', 1),
    ('pet_supplies__pet_products', 'pet_food', 'breed_size', 2),
    ('pet_supplies__pet_products', 'pet_food', 'age', 3),
    ('pet_supplies__pet_products', 'pet_food', 'flavor', 4),
    ('pet_supplies__pet_products', 'pet_food', 'weight', 5),
    ('pet_supplies__pet_products', 'pet_food', 'ingredients', 6),
    ('pet_supplies__pet_products', 'pet_food', 'nutritional_information', 7),
    ('pet_supplies__pet_products', 'pet_food', 'allergens', 8),
    ('pet_supplies__pet_products', 'pet_food', 'expiration_date', 9),
    ('pet_supplies__pet_products', 'pet_toys', 'brand', 0),
    ('pet_supplies__pet_products', 'pet_toys', 'pet_type', 1),
    ('pet_supplies__pet_products', 'pet_toys', 'material', 2),
    ('pet_supplies__pet_products', 'pet_toys', 'dimensions', 3),
    ('pet_supplies__pet_products', 'pet_toys', 'toy_type', 4),
    ('pet_supplies__pet_products', 'pet_toys', 'age', 5),
    ('pet_supplies__pet_products', 'pet_toys', 'breed_size', 6),
    ('pet_supplies__pet_products', 'pet_toys', 'chew_resistant', 7),
    ('pet_supplies__pet_products', 'pet_beds', 'brand', 0),
    ('pet_supplies__pet_products', 'pet_beds', 'pet_type', 1),
    ('pet_supplies__pet_products', 'pet_beds', 'breed_size', 2),
    ('pet_supplies__pet_products', 'pet_beds', 'material', 3),
    ('pet_supplies__pet_products', 'pet_beds', 'dimensions', 4),
    ('pet_supplies__pet_products', 'pet_beds', 'weight_capacity', 5),
    ('pet_supplies__pet_products', 'pet_beds', 'washable', 6),
    ('pet_supplies__pet_products', 'pet_beds', 'color', 7),
    ('pet_supplies__pet_products', 'collars', 'brand', 0),
    ('pet_supplies__pet_products', 'collars', 'pet_type', 1),
    ('pet_supplies__pet_products', 'collars', 'size', 2),
    ('pet_supplies__pet_products', 'collars', 'material', 3),
    ('pet_supplies__pet_products', 'collars', 'width', 4),
    ('pet_supplies__pet_products', 'collars', 'adjustable', 5),
    ('pet_supplies__pet_products', 'collars', 'color', 6),
    ('pet_supplies__pet_products', 'collars', 'closure_type', 7),
    ('pet_supplies__pet_products', 'leashes', 'brand', 0),
    ('pet_supplies__pet_products', 'leashes', 'pet_type', 1),
    ('pet_supplies__pet_products', 'leashes', 'material', 2),
    ('pet_supplies__pet_products', 'leashes', 'length', 3),
    ('pet_supplies__pet_products', 'leashes', 'width', 4),
    ('pet_supplies__pet_products', 'leashes', 'maximum_load', 5),
    ('pet_supplies__pet_products', 'leashes', 'handle_type', 6),
    ('pet_supplies__pet_products', 'leashes', 'color', 7),
    ('pet_supplies__pet_products', 'grooming', 'brand', 0),
    ('pet_supplies__pet_products', 'grooming', 'product_type', 1),
    ('pet_supplies__pet_products', 'grooming', 'pet_type', 2),
    ('pet_supplies__pet_products', 'grooming', 'material', 3),
    ('pet_supplies__pet_products', 'grooming', 'size', 4),
    ('pet_supplies__pet_products', 'grooming', 'suitable_coat_type', 5),
    ('pet_supplies__pet_products', 'grooming', 'quantity', 6),
    ('pet_supplies__pet_products', 'pet_accessories', 'brand', 0),
    ('pet_supplies__pet_products', 'pet_accessories', 'product_type', 1),
    ('pet_supplies__pet_products', 'pet_accessories', 'pet_type', 2),
    ('pet_supplies__pet_products', 'pet_accessories', 'material', 3),
    ('pet_supplies__pet_products', 'pet_accessories', 'size', 4),
    ('pet_supplies__pet_products', 'pet_accessories', 'color', 5),
    ('pet_supplies__pet_products', 'pet_accessories', 'dimensions', 6),
    ('pet_supplies__pet_products', 'pet_accessories', 'capacity', 7),
    ('tools_hardware__tools_hardware', 'hand_tools', 'brand', 0),
    ('tools_hardware__tools_hardware', 'hand_tools', 'model', 1),
    ('tools_hardware__tools_hardware', 'hand_tools', 'tool_type', 2),
    ('tools_hardware__tools_hardware', 'hand_tools', 'material', 3),
    ('tools_hardware__tools_hardware', 'hand_tools', 'dimensions', 4),
    ('tools_hardware__tools_hardware', 'hand_tools', 'weight', 5),
    ('tools_hardware__tools_hardware', 'hand_tools', 'handle_material', 6),
    ('tools_hardware__tools_hardware', 'hand_tools', 'maximum_load', 7),
    ('tools_hardware__tools_hardware', 'power_tools', 'brand', 0),
    ('tools_hardware__tools_hardware', 'power_tools', 'model', 1),
    ('tools_hardware__tools_hardware', 'power_tools', 'tool_type', 2),
    ('tools_hardware__tools_hardware', 'power_tools', 'power_source', 3),
    ('tools_hardware__tools_hardware', 'power_tools', 'voltage', 4),
    ('tools_hardware__tools_hardware', 'power_tools', 'power', 5),
    ('tools_hardware__tools_hardware', 'power_tools', 'battery_included', 6),
    ('tools_hardware__tools_hardware', 'power_tools', 'battery_type', 7),
    ('tools_hardware__tools_hardware', 'power_tools', 'speed', 8),
    ('tools_hardware__tools_hardware', 'power_tools', 'torque', 9),
    ('tools_hardware__tools_hardware', 'power_tools', 'weight', 10),
    ('tools_hardware__tools_hardware', 'measuring_tools', 'brand', 0),
    ('tools_hardware__tools_hardware', 'measuring_tools', 'model', 1),
    ('tools_hardware__tools_hardware', 'measuring_tools', 'tool_type', 2),
    ('tools_hardware__tools_hardware', 'measuring_tools', 'measurement_range', 3),
    ('tools_hardware__tools_hardware', 'measuring_tools', 'accuracy', 4),
    ('tools_hardware__tools_hardware', 'measuring_tools', 'units', 5),
    ('tools_hardware__tools_hardware', 'measuring_tools', 'material', 6),
    ('tools_hardware__tools_hardware', 'measuring_tools', 'power_source', 7),
    ('tools_hardware__tools_hardware', 'hardware', 'brand', 0),
    ('tools_hardware__tools_hardware', 'hardware', 'product_type', 1),
    ('tools_hardware__tools_hardware', 'hardware', 'material', 2),
    ('tools_hardware__tools_hardware', 'hardware', 'size', 3),
    ('tools_hardware__tools_hardware', 'hardware', 'dimensions', 4),
    ('tools_hardware__tools_hardware', 'hardware', 'quantity', 5),
    ('tools_hardware__tools_hardware', 'hardware', 'finish', 6),
    ('tools_hardware__tools_hardware', 'hardware', 'application', 7),
    ('tools_hardware__tools_hardware', 'electrical_tools', 'brand', 0),
    ('tools_hardware__tools_hardware', 'electrical_tools', 'model', 1),
    ('tools_hardware__tools_hardware', 'electrical_tools', 'tool_type', 2),
    ('tools_hardware__tools_hardware', 'electrical_tools', 'voltage', 3),
    ('tools_hardware__tools_hardware', 'electrical_tools', 'power', 4),
    ('tools_hardware__tools_hardware', 'electrical_tools', 'measurement_range', 5),
    ('tools_hardware__tools_hardware', 'electrical_tools', 'accuracy', 6),
    ('tools_hardware__tools_hardware', 'electrical_tools', 'power_source', 7),
    ('tools_hardware__tools_hardware', 'workshop_equipment', 'brand', 0),
    ('tools_hardware__tools_hardware', 'workshop_equipment', 'model', 1),
    ('tools_hardware__tools_hardware', 'workshop_equipment', 'equipment_type', 2),
    ('tools_hardware__tools_hardware', 'workshop_equipment', 'material', 3),
    ('tools_hardware__tools_hardware', 'workshop_equipment', 'dimensions', 4),
    ('tools_hardware__tools_hardware', 'workshop_equipment', 'weight', 5),
    ('tools_hardware__tools_hardware', 'workshop_equipment', 'maximum_load', 6),
    ('tools_hardware__tools_hardware', 'workshop_equipment', 'power_source', 7),
    ('food_grocery__food_grocery', 'snacks', 'brand', 0),
    ('food_grocery__food_grocery', 'snacks', 'product_type', 1),
    ('food_grocery__food_grocery', 'snacks', 'flavor', 2),
    ('food_grocery__food_grocery', 'snacks', 'weight', 3),
    ('food_grocery__food_grocery', 'snacks', 'ingredients', 4),
    ('food_grocery__food_grocery', 'snacks', 'nutritional_information', 5),
    ('food_grocery__food_grocery', 'snacks', 'allergens', 6),
    ('food_grocery__food_grocery', 'snacks', 'country_of_origin', 7),
    ('food_grocery__food_grocery', 'snacks', 'expiration_date', 8),
    ('food_grocery__food_grocery', 'beverages', 'brand', 0),
    ('food_grocery__food_grocery', 'beverages', 'product_type', 1),
    ('food_grocery__food_grocery', 'beverages', 'flavor', 2),
    ('food_grocery__food_grocery', 'beverages', 'volume', 3),
    ('food_grocery__food_grocery', 'beverages', 'ingredients', 4),
    ('food_grocery__food_grocery', 'beverages', 'nutritional_information', 5),
    ('food_grocery__food_grocery', 'beverages', 'caffeine', 6),
    ('food_grocery__food_grocery', 'beverages', 'country_of_origin', 7),
    ('food_grocery__food_grocery', 'beverages', 'expiration_date', 8),
    ('food_grocery__food_grocery', 'coffee', 'brand', 0),
    ('food_grocery__food_grocery', 'coffee', 'type', 1),
    ('food_grocery__food_grocery', 'coffee', 'roast_level', 2),
    ('food_grocery__food_grocery', 'coffee', 'origin', 3),
    ('food_grocery__food_grocery', 'coffee', 'weight', 4),
    ('food_grocery__food_grocery', 'coffee', 'grind_type', 5),
    ('food_grocery__food_grocery', 'coffee', 'flavor_notes', 6),
    ('food_grocery__food_grocery', 'coffee', 'ingredients', 7),
    ('food_grocery__food_grocery', 'coffee', 'expiration_date', 8),
    ('food_grocery__food_grocery', 'tea', 'brand', 0),
    ('food_grocery__food_grocery', 'tea', 'type', 1),
    ('food_grocery__food_grocery', 'tea', 'origin', 2),
    ('food_grocery__food_grocery', 'tea', 'weight', 3),
    ('food_grocery__food_grocery', 'tea', 'flavor', 4),
    ('food_grocery__food_grocery', 'tea', 'ingredients', 5),
    ('food_grocery__food_grocery', 'tea', 'caffeine', 6),
    ('food_grocery__food_grocery', 'tea', 'quantity', 7),
    ('food_grocery__food_grocery', 'tea', 'expiration_date', 8),
    ('food_grocery__food_grocery', 'canned_food', 'brand', 0),
    ('food_grocery__food_grocery', 'canned_food', 'product_type', 1),
    ('food_grocery__food_grocery', 'canned_food', 'weight', 2),
    ('food_grocery__food_grocery', 'canned_food', 'net_weight', 3),
    ('food_grocery__food_grocery', 'canned_food', 'ingredients', 4),
    ('food_grocery__food_grocery', 'canned_food', 'nutritional_information', 5),
    ('food_grocery__food_grocery', 'canned_food', 'allergens', 6),
    ('food_grocery__food_grocery', 'canned_food', 'storage_instructions', 7),
    ('food_grocery__food_grocery', 'canned_food', 'expiration_date', 8),
    ('food_grocery__food_grocery', 'cooking_ingredients', 'brand', 0),
    ('food_grocery__food_grocery', 'cooking_ingredients', 'product_type', 1),
    ('food_grocery__food_grocery', 'cooking_ingredients', 'weight', 2),
    ('food_grocery__food_grocery', 'cooking_ingredients', 'ingredients', 3),
    ('food_grocery__food_grocery', 'cooking_ingredients', 'allergens', 4),
    ('food_grocery__food_grocery', 'cooking_ingredients', 'country_of_origin', 5),
    ('food_grocery__food_grocery', 'cooking_ingredients', 'storage_instructions', 6),
    ('food_grocery__food_grocery', 'cooking_ingredients', 'expiration_date', 7),
    ('food_grocery__food_grocery', 'frozen_food', 'brand', 0),
    ('food_grocery__food_grocery', 'frozen_food', 'product_type', 1),
    ('food_grocery__food_grocery', 'frozen_food', 'weight', 2),
    ('food_grocery__food_grocery', 'frozen_food', 'ingredients', 3),
    ('food_grocery__food_grocery', 'frozen_food', 'allergens', 4),
    ('food_grocery__food_grocery', 'frozen_food', 'storage_temperature', 5),
    ('food_grocery__food_grocery', 'frozen_food', 'cooking_instructions', 6),
    ('food_grocery__food_grocery', 'frozen_food', 'expiration_date', 7),
    ('food_grocery__food_grocery', 'sweets', 'brand', 0),
    ('food_grocery__food_grocery', 'sweets', 'product_type', 1),
    ('food_grocery__food_grocery', 'sweets', 'flavor', 2),
    ('food_grocery__food_grocery', 'sweets', 'weight', 3),
    ('food_grocery__food_grocery', 'sweets', 'ingredients', 4),
    ('food_grocery__food_grocery', 'sweets', 'allergens', 5),
    ('food_grocery__food_grocery', 'sweets', 'nutritional_information', 6),
    ('food_grocery__food_grocery', 'sweets', 'expiration_date', 7),
    ('office_supplies__office_products', 'printers', 'brand', 0),
    ('office_supplies__office_products', 'printers', 'model', 1),
    ('office_supplies__office_products', 'printers', 'print_technology', 2),
    ('office_supplies__office_products', 'printers', 'print_speed', 3),
    ('office_supplies__office_products', 'printers', 'resolution', 4),
    ('office_supplies__office_products', 'printers', 'paper_sizes', 5),
    ('office_supplies__office_products', 'printers', 'connectivity', 6),
    ('office_supplies__office_products', 'printers', 'duplex_printing', 7),
    ('office_supplies__office_products', 'printers', 'ink_toner_type', 8),
    ('office_supplies__office_products', 'paper', 'brand', 0),
    ('office_supplies__office_products', 'paper', 'paper_size', 1),
    ('office_supplies__office_products', 'paper', 'paper_weight', 2),
    ('office_supplies__office_products', 'paper', 'paper_type', 3),
    ('office_supplies__office_products', 'paper', 'color', 4),
    ('office_supplies__office_products', 'paper', 'quantity', 5),
    ('office_supplies__office_products', 'paper', 'finish', 6),
    ('office_supplies__office_products', 'paper', 'recycled', 7),
    ('office_supplies__office_products', 'ink', 'brand', 0),
    ('office_supplies__office_products', 'ink', 'model', 1),
    ('office_supplies__office_products', 'ink', 'ink_type', 2),
    ('office_supplies__office_products', 'ink', 'color', 3),
    ('office_supplies__office_products', 'ink', 'printer_compatibility', 4),
    ('office_supplies__office_products', 'ink', 'page_yield', 5),
    ('office_supplies__office_products', 'ink', 'volume', 6),
    ('office_supplies__office_products', 'toners', 'brand', 0),
    ('office_supplies__office_products', 'toners', 'model', 1),
    ('office_supplies__office_products', 'toners', 'toner_type', 2),
    ('office_supplies__office_products', 'toners', 'color', 3),
    ('office_supplies__office_products', 'toners', 'printer_compatibility', 4),
    ('office_supplies__office_products', 'toners', 'page_yield', 5),
    ('office_supplies__office_products', 'pens', 'brand', 0),
    ('office_supplies__office_products', 'pens', 'pen_type', 1),
    ('office_supplies__office_products', 'pens', 'ink_color', 2),
    ('office_supplies__office_products', 'pens', 'tip_size', 3),
    ('office_supplies__office_products', 'pens', 'material', 4),
    ('office_supplies__office_products', 'pens', 'quantity', 5),
    ('office_supplies__office_products', 'notebooks', 'brand', 0),
    ('office_supplies__office_products', 'notebooks', 'size', 1),
    ('office_supplies__office_products', 'notebooks', 'paper_type', 2),
    ('office_supplies__office_products', 'notebooks', 'number_of_pages', 3),
    ('office_supplies__office_products', 'notebooks', 'cover_material', 4),
    ('office_supplies__office_products', 'notebooks', 'binding_type', 5),
    ('office_supplies__office_products', 'notebooks', 'color', 6),
    ('office_supplies__office_products', 'notebooks', 'quantity', 7),
    ('office_supplies__office_products', 'office_furniture', 'brand', 0),
    ('office_supplies__office_products', 'office_furniture', 'product_type', 1),
    ('office_supplies__office_products', 'office_furniture', 'material', 2),
    ('office_supplies__office_products', 'office_furniture', 'color', 3),
    ('office_supplies__office_products', 'office_furniture', 'dimensions', 4),
    ('office_supplies__office_products', 'office_furniture', 'maximum_load', 5),
    ('office_supplies__office_products', 'office_furniture', 'assembly_required', 6),
    ('office_supplies__office_products', 'office_furniture', 'adjustable', 7),
    ('office_supplies__office_products', 'filing_products', 'brand', 0),
    ('office_supplies__office_products', 'filing_products', 'product_type', 1),
    ('office_supplies__office_products', 'filing_products', 'material', 2),
    ('office_supplies__office_products', 'filing_products', 'dimensions', 3),
    ('office_supplies__office_products', 'filing_products', 'capacity', 4),
    ('office_supplies__office_products', 'filing_products', 'color', 5),
    ('office_supplies__office_products', 'filing_products', 'closure_type', 6),
    ('office_supplies__office_products', 'filing_products', 'quantity', 7),
    ('musical_instruments__music_products', 'guitars', 'brand', 0),
    ('musical_instruments__music_products', 'guitars', 'model', 1),
    ('musical_instruments__music_products', 'guitars', 'guitar_type', 2),
    ('musical_instruments__music_products', 'guitars', 'body_material', 3),
    ('musical_instruments__music_products', 'guitars', 'neck_material', 4),
    ('musical_instruments__music_products', 'guitars', 'number_of_strings', 5),
    ('musical_instruments__music_products', 'guitars', 'number_of_frets', 6),
    ('musical_instruments__music_products', 'guitars', 'pickup_type', 7),
    ('musical_instruments__music_products', 'guitars', 'finish', 8),
    ('musical_instruments__music_products', 'guitars', 'color', 9),
    ('musical_instruments__music_products', 'guitars', 'weight', 10),
    ('musical_instruments__music_products', 'keyboards', 'brand', 0),
    ('musical_instruments__music_products', 'keyboards', 'model', 1),
    ('musical_instruments__music_products', 'keyboards', 'number_of_keys', 2),
    ('musical_instruments__music_products', 'keyboards', 'key_type', 3),
    ('musical_instruments__music_products', 'keyboards', 'polyphony', 4),
    ('musical_instruments__music_products', 'keyboards', 'voices', 5),
    ('musical_instruments__music_products', 'keyboards', 'connectivity', 6),
    ('musical_instruments__music_products', 'keyboards', 'weight', 7),
    ('musical_instruments__music_products', 'keyboards', 'dimensions', 8),
    ('musical_instruments__music_products', 'drums', 'brand', 0),
    ('musical_instruments__music_products', 'drums', 'model', 1),
    ('musical_instruments__music_products', 'drums', 'drum_type', 2),
    ('musical_instruments__music_products', 'drums', 'shell_material', 3),
    ('musical_instruments__music_products', 'drums', 'number_of_pieces', 4),
    ('musical_instruments__music_products', 'drums', 'diameter', 5),
    ('musical_instruments__music_products', 'drums', 'finish', 6),
    ('musical_instruments__music_products', 'drums', 'color', 7),
    ('musical_instruments__music_products', 'microphones', 'brand', 0),
    ('musical_instruments__music_products', 'microphones', 'model', 1),
    ('musical_instruments__music_products', 'microphones', 'microphone_type', 2),
    ('musical_instruments__music_products', 'microphones', 'polar_pattern', 3),
    ('musical_instruments__music_products', 'microphones', 'connection', 4),
    ('musical_instruments__music_products', 'microphones', 'frequency_response', 5),
    ('musical_instruments__music_products', 'microphones', 'sensitivity', 6),
    ('musical_instruments__music_products', 'microphones', 'phantom_power', 7),
    ('musical_instruments__music_products', 'speakers', 'brand', 0),
    ('musical_instruments__music_products', 'speakers', 'model', 1),
    ('musical_instruments__music_products', 'speakers', 'speaker_type', 2),
    ('musical_instruments__music_products', 'speakers', 'power_output', 3),
    ('musical_instruments__music_products', 'speakers', 'frequency_response', 4),
    ('musical_instruments__music_products', 'speakers', 'connectivity', 5),
    ('musical_instruments__music_products', 'speakers', 'inputs', 6),
    ('musical_instruments__music_products', 'speakers', 'weight', 7),
    ('musical_instruments__music_products', 'audio_interfaces', 'brand', 0),
    ('musical_instruments__music_products', 'audio_interfaces', 'model', 1),
    ('musical_instruments__music_products', 'audio_interfaces', 'number_of_inputs', 2),
    ('musical_instruments__music_products', 'audio_interfaces', 'number_of_outputs', 3),
    ('musical_instruments__music_products', 'audio_interfaces', 'sample_rate', 4),
    ('musical_instruments__music_products', 'audio_interfaces', 'bit_depth', 5),
    ('musical_instruments__music_products', 'audio_interfaces', 'phantom_power', 6),
    ('musical_instruments__music_products', 'audio_interfaces', 'connectivity', 7),
    ('musical_instruments__music_products', 'musical_accessories', 'brand', 0),
    ('musical_instruments__music_products', 'musical_accessories', 'product_type', 1),
    ('musical_instruments__music_products', 'musical_accessories', 'material', 2),
    ('musical_instruments__music_products', 'musical_accessories', 'compatibility', 3),
    ('musical_instruments__music_products', 'musical_accessories', 'dimensions', 4),
    ('musical_instruments__music_products', 'musical_accessories', 'color', 5),
    ('musical_instruments__music_products', 'musical_accessories', 'quantity', 6),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'brand', 0),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'series', 1),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'character', 2),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'edition', 3),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'material', 4),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'dimensions', 5),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'scale', 6),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'release_year', 7),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'limited_edition', 8),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'condition', 9),
    ('collectibles_hobbies__collectibles_hobbies', 'figures', 'authenticity', 10),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'brand', 0),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'series', 1),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'character_player', 2),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'edition', 3),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'release_year', 4),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'card_number', 5),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'rarity', 6),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'condition', 7),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'language', 8),
    ('collectibles_hobbies__collectibles_hobbies', 'trading_cards', 'authenticity', 9),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'brand', 0),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'series', 1),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'model_type', 2),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'scale', 3),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'material', 4),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'dimensions', 5),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'release_year', 6),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'assembly_required', 7),
    ('collectibles_hobbies__collectibles_hobbies', 'models', 'condition', 8),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'brand', 0),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'series', 1),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'character', 2),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'edition', 3),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'age_group', 4),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'material', 5),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'dimensions', 6),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'limited_edition', 7),
    ('collectibles_hobbies__collectibles_hobbies', 'collectible_toys', 'condition', 8),
    ('collectibles_hobbies__collectibles_hobbies', 'memorabilia', 'brand', 0),
    ('collectibles_hobbies__collectibles_hobbies', 'memorabilia', 'item_type', 1),
    ('collectibles_hobbies__collectibles_hobbies', 'memorabilia', 'subject', 2),
    ('collectibles_hobbies__collectibles_hobbies', 'memorabilia', 'year', 3),
    ('collectibles_hobbies__collectibles_hobbies', 'memorabilia', 'edition', 4),
    ('collectibles_hobbies__collectibles_hobbies', 'memorabilia', 'authenticity', 5),
    ('collectibles_hobbies__collectibles_hobbies', 'memorabilia', 'condition', 6),
    ('collectibles_hobbies__collectibles_hobbies', 'memorabilia', 'certificate_of_authenticity', 7),
    ('collectibles_hobbies__collectibles_hobbies', 'art_crafts', 'product_type', 0),
    ('collectibles_hobbies__collectibles_hobbies', 'art_crafts', 'material', 1),
    ('collectibles_hobbies__collectibles_hobbies', 'art_crafts', 'technique', 2),
    ('collectibles_hobbies__collectibles_hobbies', 'art_crafts', 'dimensions', 3),
    ('collectibles_hobbies__collectibles_hobbies', 'art_crafts', 'theme', 4),
    ('collectibles_hobbies__collectibles_hobbies', 'art_crafts', 'color', 5),
    ('collectibles_hobbies__collectibles_hobbies', 'art_crafts', 'handmade', 6),
    ('collectibles_hobbies__collectibles_hobbies', 'art_crafts', 'customizable', 7),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'product_type', 0),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'material', 1),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'size', 2),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'color', 3),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'style', 4),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'pattern', 5),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'technique', 6),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'handmade', 7),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'customizable', 8),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'personalization', 9),
    ('handmade_crafts__handmade_custom', 'handmade_clothing', 'production_time', 10),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'jewelry_type', 0),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'material', 1),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'metal_type', 2),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'stone_type', 3),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'size', 4),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'color', 5),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'technique', 6),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'handmade', 7),
    ('handmade_crafts__handmade_custom', 'handmade_jewelry', 'personalization', 8),
    ('handmade_crafts__handmade_custom', 'artwork', 'artwork_type', 0),
    ('handmade_crafts__handmade_custom', 'artwork', 'artist', 1),
    ('handmade_crafts__handmade_custom', 'artwork', 'material', 2),
    ('handmade_crafts__handmade_custom', 'artwork', 'technique', 3),
    ('handmade_crafts__handmade_custom', 'artwork', 'dimensions', 4),
    ('handmade_crafts__handmade_custom', 'artwork', 'medium', 5),
    ('handmade_crafts__handmade_custom', 'artwork', 'style', 6),
    ('handmade_crafts__handmade_custom', 'artwork', 'theme', 7),
    ('handmade_crafts__handmade_custom', 'artwork', 'handmade', 8),
    ('handmade_crafts__handmade_custom', 'artwork', 'framed', 9),
    ('handmade_crafts__handmade_custom', 'decorations', 'product_type', 0),
    ('handmade_crafts__handmade_custom', 'decorations', 'material', 1),
    ('handmade_crafts__handmade_custom', 'decorations', 'color', 2),
    ('handmade_crafts__handmade_custom', 'decorations', 'dimensions', 3),
    ('handmade_crafts__handmade_custom', 'decorations', 'style', 4),
    ('handmade_crafts__handmade_custom', 'decorations', 'theme', 5),
    ('handmade_crafts__handmade_custom', 'decorations', 'handmade', 6),
    ('handmade_crafts__handmade_custom', 'decorations', 'mounting_type', 7),
    ('handmade_crafts__handmade_custom', 'crafts', 'product_type', 0),
    ('handmade_crafts__handmade_custom', 'crafts', 'material', 1),
    ('handmade_crafts__handmade_custom', 'crafts', 'technique', 2),
    ('handmade_crafts__handmade_custom', 'crafts', 'dimensions', 3),
    ('handmade_crafts__handmade_custom', 'crafts', 'color', 4),
    ('handmade_crafts__handmade_custom', 'crafts', 'theme', 5),
    ('handmade_crafts__handmade_custom', 'crafts', 'handmade', 6),
    ('handmade_crafts__handmade_custom', 'crafts', 'customizable', 7),
    ('handmade_crafts__handmade_custom', 'custom_products', 'product_type', 0),
    ('handmade_crafts__handmade_custom', 'custom_products', 'material', 1),
    ('handmade_crafts__handmade_custom', 'custom_products', 'dimensions', 2),
    ('handmade_crafts__handmade_custom', 'custom_products', 'color', 3),
    ('handmade_crafts__handmade_custom', 'custom_products', 'personalization', 4),
    ('handmade_crafts__handmade_custom', 'custom_products', 'custom_text', 5),
    ('handmade_crafts__handmade_custom', 'custom_products', 'custom_image', 6),
    ('handmade_crafts__handmade_custom', 'custom_products', 'production_time', 7),
    ('handmade_crafts__handmade_custom', 'custom_products', 'handmade', 8)
  ) as v(cat_slug, type_slug, attr_slug, ord)
  join categories    c  on c.slug  = v.cat_slug
  join product_types pt on pt.category_id = c.id and pt.slug = v.type_slug
  join attributes    a  on a.slug  = v.attr_slug
on conflict (product_type_id, attribute_id) do nothing;


-- ==== product-attributes.sql ============================================

-- ===========================================================================
-- Loja AIAI -- what each product actually answers
--
-- Run AFTER supabase/taxonomy.sql. Safe to re-run.
--
-- taxonomy.sql says a Sofa HAS a Seat Height. This says THIS sofa's seat
-- height is 45cm.
--
-- ONE ROW PER VALUE, NOT ONE ROW PER ATTRIBUTE. A multi-select -- "Features:
-- Waterproof, Foldable, Washable" -- is three rows here, not one row
-- holding a list. That costs nothing and buys the thing the storefront
-- needs most: a filter is then a join on (attribute_id, value), which an
-- index answers, instead of a LIKE against the inside of an array. The
-- unique key is (product, attribute, value), so a single-valued attribute
-- is simply the case where there happens to be one.
--
-- WHY value_num EXISTS BESIDE value. Everything arrives as text, and text
-- sorts like text: '100' comes before '99', so "sofas under 200cm wide"
-- returns the wrong sofas and a price sort is nonsense. Numbers are
-- therefore ALSO written to a numeric column, and the range filters and
-- sorts read that one. It is filled by the application rather than
-- generated, because whether a value is a number is a property of the
-- ATTRIBUTE (field_type), which this row does not carry -- and a generated
-- column cannot look at another table.
-- ===========================================================================

create table if not exists product_attribute_values (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  attribute_id  uuid not null references attributes(id) on delete cascade,

  -- The stored answer, always as text. For a select this is
  -- attribute_options.value; for a boolean, 'true' or 'false'; for a
  -- colour, the hex.
  value         text not null,

  -- The same answer as a number, where it is one. Null for everything
  -- else. Written by the application -- see the note above.
  value_num     numeric,

  created_at    timestamptz not null default now(),

  -- One row per distinct answer. A multi-select has several; everything
  -- else has one. This is also what makes a re-save idempotent.
  unique (product_id, attribute_id, value)
);

-- Reading a product's whole form back: every value it holds, in one go.
create index if not exists pav_product_idx
  on product_attribute_values (product_id);

-- The storefront filter: "every product whose Colour is Black". Ordered
-- attribute-first because that is how the question is asked.
create index if not exists pav_filter_idx
  on product_attribute_values (attribute_id, value);

-- The range filter: "width between 180 and 220". Partial, because only a
-- minority of values are numbers and an index over the nulls would be
-- mostly empty.
create index if not exists pav_numeric_idx
  on product_attribute_values (attribute_id, value_num)
  where value_num is not null;

comment on table product_attribute_values is
  'What each product answers for each of its product type''s attributes. One row per VALUE, so a multi-select is several rows -- see supabase/product-attributes.sql.';
comment on column product_attribute_values.value_num is
  'The same answer as a number where it is one, so range filters and sorts do not compare ''100'' with ''99'' as text. Null otherwise.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Readable by anyone, for the same reason the taxonomy is: the product page
-- draws these, and it runs as anon. An admin-only attribute is filtered by
-- the application when it builds the page -- but it must ALSO be
-- unreachable here, or the value is one crafted query away.

alter table product_attribute_values enable row level security;

drop policy if exists pav_public_read on product_attribute_values;
create policy pav_public_read on product_attribute_values
  for select using (
    exists (
      select 1 from attributes a
       where a.id = product_attribute_values.attribute_id
         and not a.admin_only
    )
  );

revoke all on product_attribute_values from anon, authenticated;
grant select on product_attribute_values to anon, authenticated;


-- ==== harden-rls.sql ====================================================

-- harden-rls.sql
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- This script does NOT run automatically — apply-update.js never touches your
-- database, it only writes this file for you to review and run yourself.
--
-- Why: every upload and every order insert in this codebase already goes
-- through a server action using the SERVICE ROLE key (supabaseAdmin()),
-- which bypasses RLS entirely. That means the public-facing insert
-- policies below are not used by the app at all -- they only exist as an
-- open door for anyone holding the public anon key (visible in any
-- browser's network tab) to write directly to your database/storage via
-- the Supabase REST API, bypassing all of the app's validation,
-- compression, and price/stock checks. Dropping them closes that door
-- without changing any app behavior.

-- Orders: stop accepting inserts from the anon/public role directly.
-- placeOrder() already inserts via the service-role client.
drop policy if exists orders_public_insert on orders;

-- Storage: stop accepting uploads from the anon/public role directly.
-- Every upload path (products.ts, hero.ts, seller-products.ts, orders.ts)
-- already uploads via the service-role client.
drop policy if exists "product images public upload" on storage.objects;
drop policy if exists "payment proofs public upload" on storage.objects;

-- Public READ access to product images is still required (that's how
-- <img>/next/image tags load them in the browser) -- left untouched:
--   policy "product images public read" on storage.objects for select ...


-- ==== patch-audit-hardening.sql =========================================

-- ===========================================================================
-- patch-audit-hardening.sql
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run.
-- Apply-aiaimarket-hardening.js never touches your database; it only writes
-- this file for you to read and run yourself.
--
-- Safe to re-run. Every statement is idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. [CRITICAL] Unapproved products are publicly readable.
--
-- The app filters status='approved' in its QUERIES (getLiveProducts,
-- getProductBySlug), but the RLS policy only checks `archived`. Anyone with
-- the anon key -- which is, by design, visible in every browser's network
-- tab -- can call the REST API directly:
--
--     GET /rest/v1/products?status=eq.pending
--
-- and read every listing awaiting moderation, plus every one an admin has
-- already REJECTED. The moderation workflow is enforced in application code
-- only; the database happily serves around it. Move the rule into the policy,
-- where it cannot be bypassed.
--
-- Admin and seller pages are unaffected: they read through the service-role
-- client, which bypasses RLS entirely.
-- ---------------------------------------------------------------------------
drop policy if exists products_public_read on products;
create policy products_public_read on products
  for select using (archived = false and status = 'approved');

-- ---------------------------------------------------------------------------
-- 2. [HIGH] schema.sql cannot run on a fresh database.
--
-- `seller_ratings` is defined ABOVE `orders` in schema.sql but declares
--     order_id uuid references orders(id) on delete set null
-- so on a brand-new project the script aborts with
--     ERROR: relation "orders" does not exist
-- and every table after that point is never created. It only appears to work
-- on databases that grew incrementally through earlier versions of the file.
--
-- The fix in schema.sql drops the inline reference and adds the constraint
-- at the end, once both tables exist. This block does the same for a
-- database that is already live and missing the constraint.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_ratings_order_id_fkey'
  ) then
    alter table seller_ratings
      add constraint seller_ratings_order_id_fkey
      foreign key (order_id) references orders(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. [HIGH] Bank account numbers are readable without placing an order.
--
-- settings.banks / settings.wallets are granted to anon so the checkout page
-- can reveal them after a buyer picks "bank transfer". But a grant is not a
-- condition -- anyone can read them straight from the REST API without ever
-- touching the store:
--
--     GET /rest/v1/settings?select=banks,wallets
--
-- That is your real account numbers and holder names, published. This is a
-- judgement call, not an automatic fix, so it is left COMMENTED OUT:
--
--   * If those details are already on your public shopfront, WhatsApp
--     status or business card, leave this alone -- nothing is being leaked.
--   * If they are not, uncomment the two lines below. Payment details then
--     come only from the server (getSettings runs server-side), and nothing
--     in the UI changes.
-- ---------------------------------------------------------------------------
-- revoke select (banks, wallets) on settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. [MEDIUM] Stock can go negative under concurrent confirmations.
--
-- SUPERSEDED, AND THE REPLACEMENT HAS BEEN DELETED FROM THIS FILE. Read
-- this before adding anything like it back.
--
-- This section used to `create or replace decrement_stock_on_confirm()`
-- with a row lock added. That was the right fix when it was written. It has
-- since become the single most damaging line in the schema, because
-- supabase/stock-reservation.sql replaced the same function with one that
-- moves stock THROUGH THE LEDGER -- and this file runs last, so it put the
-- old direct-write version back every single time the schema was applied.
--
-- What that cost, on a database where run-all.sql had been run:
--
--   * confirming an order wrote products.qty directly and recorded no
--     movement, so stock_reconciliation drifted by the size of the order
--     and the ledger stopped being the history of the shelf;
--   * no reservation was ever written, so the hold placed at checkout did
--     not exist, release_stale_reservations swept nothing, and the whole
--     of stock-reservation.sql was inert;
--   * two orders could still take the last unit, which is the very thing
--     this section was added to prevent -- the lock it takes is per
--     confirmation, and the race moved to placement.
--
-- The locking this was for now happens in reserve_order_stock(), which
-- takes the row lock at PLACEMENT, where the race actually is. Nothing here
-- needs to redefine the trigger, so nothing here does.
--
-- Found by applying run-all.sql to an empty Postgres and confirming one
-- order: products.qty went 30 -> 27 with no ledger row behind it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. [MEDIUM] Missing indexes on the marketplace's hottest lookups.
--
-- Every product page resolves a slug; every seller dashboard scans by
-- seller_id; the ratings widget groups by seller. None of those had an index.
-- ---------------------------------------------------------------------------
create index if not exists idx_products_slug       on products(slug);
create index if not exists idx_products_seller     on products(seller_id);
create index if not exists idx_categories_slug     on categories(slug);
create index if not exists idx_sellers_slug        on sellers(slug);
create index if not exists idx_sellers_user        on sellers(user_id);
create index if not exists idx_sellers_status      on sellers(status);
create index if not exists idx_hero_slides_sort    on hero_slides(sort_order);

-- Partial index matching the exact predicate the catalog queries use.
create index if not exists idx_products_live
  on products(created_at desc)
  where archived = false and status = 'approved';

-- ---------------------------------------------------------------------------
-- 6. [LOW] order_log has RLS enabled but no policy, which is correct
--    (default deny). Stated here so a future reader doesn't "fix" it.
-- ---------------------------------------------------------------------------


-- ==== seed.sql ==========================================================

-- ============================================================
-- Optional demo seed data. Run after schema.sql if you want sample
-- products to look at before adding your own. Safe to skip entirely.
-- ============================================================

update settings set
  store_name = 'AIAI STORE TIMOR-LESTE',
  tagline_tet = 'Sasán loos, folin klaru, entrega iha Dili.',
  tagline_pt  = 'Produtos reais, preços claros, entrega em Díli.',
  tagline_en  = 'Real stock, clear prices, delivered in Dili.',
  wa_number = '+67077123456',
  hours = 'Segunda–Sábadu · 08:00–18:00',
  municipality = 'Dili', post = 'Vera Cruz', suku = 'Caicoli',
  landmark = 'besik igreja Balide, uma kór mutin',
  pickup = true,
  banks = '[{"label":"BNCTL","account":"0012 3456 7890","holder":"AIAI STORE TIMOR-LESTE Unipessoal"}]',
  wallets = '[{"label":"Telemor Mosan","number":"+670 7712 3456"}]',
  -- THE REAL ZONE IDS, and no "name" field.
  --
  -- This used to write z1, z2 and z3 with names in Tetun. Neither half was
  -- right: the application labels a zone by looking up t("zone_" + id), so
  -- an id it does not recognise was shown to shoppers as the literal string
  -- "zone_z1", and the "name" here was read by nothing at all -- it made
  -- the row LOOK correct while the checkout offered three untranslated keys
  -- as if they were places. The ids below are the ones lib/zones.ts knows.
  zones = '[{"id":"dili_center","fee":1,"quote":false},
            {"id":"dili_outskirts","fee":2,"quote":false},
            {"id":"other_municipality","fee":0,"quote":true}]'
where id = 1;

insert into categories (name, slug, sort_order) values
  ('Sapatu','sapatu',1), ('Roupa','roupa',2), ('Telemóvel & asesóriu','telemovel',3)
on conflict (seller_id, slug) do nothing;

-- THE SAMPLE PRODUCT ARRIVES THROUGH THE LEDGER, like every real one.
--
-- It used to be inserted with qty 6 written straight onto the row. This file
-- runs LAST, after stock-ledger.sql has already backfilled opening balances,
-- so those six units had no movement behind them -- and stock_reconciliation
-- reported drift 6 on the demo shoe of every fresh install, for ever.
--
-- Drift is the alarm that means "something wrote products.qty without a
-- movement". It is the alarm that would have caught two real bugs in this
-- schema, and it was ringing on day one about a sample shoe. An alarm that
-- is always on is an alarm nobody reads, which is the whole cost.
--
-- So: the row goes in empty, and a movement puts the stock on the shelf. The
-- trigger sets qty AND stock_status from it, exactly as a purchase receipt
-- does, and the ledger balances.
insert into products (ref, name, slug, category_id, price, sizes, tags, stock_status, qty, description,
  pay_cod, pay_cop, pay_bank)
select
  'PRD-0001', 'Nike Air Max 90', 'nike-air-max-90',
  (select id from categories where slug = 'sapatu'),
  45.00, array['40','41','42','43'], array['viajen','servisu'],
  'out', 0, 'Sapatu importadu, kualidade orijinál. Sola konfortavel ba la''o dook.',
  true, true, true
where not exists (select 1 from products where ref = 'PRD-0001');

-- Guarded on the movement, not on the product: re-running this file must not
-- stock the shelf a second time.
insert into stock_movements (product_id, delta, reason, note)
select p.id, 6, 'correction', 'sample data'
  from products p
 where p.ref = 'PRD-0001'
   and not exists (
     select 1 from stock_movements m
      where m.product_id = p.id and m.note = 'sample data');

