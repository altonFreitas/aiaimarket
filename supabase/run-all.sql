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
-- Loja AIAI — schema for "Marketplace Platform for Timor-Leste v1.0"
-- Run this once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- settings (Epic A3, single row for the single seller) ----------
create table if not exists settings (
  id            int primary key default 1,
  seller_id     uuid not null default gen_random_uuid(),   -- Decision 2: present from day one
  store_name    text not null default 'Loja AIAI',
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

alter table stock_movements
  drop constraint if exists stock_movements_reason_check;

alter table stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('purchase_receipt','sale','adjustment','return',
                    'correction','reservation'));

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
  'MP4/WebM URL. Empty means this slide is a photo. When set, image_url is the poster frame shown until the video plays.';

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
alter table sellers drop constraint if exists sellers_features_check;
alter table sellers
  add constraint sellers_features_check check (
    features <@ array['sales','stock','procurement','today']::text[]
  );

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
alter table sellers drop constraint if exists sellers_features_check;
alter table sellers
  add constraint sellers_features_check check (
    features <@ array['sales','stock','procurement','today']::text[]
  );

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
  store_name = 'Loja AIAI',
  tagline_tet = 'Sasán loos, folin klaru, entrega iha Dili.',
  tagline_pt  = 'Produtos reais, preços claros, entrega em Díli.',
  tagline_en  = 'Real stock, clear prices, delivered in Dili.',
  wa_number = '+67077123456',
  hours = 'Segunda–Sábadu · 08:00–18:00',
  municipality = 'Dili', post = 'Vera Cruz', suku = 'Caicoli',
  landmark = 'besik igreja Balide, uma kór mutin',
  pickup = true,
  banks = '[{"label":"BNCTL","account":"0012 3456 7890","holder":"Loja AIAI Unipessoal"}]',
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

